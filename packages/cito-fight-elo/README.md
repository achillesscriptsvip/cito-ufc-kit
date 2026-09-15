# cito-fight-elo

**A fight-Elo rating and win-probability engine for UFC and MMA.** Fit ratings from real fight history, predict upcoming bouts, and backtest the accuracy — honestly, walk-forward.

```bash
pip install cito-fight-elo
```

```python
from cito_fight_elo import FightElo, from_dataset

bouts = from_dataset("round_stats.jsonl")     # or from_api()
elo = FightElo().fit(bouts)

print(elo.leaderboard(5))
print(elo.predict("islam-makhachev", "ian-machado-garry"))
# Islam Makhachev 66.7% vs Ian Machado Garry 33.3% (1832 vs 1743)
```

> Data from the [Cito UFC API](https://citoapi.com/ufc-api/) — free key, 500 calls/month, no card: <https://citoapi.com/signup/>

---

## Why another rating system

Search GitHub for "UFC prediction" and you'll find dozens of projects. Nearly all of them share the same problem: **they start by writing a scraper**, and the scraper breaks. Almost none of them backtest honestly.

Standard Elo was built for chess, where every game is identical and every result is binary. Fights are different in three ways, and this engine handles all three:

| Reality | What this engine does |
|---|---|
| A first-round KO is stronger evidence than a split decision | Margin-of-victory weighting per method |
| Form two years ago means less than last month | Exponential time decay with a tunable half-life |
| A debutant has no information; a 25-fight veteran's level is established | Optional provisional K: up to 2× sensitivity until a fighter has *n* bouts |

It also ships a **walk-forward backtest**, because fitting on your whole dataset and then scoring it tells you nothing.

---

## Quickstart

### From a dataset

```python
from cito_fight_elo import FightElo, from_dataset

bouts = from_dataset("round_stats.jsonl")
elo = FightElo(k=32, halflife_days=540).fit(bouts)

for name, rating, wins, losses in elo.leaderboard(10):
    print(f"{rating:7.1f}  {name}  ({wins}-{losses})")
```

### Straight from the API

```python
from cito_fight_elo import FightElo, from_api

bouts = from_api()                 # reads CITO_API_KEY
elo = FightElo().fit(bouts)
```

### Predict a fight

```python
p = elo.predict("islam-makhachev", "ian-machado-garry")
print(p.p_a, p.favourite, f"{p.confidence:.0%} confident")
```

### Backtest it

```python
bt = elo.backtest(bouts, folds=5)
print(bt.summary())
# 450 fights | accuracy 61.3% (baseline 54.2%) | log loss 0.6612 | Brier 0.2318
print("usable" if bt.beats_baseline else "not better than a coin flip yet")
```

`beats_baseline` compares against **always picking the fighter with more recorded bouts** — the dumbest signal that still works. If you don't beat it, the rating isn't earning its keep.

### Tune it, don't guess

```python
for k, halflife, accuracy, log_loss in elo.tune(bouts)[:5]:
    print(f"k={k}  halflife={halflife}d  acc={accuracy:.1%}  logloss={log_loss:.4f}")
```

---

## Command line

```bash
fight-elo leaderboard --path round_stats.jsonl --limit 20
fight-elo predict islam-makhachev ian-machado-garry --path round_stats.jsonl
fight-elo backtest --path round_stats.jsonl
fight-elo tune --path round_stats.jsonl
fight-elo next --source api            # predict every bout on the next card
```

`--source api` pulls live data and needs `CITO_API_KEY`. Add `--provisional 10` to
damp rating swings for fighters with fewer than 10 bouts.

---

## How it works

```
expected_a  = 1 / (1 + 10^((rating_b - rating_a) / scale))
delta       = outcome_a - expected_a
rating_a   += K_a * method_weight * time_decay * delta
rating_b   -= K_b * method_weight * time_decay * delta
```

- **`method_weight`** — finishes `1.15`, unanimous decision `1.00`, split decision `0.90`, draws `0.00`.
- **`time_decay`** — `0.5 ** (age_days / halflife_days)`. Default half-life is 540 days.
- **`K_a`** — with `provisional_bouts=n`, a fighter ramps from 2× K at debut down to 1× at *n* bouts, so early ratings settle quickly.

Ratings start at **1500**. A 400-point gap is roughly a 10:1 edge.

---

## Bring your own data

`BoutResult.from_dict` accepts the field names from both the Cito API (camelCase) and the HuggingFace dataset (snake_case), and understands an API bout row's `fighters[]` corners array:

```python
from cito_fight_elo import BoutResult

BoutResult.from_dict({
    "fighter_a": "islam-makhachev",
    "fighter_b": "ian-machado-garry",
    "winner": "islam-makhachev",
    "event_date": "2026-08-16",
    "method": "Decision - Unanimous",
})
```

Or build them yourself:

```python
BoutResult(fighter_a="a", fighter_b="b", winner="a", event_date=date(2026, 1, 1), method="KO/TKO")
```

---

## What this is not

- **Not betting advice.** It's a rating model. Ratings are not prices, and this does not model the vig or the market.
- **Not a neural network.** It's Elo, deliberately. You can read the whole thing, and it runs in milliseconds with no dependencies.
- **Not fitted on the data it scores.** The backtest is walk-forward; that's the point.

## Honest limitations

- **Draws and no-contests barely move ratings** — they register activity but no decisive result.
- **Missing history means a coin flip.** A debutant has no rating, so both fighters sit at 1500 and the model returns 50%. It reports `bouts_a` / `bouts_b` so you can see this rather than trust it blindly.
- **Weight-class changes aren't modelled.** A fighter moving up in weight is not adjusted for.
- **Short-notice replacements aren't modelled.** The rating is the rating.
- **Small samples are noisy.** Under ~5 bouts a rating is mostly prior.

## License

MIT. Independent project — not affiliated with, endorsed by, or licensed by the UFC, Zuffa, TKO Group Holdings or any promotion.
