#!/usr/bin/env python3
"""
Generate UFC datasets from the Cito UFC API.

Produces two datasets as JSONL (one JSON object per line), which is the format
HuggingFace `datasets` and Kaggle both ingest directly:

    round_stats.jsonl       one row per fighter per round, across recent events
    dwcs_prospects.jsonl    every Dana White's Contender Series bout and fighter

Both are derived entirely from public API data. Nothing here is scraped.

Usage:
    export CITO_API_KEY=your-key
    python generate.py --dataset round-stats --events 40
    python generate.py --dataset dwcs-prospects

    # or everything
    python generate.py --dataset all

The API key is read from the environment and never written to output.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

import httpx

BASE = os.environ.get("CITO_API_BASE_URL", "https://api.citoapi.com/api/v1")
OUT = Path(__file__).parent

# Be a good citizen: the free tier is 500 calls/month.
REQUEST_DELAY = 0.25


def client() -> httpx.Client:
    key = os.environ.get("CITO_API_KEY") or os.environ.get("UFCAPI_KEY")
    if not key:
        sys.exit(
            "No API key. Set CITO_API_KEY.\n"
            "Free key (500 calls/month, no card): https://citoapi.com/signup/"
        )
    return httpx.Client(
        base_url=BASE,
        headers={"x-api-key": key, "accept": "application/json"},
        timeout=30.0,
    )


def get(c: httpx.Client, path: str, **params: Any) -> Any:
    clean = {k: v for k, v in params.items() if v is not None}
    for attempt in range(3):
        r = c.get(path, params=clean or None)
        if r.status_code == 429:
            time.sleep(2**attempt)
            continue
        r.raise_for_status()
        body = r.json()
        time.sleep(REQUEST_DELAY)
        return body.get("data") if isinstance(body, dict) and "data" in body else body
    r.raise_for_status()
    return None


def write_jsonl(path: Path, rows: Iterator[Dict[str, Any]]) -> int:
    n = 0
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    return n


# --------------------------------------------------------------------------- #
# dataset 1: round statistics
# --------------------------------------------------------------------------- #


def round_stats_rows(c: httpx.Client, max_events: int) -> Iterator[Dict[str, Any]]:
    """One row per fighter per round, with bout and event context attached."""
    events = get(c, "/ufc/events", page=1, limit=max_events, hasStats=True)
    if not isinstance(events, list):
        return

    for i, ev in enumerate(events, 1):
        slug = ev.get("slug")
        if not slug:
            continue
        print(f"  [{i}/{len(events)}] {ev.get('title')}", flush=True)

        try:
            bouts = get(c, f"/ufc/events/{slug}/bouts")
        except httpx.HTTPError as exc:
            print(f"      skip card: {exc}", flush=True)
            continue
        if not isinstance(bouts, list):
            continue

        for bout in bouts:
            if not bout.get("hasStats"):
                continue
            bout_id = bout.get("id")
            corners = {
                (f.get("corner") or "").lower(): f for f in (bout.get("fighters") or [])
            }
            red = corners.get("red", {})
            blue = corners.get("blue", {})

            try:
                rows = get(c, f"/ufc/bouts/{bout_id}/rounds")
            except httpx.HTTPError:
                continue
            if not isinstance(rows, list):
                continue

            for row in rows:
                pos = (row.get("fighterPosition") or "").lower()
                me = red if pos == "a" else blue if pos == "b" else None
                opp = blue if pos == "a" else red if pos == "b" else None

                yield {
                    "event_slug": slug,
                    "event_title": ev.get("title"),
                    "event_date": ev.get("eventDate"),
                    "bout_id": bout_id,
                    "weight_class": bout.get("weightClass"),
                    "is_title_bout": bout.get("titleBout"),
                    "card_section": bout.get("cardSection"),
                    "fighter_slug": me.get("fighterSlug") if me else row.get("fighterSlug"),
                    "fighter_name": me.get("fighterName") if me else None,
                    "opponent_slug": opp.get("fighterSlug") if opp else None,
                    "opponent_name": opp.get("fighterName") if opp else None,
                    "result": bout.get("method"),
                    "result_round": bout.get("resultRound"),
                    "result_time": bout.get("resultTime"),
                    "winner_slug": bout.get("winnerFighterSlug"),
                    "round": row.get("round"),
                    "knockdowns": row.get("knockdowns"),
                    "sig_strikes_landed": row.get("sigStrikesLanded"),
                    "sig_strikes_attempted": row.get("sigStrikesAttempted"),
                    "total_strikes_landed": row.get("totalStrikesLanded"),
                    "total_strikes_attempted": row.get("totalStrikesAttempted"),
                    "takedowns_landed": row.get("takedownsLanded"),
                    "takedowns_attempted": row.get("takedownsAttempted"),
                    "submission_attempts": row.get("submissionAttempts"),
                    "reversals": row.get("reversals"),
                    "control_time_sec": row.get("controlTimeSec"),
                }


# --------------------------------------------------------------------------- #
# dataset 2: Contender Series prospects
# --------------------------------------------------------------------------- #


def dwcs_rows(c: httpx.Client) -> Iterator[Dict[str, Any]]:
    """Every DWCS bout with both fighters' profiles attached."""
    events: List[Dict[str, Any]] = []
    for scope in ("upcoming", "recent"):
        try:
            got = get(c, f"/ufc/events/{scope}", limit=50)
            if isinstance(got, list):
                events.extend(got)
        except httpx.HTTPError as exc:
            print(f"  skip {scope}: {exc}", flush=True)

    # Archive sweep for older seasons.
    try:
        for page in range(1, 6):
            got = get(c, "/ufc/events", page=page, limit=50)
            if not isinstance(got, list) or not got:
                break
            events.extend(got)
    except httpx.HTTPError as exc:
        print(f"  archive sweep stopped: {exc}", flush=True)

    seen_events: set[str] = set()
    profile_cache: Dict[str, Dict[str, Any]] = {}

    dwcs = [
        e
        for e in events
        if e.get("slug")
        and ("dwcs" in e["slug"].lower() or "contender series" in (e.get("title") or "").lower())
    ]
    print(f"  {len(dwcs)} Contender Series events found", flush=True)

    for i, ev in enumerate(dwcs, 1):
        slug = ev["slug"]
        if slug in seen_events:
            continue
        seen_events.add(slug)
        print(f"  [{i}/{len(dwcs)}] {ev.get('title')}", flush=True)

        try:
            bouts = get(c, f"/ufc/events/{slug}/bouts")
        except httpx.HTTPError:
            continue
        if not isinstance(bouts, list):
            continue

        for bout in bouts:
            corners = {(f.get("corner") or "").lower(): f for f in (bout.get("fighters") or [])}
            red, blue = corners.get("red", {}), corners.get("blue", {})

            def profile(slug_: Optional[str]) -> Dict[str, Any]:
                if not slug_:
                    return {}
                if slug_ not in profile_cache:
                    try:
                        profile_cache[slug_] = get(c, f"/ufc/fighters/{slug_}") or {}
                    except httpx.HTTPError:
                        profile_cache[slug_] = {}
                return profile_cache[slug_]

            pr, pb = profile(red.get("fighterSlug")), profile(blue.get("fighterSlug"))

            yield {
                "event_slug": slug,
                "event_title": ev.get("title"),
                "event_date": ev.get("eventDate"),
                "event_weekday": ev.get("eventWeekday"),
                "bout_id": bout.get("id"),
                "weight_class": bout.get("weightClass"),
                "card_section": bout.get("cardSection"),
                "bout_order": bout.get("boutOrder"),
                "status": bout.get("status"),
                "method": bout.get("method"),
                "result_round": bout.get("resultRound"),
                "result_time": bout.get("resultTime"),
                "winner_slug": bout.get("winnerFighterSlug"),
                "red_slug": red.get("fighterSlug"),
                "red_name": red.get("fighterName"),
                "red_country": pr.get("country"),
                "red_record": (pr.get("record") or {}).get("text"),
                "red_division": pr.get("division"),
                "red_age": pr.get("age"),
                "red_reach_in": pr.get("reachInches"),
                "red_stance": pr.get("stance"),
                "blue_slug": blue.get("fighterSlug"),
                "blue_name": blue.get("fighterName"),
                "blue_country": pb.get("country"),
                "blue_record": (pb.get("record") or {}).get("text"),
                "blue_division": pb.get("division"),
                "blue_age": pb.get("age"),
                "blue_reach_in": pb.get("reachInches"),
                "blue_stance": pb.get("stance"),
            }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dataset",
        choices=["round-stats", "dwcs-prospects", "all"],
        default="all",
    )
    ap.add_argument("--events", type=int, default=40, help="events to sweep for round stats")
    args = ap.parse_args()

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    written = []

    with client() as c:
        if args.dataset in ("round-stats", "all"):
            print("Generating round-stats…")
            path = OUT / "round_stats.jsonl"
            n = write_jsonl(path, round_stats_rows(c, args.events))
            written.append((path, n))

        if args.dataset in ("dwcs-prospects", "all"):
            print("Generating dwcs-prospects…")
            path = OUT / "dwcs_prospects.jsonl"
            n = write_jsonl(path, dwcs_rows(c))
            written.append((path, n))

    print()
    for path, n in written:
        size = path.stat().st_size / 1024
        print(f"  {path.name:26} {n:>7,} rows  {size:>9,.1f} KB")

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Cito UFC API",
        "source_url": "https://citoapi.com/ufc-api/",
        "docs": "https://citoapi.com/docs/api/ufc/",
        "date": stamp,
        "license": "Data derived from public sources. Cite Cito API.",
    }
    (OUT / "dataset_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"\n  wrote dataset_meta.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
