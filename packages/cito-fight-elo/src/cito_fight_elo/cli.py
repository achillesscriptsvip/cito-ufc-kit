"""Command line interface.

    fight-elo leaderboard --source dataset --path round_stats.jsonl
    fight-elo predict islam-makhachev ian-machado-garry --path round_stats.jsonl
    fight-elo backtest --path round_stats.jsonl
    fight-elo tune --path round_stats.jsonl
    fight-elo next --path round_stats.jsonl          # predict the next card

The ``--source`` flag picks where bouts come from: ``dataset`` (a JSONL file) or
``api`` (the Cito UFC API, needs CITO_API_KEY).
"""

from __future__ import annotations

import argparse
import sys
from typing import List, Optional

from . import BoutResult, FightElo, from_api, from_dataset


def _load(args: argparse.Namespace) -> List[BoutResult]:
    if args.source == "api":
        return from_api(args.api_key, max_events=args.max_events)
    if not args.path:
        raise SystemExit("--path is required when --source dataset")
    return from_dataset(args.path)


def _build(args: argparse.Namespace, bouts: List[BoutResult]) -> FightElo:
    model = FightElo(
        k=args.k,
        halflife_days=args.halflife,
        provisional_bouts=args.provisional,
    )
    model.fit(bouts)
    return model


def cmd_leaderboard(args: argparse.Namespace) -> int:
    bouts = _load(args)
    model = _build(args, bouts)

    print(f"Fitted on {len(bouts)} bouts across {len(model.ratings)} fighters")
    print(f"k={args.k}  halflife={args.halflife}d\n")
    print(f"{'#':>3}  {'fighter':<28} {'rating':>7}  {'record':>8}")
    print(f"{'-'*3}  {'-'*28} {'-'*7}  {'-'*8}")
    for i, (name, rating, wins, losses) in enumerate(
        model.leaderboard(args.limit, args.min_bouts), 1
    ):
        print(f"{i:>3}  {name[:28]:<28} {rating:>7.1f}  {wins:>3}-{losses:<4}")
    return 0


def cmd_predict(args: argparse.Namespace) -> int:
    bouts = _load(args)
    model = _build(args, bouts)
    p = model.predict(args.fighter_a, args.fighter_b)
    print(p)
    print(
        f"  {p.fighter_a}: rating {p.rating_a:.1f} over {p.bouts_a} bouts\n"
        f"  {p.fighter_b}: rating {p.rating_b:.1f} over {p.bouts_b} bouts\n"
        f"  confidence: {p.confidence:.0%}"
    )
    return 0


def cmd_backtest(args: argparse.Namespace) -> int:
    bouts = _load(args)
    model = FightElo(k=args.k, halflife_days=args.halflife, provisional_bouts=args.provisional)
    bt = model.backtest(bouts, folds=args.folds)
    print(bt.summary())
    if bt.fold_accuracy:
        print("  per fold: " + "  ".join(f"{a:.1%}" for a in bt.fold_accuracy))
    print(
        "  verdict: "
        + (
            "beats the experience baseline"
            if bt.beats_baseline
            else "does NOT beat the experience baseline — not useful yet"
        )
    )
    return 0


def cmd_tune(args: argparse.Namespace) -> int:
    bouts = _load(args)
    model = FightElo(provisional_bouts=args.provisional)
    results = model.tune(bouts)
    if not results:
        print("not enough data to tune")
        return 1
    print(f"{'k':>5}  {'halflife':>9}  {'accuracy':>9}  {'log loss':>9}")
    print(f"{'-'*5}  {'-'*9}  {'-'*9}  {'-'*9}")
    for k, hl, acc, ll in results[:10]:
        hl_text = "none" if hl >= 100000 else f"{int(hl)}d"
        print(f"{k:>5.0f}  {hl_text:>9}  {acc:>9.1%}  {ll:>9.4f}")
    print(f"\nbest: k={results[0][0]:.0f}  halflife={int(results[0][1])}d")
    return 0


def cmd_next(args: argparse.Namespace) -> int:
    """Predict the bouts on the next card."""
    if args.source == "api":
        import httpx
        import os

        key = args.api_key or os.environ.get("CITO_API_KEY")
        if not key:
            raise SystemExit("CITO_API_KEY is required for --source api")
        with httpx.Client(
            base_url="https://api.citoapi.com/api/v1",
            headers={"x-api-key": key, "accept": "application/json"},
            timeout=30.0,
        ) as client:
            events = client.get("/ufc/events/upcoming", params={"limit": 1}).json().get("data") or []
            if not events:
                print("no upcoming events")
                return 1
            ev = events[0]
            card = client.get(f"/ufc/events/{ev['slug']}/bouts").json().get("data") or []
    else:
        raise SystemExit("--source api is required for next (needs the live card)")

    history = _load(argparse.Namespace(**{**vars(args), "source": "api"}))
    model = _build(args, history)

    print(f"{ev.get('title')}  ({ev.get('startsAt', '')[:10]})\n")
    ranked = 0
    for bout in card:
        corners = {
            str(c.get("corner", "")).lower(): c.get("fighterSlug") for c in bout.get("fighters") or []
        }
        a, b = corners.get("red"), corners.get("blue")
        if not a or not b:
            continue
        p = model.predict(a, b)
        known = p.bouts_a + p.bouts_b
        marker = "" if known else "   (no history — coin flip)"
        title = " [TITLE]" if bout.get("titleBout") else ""
        print(
            f"  {p.fighter_a:<24} {p.p_a:>6.1%}  vs  {p.fighter_b:<24} {p.p_b:>6.1%}"
            f"  ({p.rating_a:.0f} v {p.rating_b:.0f}){title}{marker}"
        )
        ranked += 1
    print(f"\n{ranked} bouts with both corners")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    """Parse the CLI, allowing options before or after the subcommand.

    argparse only defines options in one position, and nesting a parent parser's
    actions re-applies their defaults in the subparser, silently wiping values
    parsed earlier. So we parse the subcommand first and then hand the remaining
    tokens (which include any options from either side) to the subparser.
    """
    if argv is None:
        argv = sys.argv[1:]

    commands = {"leaderboard", "predict", "backtest", "tune", "next"}

    root = argparse.ArgumentParser(
        prog="fight-elo",
        description="Fight-Elo: rate UFC fighters and predict fight outcomes.",
        add_help=False,
    )
    root.add_argument("-h", "--help", action="store_true", dest="root_help")
    root.add_argument("--source", choices=["dataset", "api"], default="dataset")
    root.add_argument("--path", help="path to a JSONL bout dataset")
    root.add_argument("--api-key", default=None)
    root.add_argument("--max-events", type=int, default=60)
    root.add_argument("--k", type=float, default=32.0)
    root.add_argument("--halflife", type=float, default=540.0)
    root.add_argument("--provisional", type=int, default=0)
    root.add_argument("--limit", type=int, default=25)
    root.add_argument("--min-bouts", type=int, default=3)
    root.add_argument("--folds", type=int, default=5)

    # Ignore everything after the first recognised command for the root pass.
    head: List[str] = []
    tail: List[str] = []
    found = False
    for token in argv:
        if not found and token in commands:
            found = True
            tail.append(token)
            continue
        (tail if found else head).append(token)

    if not found:
        root.print_help()
        return 1 if argv else 0

    root_ns, _ = root.parse_known_args(head + tail[:1])
    if root_ns.root_help:
        root.print_help()
        return 0

    # The subparser sees the options only — the command token itself is not an
    # argument to it, which is what argparse would otherwise reject.
    cmd = tail[0]
    sub_argv = tail[1:]

    # The subparser also accepts every common flag, so it sees the full tail.
    sub = argparse.ArgumentParser(prog="fight-elo", add_help=False)
    sub.add_argument("--source", choices=["dataset", "api"], default=argparse.SUPPRESS)
    sub.add_argument("--path", default=argparse.SUPPRESS)
    sub.add_argument("--api-key", default=argparse.SUPPRESS)
    sub.add_argument("--max-events", type=int, default=argparse.SUPPRESS)
    sub.add_argument("--k", type=float, default=argparse.SUPPRESS)
    sub.add_argument("--halflife", type=float, default=argparse.SUPPRESS)
    sub.add_argument("--provisional", type=int, default=argparse.SUPPRESS)
    sub.add_argument("--limit", type=int, default=argparse.SUPPRESS)
    sub.add_argument("--min-bouts", type=int, default=argparse.SUPPRESS)
    sub.add_argument("--folds", type=int, default=argparse.SUPPRESS)
    sub.add_argument("-h", "--help", action="store_true", dest="sub_help")

    if cmd == "predict":
        sub.add_argument("fighter_a")
        sub.add_argument("fighter_b")

    sub_ns, extra = sub.parse_known_args(sub_argv)
    if extra:
        sub.error(f"unrecognized arguments: {' '.join(extra)}")
    if sub_ns.sub_help:
        sub.print_help()
        return 0

    # Subcommand values win; anything it did not set falls back to the root pass.
    merged = argparse.Namespace(**vars(root_ns))
    for key, value in vars(sub_ns).items():
        if key in ("sub_help", "root_help"):
            continue
        setattr(merged, key, value)

    handlers = {
        "leaderboard": cmd_leaderboard,
        "predict": cmd_predict,
        "backtest": cmd_backtest,
        "tune": cmd_tune,
        "next": cmd_next,
    }
    return handlers[cmd](merged)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
