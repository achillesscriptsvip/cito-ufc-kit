---
title: UFC Rankings
emoji: 🏆
colorFrom: gray
colorTo: blue
sdk: static
pinned: false
license: mit
short_description: Every UFC division, media and Meta boards
tags:
  - ufc
  - mma
  - rankings
  - sports
  - fight-data
---

# UFC Rankings

Current UFC divisional rankings for **every weight class**, on both boards:

- **Media panel** — the media vote, typically updated Tuesdays
- **Meta** — the algorithmic board, typically updated Mondays

Champions are marked `C`. Search by fighter or country, or filter to one division.

Runs entirely in your browser on a baked snapshot of
[Cito UFC API](https://citoapi.com/ufc-api/) data.

## Get the data

Free API key, 500 calls/month, no card: <https://citoapi.com/signup/>

```bash
curl "https://api.citoapi.com/api/v1/ufc/rankings/media/lightweight" \
  -H "x-api-key: $CITO_API_KEY"
```

```python
from ufcapi import UFC

ufc = UFC()
for row in ufc.rankings(system="media", division="lightweight")[:5]:
    print(row.label, row.fighter_name)
```

| Endpoint | What it returns |
|---|---|
| `GET /ufc/rankings/media` | The media-panel board, all divisions |
| `GET /ufc/rankings/media/{division}` | One division, media panel |
| `GET /ufc/rankings/meta` | The algorithmic board |
| `GET /ufc/rankings/meta/{division}` | One division, Meta |

Docs: <https://citoapi.com/docs/api/ufc/> · OpenAPI: <https://citoapi.com/openapi.json>

## More

- [Live fight dashboard](https://huggingface.co/spaces/aidancoit9203/ufc-live-dashboard)
- [UFC round-statistics dataset](https://huggingface.co/datasets/aidancoit9203/ufc-round-stats)
- [SDKs, templates and MCP server](https://github.com/achillesscriptsvip/cito-ufc-kit)

Independent project. Not affiliated with, endorsed by, or licensed by the UFC,
Zuffa, TKO Group Holdings or any promotion.
