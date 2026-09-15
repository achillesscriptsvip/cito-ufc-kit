---
title: UFC Fight Cards
emoji: 📅
colorFrom: indigo
colorTo: blue
sdk: static
pinned: false
license: mit
short_description: Upcoming UFC cards and recent results
tags:
  - ufc
  - mma
  - fight-cards
  - schedule
  - sports
---

# UFC Fight Cards

Every upcoming UFC card in **card order** — main event first, then the rest of the
main card, prelims and early prelims — plus the most recent results with winner,
method, round and time.

Includes numbered cards, Fight Nights and Dana White's Contender Series, with
title bouts flagged and champions marked.

Runs entirely in your browser on a baked snapshot of
[Cito UFC API](https://citoapi.com/ufc-api/) data.

## Get the data

Free API key, 500 calls/month, no card: <https://citoapi.com/signup/>

```bash
# the forward schedule
curl "https://api.citoapi.com/api/v1/ufc/events/upcoming" \
  -H "x-api-key: $CITO_API_KEY"

# a full card, in card order
curl "https://api.citoapi.com/api/v1/ufc/events/cryptocom-ufc-331/bouts" \
  -H "x-api-key: $CITO_API_KEY"
```

```python
from ufcapi import UFC

ufc = UFC()
event = ufc.next_event()
print(event.title, event.starts_at)

for bout in ufc.bouts_for_event(event.slug):
    print(bout.card_section, "|", bout.matchup)
```

| Endpoint | What it returns |
|---|---|
| `GET /ufc/events/upcoming` | The forward schedule |
| `GET /ufc/events/recent` | Newest completed events |
| `GET /ufc/events/{slug}` | One event with metadata |
| `GET /ufc/events/{slug}/bouts` | The full card, in card order |
| `GET /ufc/events/{slug}/stats` | Bout and round stats for the card |

Docs: <https://citoapi.com/docs/api/ufc/> · OpenAPI: <https://citoapi.com/openapi.json>

## More

- [Live fight dashboard](https://huggingface.co/spaces/aidancoit9203/ufc-live-dashboard)
- [UFC rankings, every division](https://huggingface.co/spaces/aidancoit9203/ufc-rankings)
- [UFC round-statistics dataset](https://huggingface.co/datasets/aidancoit9203/ufc-round-stats)
- [SDKs, templates and MCP server](https://github.com/achillesscriptsvip/cito-ufc-kit)

Independent project. Not affiliated with, endorsed by, or licensed by the UFC,
Zuffa, TKO Group Holdings or any promotion.
