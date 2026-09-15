"""Fight-Elo: a rating and win-probability engine for UFC and MMA.

Standard Elo is built for chess, where every game is the same length and every
result is binary. Fights are different in three ways that matter, and this
engine accounts for all three:

1. **Finishes are stronger evidence than decisions.** A first-round knockout
   says more than a split decision. The margin of victory scales the rating
   update.
2. **Time matters.** A fighter's form two years ago says less than last month.
   Results are decayed by age.
3. **Rating change should shrink as a career grows.** Fighters with many bouts
   have a more established level, so their rating moves less per fight.

    >>> from cito_fight_elo import FightElo
    >>> elo = FightElo()
    >>> elo.fit(bouts)                     # list of BoutResult
    >>> elo.rating("islam-makhachev")      # 1832.4
    >>> elo.predict("islam-makhachev", "ian-machado-garry")
    Prediction(a=0.71, b=0.29, ...)

Everything runs on plain dicts, so it works with the Cito UFC API, the
HuggingFace dataset, or your own CSV — see :func:`cito_fight_elo.from_api`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

__version__ = "1.0.0"

# --------------------------------------------------------------------------- #
# defaults
# --------------------------------------------------------------------------- #

DEFAULT_RATING = 1500.0
DEFAULT_K = 32.0
DEFAULT_SCALE = 400.0
DEFAULT_DECAY_DAYS = 365.0
DEFAULT_DECAY_HALFLIFE_DAYS = 540.0

#: How much each method multiplies the rating update. A finish is stronger
#: evidence than a decision; a split decision is weaker still.
METHOD_WEIGHT = {
    "ko/tko": 1.15,
    "tko": 1.15,
    "ko": 1.15,
    "submission": 1.15,
    "sub": 1.15,
    "decision - unanimous": 1.0,
    "u-dec": 1.0,
    "unanimous": 1.0,
    "decision - majority": 0.95,
    "m-dec": 0.95,
    "majority": 0.95,
    "decision - split": 0.9,
    "split": 0.9,
    "s-dec": 0.9,
    "draw": 0.0,
    "no contest": 0.0,
    "nc": 0.0,
}


def _method_weight(method: Optional[str]) -> float:
    if not method:
        return 1.0
    key = str(method).strip().lower()
    if key in METHOD_WEIGHT:
        return METHOD_WEIGHT[key]
    for prefix, weight in METHOD_WEIGHT.items():
        if key.startswith(prefix):
            return weight
    return 1.0


def _as_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(text[: len(fmt) + 6].strip(), fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


# --------------------------------------------------------------------------- #
# data
# --------------------------------------------------------------------------- #


@dataclass
class BoutResult:
    """One completed fight, as the engine needs it.

    Build these from any source. :meth:`from_dict` accepts the field names used
    by the Cito UFC API and by the HuggingFace round-statistics dataset, so you
    can usually pass a row straight in.
    """

    fighter_a: str
    fighter_b: str
    winner: Optional[str]
    event_date: Optional[date] = None
    method: Optional[str] = None
    round: Optional[int] = None
    bout_id: Optional[str] = None
    weight_class: Optional[str] = None

    #: 0.0 = no contest / draw, otherwise reserved.
    is_draw: bool = False

    @property
    def decided(self) -> bool:
        return self.winner in (self.fighter_a, self.fighter_b)

    @classmethod
    def from_dict(cls, row: Mapping[str, Any]) -> "BoutResult":
        """Build from a Cito API bout row or a dataset row.

        Accepts both the API's camelCase and the dataset's snake_case.
        """
        def pick(*names: str) -> Any:
            for n in names:
                if n in row and row[n] is not None:
                    return row[n]
            return None

        a = pick("fighter_a", "fighter_a_slug", "red_slug", "fighter_slug")
        b = pick("fighter_b", "fighter_b_slug", "blue_slug", "opponent_slug")

        # API bout rows carry a fighters[] array of corners instead.
        corners = row.get("fighters") or row.get("corners")
        if (not a or not b) and isinstance(corners, Sequence):
            red = next(
                (c for c in corners if str(c.get("corner", "")).lower() == "red"), None
            )
            blue = next(
                (c for c in corners if str(c.get("corner", "")).lower() == "blue"), None
            )
            if red and blue:
                a = a or red.get("fighterSlug") or red.get("slug")
                b = b or blue.get("fighterSlug") or blue.get("slug")

        winner = pick("winner", "winner_slug", "winnerFighterSlug")
        method = pick("method", "result")
        rnd = pick("round", "resultRound", "result_round")
        when = pick("event_date", "date", "startsAt", "event_date_label")

        is_draw = str(method or "").strip().lower() in ("draw", "decision - draw", "majority draw")

        return cls(
            fighter_a=str(a) if a else "",
            fighter_b=str(b) if b else "",
            winner=str(winner) if winner else None,
            event_date=_as_date(when),
            method=str(method) if method else None,
            round=int(rnd) if isinstance(rnd, (int, float)) else None,
            bout_id=str(pick("bout_id", "id") or "") or None,
            weight_class=pick("weight_class", "weightClass"),
            is_draw=is_draw,
        )


@dataclass
class Prediction:
    """A head-to-head forecast."""

    fighter_a: str
    fighter_b: str
    p_a: float
    p_b: float
    rating_a: float
    rating_b: float
    bouts_a: int = 0
    bouts_b: int = 0

    @property
    def favourite(self) -> str:
        return self.fighter_a if self.p_a >= self.p_b else self.fighter_b

    @property
    def confidence(self) -> float:
        """How far from a coin flip, 0.0 (even) to 1.0 (certain)."""
        return abs(self.p_a - 0.5) * 2

    def __str__(self) -> str:
        return (
            f"{self.fighter_a} {self.p_a:.1%} vs {self.fighter_b} {self.p_b:.1%} "
            f"({self.rating_a:.0f} vs {self.rating_b:.0f})"
        )


@dataclass
class Backtest:
    """Out-of-sample evaluation of the engine.

    Note the baseline: picking the higher-rated fighter is only useful if it
    beats :attr:`baseline_accuracy`, which is the accuracy of always picking the
    more experienced fighter (the trivially available signal).
    """

    n: int
    correct: int
    log_loss: float
    brier: float
    baseline_accuracy: float
    fold_accuracy: List[float] = field(default_factory=list)

    @property
    def accuracy(self) -> float:
        return self.correct / self.n if self.n else 0.0

    @property
    def beats_baseline(self) -> bool:
        return self.accuracy > self.baseline_accuracy

    def summary(self) -> str:
        return (
            f"{self.n} fights | accuracy {self.accuracy:.1%} "
            f"(baseline {self.baseline_accuracy:.1%}) | "
            f"log loss {self.log_loss:.4f} | Brier {self.brier:.4f}"
        )


# --------------------------------------------------------------------------- #
# engine
# --------------------------------------------------------------------------- #


class FightElo:
    """Elo ratings for fighters, tuned for how fights actually work.

    :param k: base rating sensitivity. Higher adapts faster and is noisier.
    :param scale: rating gap that corresponds to roughly a 10:1 edge.
    :param halflife_days: how long until an old result carries half its weight.
    :param finish_bonus: extra weight for a finish beyond the method table.
    :param provisional_bouts: when set above zero, fighters with fewer than this
        many bouts get up to 2x K so their rating converges quickly from a small
        sample, then settle to the base K.
    """

    def __init__(
        self,
        *,
        k: float = DEFAULT_K,
        scale: float = DEFAULT_SCALE,
        halflife_days: float = DEFAULT_DECAY_HALFLIFE_DAYS,
        finish_bonus: float = 0.0,
        provisional_bouts: int = 0,
        default_rating: float = DEFAULT_RATING,
    ) -> None:
        self.k = float(k)
        self.scale = float(scale)
        self.halflife_days = float(halflife_days)
        self.finish_bonus = float(finish_bonus)
        self.provisional_bouts = int(provisional_bouts)
        self.default_rating = float(default_rating)

        self.ratings: Dict[str, float] = {}
        self.bouts: Dict[str, int] = {}
        self.wins: Dict[str, int] = {}
        self.losses: Dict[str, int] = {}
        self.last_fought: Dict[str, date] = {}
        self.history: List[Tuple[date, str, float]] = []

    # -- rating access ---------------------------------------------------- #

    def rating(self, fighter: str) -> float:
        """Current rating, or the default for an unseen fighter."""
        return self.ratings.get(fighter, self.default_rating)

    def record(self, fighter: str) -> Tuple[int, int]:
        return self.wins.get(fighter, 0), self.losses.get(fighter, 0)

    def leaderboard(self, limit: int = 25, min_bouts: int = 3) -> List[Tuple[str, float, int, int]]:
        """Top fighters by rating: ``(name, rating, wins, losses)``."""
        rows = [
            (name, rating, self.wins.get(name, 0), self.losses.get(name, 0))
            for name, rating in self.ratings.items()
            if self.bouts.get(name, 0) >= min_bouts
        ]
        rows.sort(key=lambda r: r[1], reverse=True)
        return rows[:limit]

    # -- probability ------------------------------------------------------ #

    def expected(self, rating_a: float, rating_b: float) -> float:
        """Logistic win probability for A given two ratings."""
        return 1.0 / (1.0 + math.pow(10.0, (rating_b - rating_a) / self.scale))

    def predict(self, fighter_a: str, fighter_b: str) -> Prediction:
        """Head-to-head win probability from current ratings."""
        ra, rb = self.rating(fighter_a), self.rating(fighter_b)
        p_a = self.expected(ra, rb)
        return Prediction(
            fighter_a=fighter_a,
            fighter_b=fighter_b,
            p_a=p_a,
            p_b=1.0 - p_a,
            rating_a=ra,
            rating_b=rb,
            bouts_a=self.bouts.get(fighter_a, 0),
            bouts_b=self.bouts.get(fighter_b, 0),
        )

    # -- fitting ---------------------------------------------------------- #

    def _decay(self, when: Optional[date], reference: Optional[date]) -> float:
        """Exponential time decay, 1.0 for a fresh result."""
        if when is None or reference is None or self.halflife_days <= 0:
            return 1.0
        age = (reference - when).days
        if age <= 0:
            return 1.0
        return math.pow(0.5, age / self.halflife_days)

    def _k_for(self, fighter: str) -> float:
        """K for this fighter.

        With ``provisional_bouts=n`` set, a fighter with few recorded bouts gets
        up to 2x K so their rating converges quickly from a small sample. Once
        they reach *n* bouts their K settles at the base value and ratings move
        more conservatively.
        """
        if self.provisional_bouts <= 0:
            return self.k
        n = self.bouts.get(fighter, 0)
        if n >= self.provisional_bouts:
            return self.k
        # Linear ramp from 2x K at debut down to 1x at the provisional threshold.
        ramp = 2.0 - (n / float(self.provisional_bouts))
        return self.k * max(1.0, ramp)

    def update(self, bout: BoutResult, *, reference_date: Optional[date] = None) -> None:
        """Apply one completed bout to the ratings."""
        a, b = bout.fighter_a, bout.fighter_b
        if not a or not b or a == b:
            return
        if not bout.decided:
            # Draws and no-contests still register activity but barely move ratings.
            self.bouts[a] = self.bouts.get(a, 0) + 1
            self.bouts[b] = self.bouts.get(b, 0) + 1
            if bout.event_date:
                self.last_fought[a] = max(self.last_fought.get(a, bout.event_date), bout.event_date)
                self.last_fought[b] = max(self.last_fought.get(b, bout.event_date), bout.event_date)
            return

        ra = self.rating(a)
        rb = self.rating(b)
        expected_a = self.expected(ra, rb)
        score_a = 1.0 if bout.winner == a else 0.0

        weight = _method_weight(bout.method)
        if self.finish_bonus and weight > 1.0:
            weight += self.finish_bonus
        decay = self._decay(bout.event_date, reference_date)
        k_a = self._k_for(a) * weight * decay
        k_b = self._k_for(b) * weight * decay

        delta = score_a - expected_a
        self.ratings[a] = ra + k_a * delta
        self.ratings[b] = rb - k_b * delta

        self.bouts[a] = self.bouts.get(a, 0) + 1
        self.bouts[b] = self.bouts.get(b, 0) + 1
        if score_a == 1.0:
            self.wins[a] = self.wins.get(a, 0) + 1
            self.losses[b] = self.losses.get(b, 0) + 1
        else:
            self.wins[b] = self.wins.get(b, 0) + 1
            self.losses[a] = self.losses.get(a, 0) + 1

        if bout.event_date:
            self.last_fought[a] = max(self.last_fought.get(a, bout.event_date), bout.event_date)
            self.last_fought[b] = max(self.last_fought.get(b, bout.event_date), bout.event_date)

        self.history.append((bout.event_date or date.today(), a, self.ratings[a]))
        self.history.append((bout.event_date or date.today(), b, self.ratings[b]))

    def fit(
        self,
        bouts: Iterable[BoutResult],
        *,
        decay_from: Optional[date] = None,
    ) -> "FightElo":
        """Fit ratings from completed bouts, oldest first.

        Bouts are sorted by date when a date is known, so the rating trajectory
        is causal. Undated bouts keep their input order and are applied last.

        :param decay_from: reference date for time decay. Defaults to the latest
            bout date, which is what you want for a causal backtest.
        """
        dated: List[BoutResult] = []
        undated: List[BoutResult] = []
        for b in bouts:
            (dated if b.event_date else undated).append(b)

        dated.sort(key=lambda x: x.event_date or date.min)
        reference = decay_from or (dated[-1].event_date if dated else None)

        for bout in dated:
            self.update(bout, reference_date=reference)
        for bout in undated:
            self.update(bout, reference_date=reference)
        return self

    # -- evaluation ------------------------------------------------------- #

    def backtest(
        self,
        bouts: Iterable[BoutResult],
        *,
        folds: int = 5,
        min_train: int = 50,
    ) -> Backtest:
        """Walk-forward evaluation.

        Ratings are fitted only on bouts *before* the fold, then used to predict
        the fold. This is the only honest way to report accuracy: fitting on the
        whole set and scoring it would leak the future into the past.
        """
        rows = sorted(
            [b for b in bouts if b.decided and b.event_date],
            key=lambda x: x.event_date or date.min,
        )
        if len(rows) < min_train + folds:
            raise ValueError(
                f"need at least {min_train + folds} dated, decided bouts to backtest; got {len(rows)}"
            )

        test_size = max(1, (len(rows) - min_train) // folds)
        correct = 0
        total = 0
        log_loss = 0.0
        brier = 0.0
        fold_acc: List[float] = []

        # Experience baseline: pick the fighter with more recorded bouts.
        base_correct = 0
        base_total = 0

        for fold in range(folds):
            split = min_train + fold * test_size
            train, test = rows[:split], rows[split : split + test_size]
            if not test:
                break

            model = self._fresh()
            model.fit(train, decay_from=train[-1].event_date)

            fold_correct = 0
            for bout in test:
                p = model.predict(bout.fighter_a, bout.fighter_b).p_a
                outcome = 1.0 if bout.winner == bout.fighter_a else 0.0

                if (p >= 0.5) == (outcome == 1.0):
                    correct += 1
                    fold_correct += 1
                total += 1

                eps = 1e-15
                pc = min(max(p, eps), 1 - eps)
                log_loss -= outcome * math.log(pc) + (1 - outcome) * math.log(1 - pc)
                brier += (pc - outcome) ** 2

                n_a = model.bouts.get(bout.fighter_a, 0)
                n_b = model.bouts.get(bout.fighter_b, 0)
                if n_a != n_b:
                    predicted = bout.fighter_a if n_a > n_b else bout.fighter_b
                    if predicted == bout.winner:
                        base_correct += 1
                    base_total += 1

            if test:
                fold_acc.append(fold_correct / len(test))

        return Backtest(
            n=total,
            correct=correct,
            log_loss=log_loss / total if total else 0.0,
            brier=brier / total if total else 0.0,
            baseline_accuracy=base_correct / base_total if base_total else 0.0,
            fold_accuracy=fold_acc,
        )

    def _fresh(self) -> "FightElo":
        """A new engine with the same hyperparameters but no fitted state."""
        return FightElo(
            k=self.k,
            scale=self.scale,
            halflife_days=self.halflife_days,
            finish_bonus=self.finish_bonus,
            provisional_bouts=self.provisional_bouts,
            default_rating=self.default_rating,
        )

    # -- tuning ----------------------------------------------------------- #

    def tune(
        self,
        bouts: Sequence[BoutResult],
        *,
        k_values: Sequence[float] = (16, 24, 32, 40, 48),
        halflives: Sequence[float] = (180, 365, 540, 730, 100000),
    ) -> List[Tuple[float, float, float, float]]:
        """Grid-search ``k`` and ``halflife_days`` by walk-forward log loss.

        Returns ``(k, halflife, accuracy, log_loss)`` sorted best-first. Use this
        to justify your parameters rather than picking them by feel.
        """
        results: List[Tuple[float, float, float, float]] = []
        for k in k_values:
            for hl in halflives:
                model = FightElo(
                    k=k,
                    scale=self.scale,
                    halflife_days=hl,
                    finish_bonus=self.finish_bonus,
                    provisional_bouts=self.provisional_bouts,
                )
                try:
                    bt = model.backtest(bouts)
                except ValueError:
                    continue
                results.append((k, hl, bt.accuracy, bt.log_loss))
        results.sort(key=lambda r: r[3])
        return results


# --------------------------------------------------------------------------- #
# sources
# --------------------------------------------------------------------------- #


def from_api(
    api_key: Optional[str] = None,
    *,
    max_events: int = 60,
    base_url: str = "https://api.citoapi.com/api/v1",
) -> List[BoutResult]:
    """Pull completed bouts straight from the Cito UFC API.

    Requires the optional extra: ``pip install "cito-fight-elo[api]"``.

    Each event card is one request, so ``max_events=60`` costs about 62 calls —
    comfortably inside the free tier of 500/month.
    """
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            'pulling from the API needs httpx: pip install "cito-fight-elo[api]"'
        ) from exc

    import os

    key = api_key or os.environ.get("CITO_API_KEY") or os.environ.get("UFCAPI_KEY")
    if not key:
        raise ValueError("No API key. Pass api_key= or set CITO_API_KEY.")

    out: List[BoutResult] = []
    with httpx.Client(
        base_url=base_url, headers={"x-api-key": key, "accept": "application/json"}, timeout=30.0
    ) as client:
        page = 1
        events: List[Dict[str, Any]] = []
        while len(events) < max_events:
            res = client.get("/ufc/events", params={"page": page, "limit": 50, "hasStats": "true"})
            res.raise_for_status()
            body = res.json()
            rows = body.get("data") or []
            if not rows:
                break
            events.extend(rows)
            meta = body.get("meta") or {}
            if not meta.get("hasNextPage"):
                break
            page += 1

        for ev in events[:max_events]:
            slug = ev.get("slug")
            if not slug:
                continue
            res = client.get(f"/ufc/events/{slug}/bouts")
            if res.status_code != 200:
                continue
            for bout in res.json().get("data") or []:
                row = dict(bout)
                row.setdefault("event_date", ev.get("eventDate"))
                parsed = BoutResult.from_dict(row)
                if parsed.fighter_a and parsed.fighter_b:
                    out.append(parsed)
    return out


def from_dataset(path: str) -> List[BoutResult]:
    """Load bouts from a round-statistics JSONL file.

    The dataset is one row per fighter per round, so rows are de-duplicated by
    bout id. Works with the Cito round-statistics dataset:

    https://huggingface.co/datasets/aidancoit9203/ufc-round-stats
    """
    import json
    from pathlib import Path

    seen: Dict[str, BoutResult] = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        bout = BoutResult.from_dict(row)
        if not (bout.fighter_a and bout.fighter_b):
            continue
        key = bout.bout_id or f"{bout.fighter_a}|{bout.fighter_b}|{bout.event_date}"
        seen.setdefault(key, bout)
    return list(seen.values())


__all__ = [
    "Backtest",
    "BoutResult",
    "FightElo",
    "Prediction",
    "from_api",
    "from_dataset",
    "__version__",
]
