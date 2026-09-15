---
title: UFC Live Fight Data
emoji: 🥊
colorFrom: red
colorTo: gray
sdk: static
pinned: false
license: mit
short_description: Live UFC cards, stats, rankings and odds
tags:
  - ufc
  - mma
  - sports
  - fight-data
  - api
  - live-data
---

# UFC Live Fight Data

An interactive UFC dashboard running entirely in your browser, built on the
[Cito UFC API](https://citoapi.com/ufc-api/).

Bring your own key — free, 500 calls/month, no card:
**https://citoapi.com/signup/**

Your key is kept in your browser's local storage and sent only to
`api.citoapi.com`. Nothing is proxied through this Space.

## What it shows

- **Next card** — every bout, card order, title fights flagged
- **Recent results** — winner, method, round, time
- **Rankings** — any division, media or Meta board, champions marked
- **Live fight night** — in-round clock, strikes and takedowns over WebSocket

## Run it yourself

```bash
pip install ufcapi
```

```python
from ufcapi import UFC

ufc = UFC()                       # reads CITO_API_KEY
print(ufc.next_event().title)

last = ufc.last_fight("islam-makhachev")
print(last.summary)
# Islam Makhachev beat Ian Machado Garry (Decision - Unanimous R5 5:00)
```

```bash
npm install cito-ufc
npx -y cito-ufc-mcp     # use it from ChatGPT, Claude, Cursor
```

SDKs, starter templates and the MCP server:
**https://github.com/achillesscriptsvip/cito-ufc-kit**

## Not affiliated

Independent project. Not affiliated with, endorsed by, or licensed by the UFC,
Zuffa, TKO Group Holdings or any promotion. Odds data, where shown, is
third-party market data for research, media and display — not for betting
settlement.
