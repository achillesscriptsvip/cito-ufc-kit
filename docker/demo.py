#!/usr/bin/env python3
"""
Cito UFC API — container demo.

Fetches a handful of real endpoints and prints them, so you can see the shape of
the data in one command. Deliberately dependency-light (httpx only) and
read-only.

    docker run --rm -e CITO_API_KEY=your-key citoapi/ufc-api-demo

Free key (500 calls/month, no card): https://citoapi.com/signup/
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional

import httpx

BASE = os.environ.get("CITO_API_BASE_URL", "https://api.citoapi.com/api/v1")
KEY = os.environ.get("CITO_API_KEY") or os.environ.get("UFCAPI_KEY")

BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"
RESET = "\033[0m"


def heading(text: str) -> None:
    print(f"\n{BOLD}{CYAN}{text}{RESET}")
    print(f"{DIM}{'-' * len(text)}{RESET}")


def die(msg: str) -> None:
    print(f"\n\033[31m{msg}{RESET}\n", file=sys.stderr)
    print("Get a free API key (500 calls/month, no card):")
    print("  https://citoapi.com/signup/\n", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    if not KEY:
        die("No API key. Pass one with -e CITO_API_KEY=your-key")

    client = httpx.Client(
        base_url=BASE,
        headers={"x-api-key": KEY, "accept": "application/json"},
        timeout=30.0,
    )

    def get(path: str, **params: Any) -> Any:
        r = client.get(path, params={k: v for k, v in params.items() if v is not None} or None)
        if r.status_code in (401, 403):
            die(f"API key rejected (HTTP {r.status_code}). Check CITO_API_KEY.")
        r.raise_for_status()
        body = r.json()
        return body.get("data") if isinstance(body, dict) and "data" in body else body

    print(f"{BOLD}Cito UFC API — demo{RESET}")
    print(f"{DIM}{BASE}{RESET}")

    # ---------------------------------------------------------------- coverage
    heading("Coverage")
    try:
        overview = get("/ufc")
        cov = overview.get("coverage", {}) if isinstance(overview, dict) else {}
        for label, key in (
            ("Fighters", "fighters"),
            ("Active fighters", "activeFighters"),
            ("Events", "events"),
            ("Completed events", "completedEvents"),
            ("Bouts", "bouts"),
            ("Bout stat rows", "boutStats"),
            ("Round stat rows", "roundStats"),
            ("Ranking rows", "rankings"),
        ):
            if key in cov:
                print(f"  {label:22} {cov[key]:>8,}")
    except httpx.HTTPError as exc:
        print(f"  unavailable: {exc}")

    # ------------------------------------------------------------- next event
    event_slug: Optional[str] = None
    heading("Next card")
    try:
        events: List[Dict[str, Any]] = get("/ufc/events/upcoming") or []
        if events:
            ev = events[0]
            event_slug = ev.get("slug")
            print(f"  {BOLD}{ev.get('title')}{RESET}")
            print(f"  {ev.get('startsAt')}   {ev.get('locationText') or ev.get('venue') or ''}")
            print(f"  {DIM}slug: {event_slug}{RESET}")
        else:
            print("  no upcoming events")
    except httpx.HTTPError as exc:
        print(f"  unavailable: {exc}")

    # --------------------------------------------------------------- fight card
    if event_slug:
        heading("Fight card")
        try:
            bouts: List[Dict[str, Any]] = get(f"/ufc/events/{event_slug}/bouts") or []
            for bout in bouts:
                corners = {
                    (f.get("corner") or "").lower(): f.get("fighterName")
                    for f in (bout.get("fighters") or [])
                }
                red = corners.get("red") or "TBD"
                blue = corners.get("blue") or "TBD"
                tag = bout.get("weightClass") or ""
                if bout.get("titleBout"):
                    tag = f"TITLE — {tag}"
                if bout.get("status") == "completed" and bout.get("method"):
                    tag = f"{bout.get('method')} R{bout.get('resultRound')} {bout.get('resultTime')}"
                print(f"  {red:<26} vs {blue:<26} {DIM}{tag}{RESET}")
        except httpx.HTTPError as exc:
            print(f"  unavailable: {exc}")

        heading("Odds (where coverage exists)")
        try:
            odds = get(f"/ufc/events/{event_slug}/odds", bookmaker="all")
            markets = (odds or {}).get("markets") or []
            if not markets:
                print(f"  {DIM}no markets published for this card yet{RESET}")
                print(f"  {DIM}(an empty result is a normal coverage state, not an error){RESET}")
            for market in markets[:3]:
                print(f"  {market.get('name') or market.get('key')}")
                for outcome in (market.get("outcomes") or [])[:4]:
                    price = outcome.get("decimalOdds") or outcome.get("price")
                    print(
                        f"      {outcome.get('name'):<26} "
                        f"{price}  {DIM}{outcome.get('bookmaker') or ''}{RESET}"
                    )
        except httpx.HTTPError as exc:
            print(f"  unavailable: {exc}")

    # ---------------------------------------------------------------- champions
    heading("Champions")
    try:
        rows: List[Dict[str, Any]] = get("/ufc/rankings/media") or []
        champs = [r for r in rows if r.get("isChampion") or (r.get("rankText") or "").upper() == "C"]
        for row in champs:
            print(f"  {row.get('division'):<24} {row.get('fighterName')}")
        if not champs:
            print(f"  {DIM}none found on the current board{RESET}")
    except httpx.HTTPError as exc:
        print(f"  unavailable: {exc}")

    # --------------------------------------------------------------- live feed
    heading("Live feed")
    try:
        health = get("/ufc/live/health") or {}
        ok = health.get("ok")
        mark = "\033[32mOK\033[0m" if ok else "\033[33mDEGRADED\033[0m"
        print(f"  worker: {mark}")
        lag = health.get("freshestHeartbeatLagSeconds")
        if lag is not None:
            print(f"  lag:    {round(float(lag))}s")
        note = health.get("emptyReason") or health.get("degradedReason")
        if note:
            print(f"  {DIM}note:   {note}{RESET}")
    except httpx.HTTPError as exc:
        print(f"  unavailable: {exc}")

    print(f"\n{BOLD}That's the API.{RESET}")
    print("Docs      https://citoapi.com/docs/api/ufc/")
    print("Python    pip install ufcapi")
    print("Node      npm install cito-ufc")
    print("Agents    npx cito-ufc-mcp")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
