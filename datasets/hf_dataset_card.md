---
license: mit
language:
  - en
pretty_name: UFC Round Statistics
size_categories:
  - 1K<n<10K
task_categories:
  - tabular-classification
  - tabular-regression
tags:
  - sports
  - mma
  - ufc
  - fight-data
  - combat-sports
  - statistics
  - tabular
configs:
  - config_name: round_stats
    data_files: round_stats.jsonl
    default: true
  - config_name: dwcs_prospects
    data_files: dwcs_prospects.jsonl
---

# UFC Round Statistics

Round-by-round striking and grappling statistics from the **UFC**, one row per
fighter per round, with the bout and event context joined on.

Generated from the [Cito UFC API](https://citoapi.com/ufc-api/) — a self-serve
UFC and MMA data API. Regenerate any time with the script included in this repo;
the corpora are derived from public fight data, not scraped by consumers.

## What's inside

| Config | Rows | Grain | What it is |
|---|---|---|---|
| `round_stats` | ~2,300 | fighter × round | Strikes, takedowns, control time with target and position splits |
| `dwcs_prospects` | ~30 | bout | Dana White's Contender Series bouts with both fighters' profiles |

The `round_stats` set covers ~500 bouts and ~620 fighters across 40 recent
events.

## Why this dataset is useful

The upstream API returns strikes as combined strings (`"3 of 5"`) and control
time as a clock (`"0:11"`). This dataset splits those into clean integer columns
and adds derived accuracy fields, so it loads straight into a dataframe with no
parsing work:

- `sig_strikes_landed`, `sig_strikes_attempted`, `sig_strike_accuracy`
- `takedowns_landed`, `takedowns_attempted`, `takedown_accuracy`
- `control_time_sec`
- Target splits: `head_*`, `body_*`, `leg_*`
- Position splits: `distance_*`, `clinch_*`, `ground_*`

## Schema — `round_stats`

| Column | Type | Notes |
|---|---|---|
| `event_slug`, `event_title`, `event_date` | string | Event identity |
| `bout_id` | string | Join key to a bout |
| `weight_class`, `is_title_bout`, `card_section` | string/bool | Bout context |
| `fighter_slug`, `fighter_name` | string | The fighter this row describes |
| `opponent_slug`, `opponent_name` | string | The other corner |
| `result` | string | Finish method, e.g. `"Submission"`, `"KO/TKO"` |
| `result_round`, `result_time` | int/string | When it ended |
| `winner_slug` | string | Winner's slug |
| `round` | int | Round number |
| `knockdowns` | int | |
| `sig_strikes_landed` / `_attempted` / `sig_strike_accuracy` | int/float | Significant strikes |
| `total_strikes_landed` / `_attempted` | int | All strikes |
| `takedowns_landed` / `_attempted` / `takedown_accuracy` | int/float | |
| `submission_attempts`, `reversals` | int | |
| `control_time_sec` | int | Parsed from `"M:SS"` |
| `head_landed` / `head_attempted` | int | Target split |
| `body_landed` / `body_attempted` | int | Target split |
| `leg_landed` / `leg_attempted` | int | Target split |
| `distance_landed` / `distance_attempted` | int | Position split |
| `clinch_landed` / `clinch_attempted` | int | Position split |
| `ground_landed` / `ground_attempted` | int | Position split |

## Load it

```python
from datasets import load_dataset

ds = load_dataset("aidancoit9203/ufc-round-stats", "round_stats", split="train")
print(ds[0])

prospects = load_dataset("aidancoit9203/ufc-round-stats", "dwcs_prospects", split="train")
```

```python
import pandas as pd
df = pd.read_json("hf://datasets/aidancoit9203/ufc-round-stats/round_stats.jsonl", lines=True)
```

## Example

Top strikers by significant strikes landed across the covered events:

```python
import pandas as pd
df = pd.read_json("round_stats.jsonl", lines=True)

(df.groupby("fighter_slug")[["sig_strikes_landed", "takedowns_landed", "control_time_sec"]]
   .sum()
   .sort_values("sig_strikes_landed", ascending=False)
   .head(10))
```

## Known limitations

- **`dwcs_prospects` is sparse.** Contender Series fighters are not yet on the
  main UFC roster, so `*_country`, `*_division`, `*_age` and `*_stance` are
  frequently null. Record and reach are reliable.
- `opponent_name` is null for ~2% of round rows where the corner could not be
  matched.
- `sig_strike_accuracy` and `takedown_accuracy` are null when attempts were zero
  (avoids divide-by-zero).
- Coverage reflects recent events, not the full historical catalog. Increase the
  sweep with `--events N`.

## Regenerating

```bash
pip install httpx
export CITO_API_KEY=your-key       # free: https://citoapi.com/signup/
python generate.py --dataset all --events 40
```

Source: <https://github.com/achillesscriptsvip/cito-ufc-kit/tree/master/datasets>

## Attribution

Data compiled by **[Cito API](https://citoapi.com/ufc-api/)** from publicly
accessible sources. If you publish work derived from this dataset, please cite
Cito API and link to <https://citoapi.com/ufc-api/>.

Free API key (500 calls/month, no credit card): <https://citoapi.com/signup/>

## Licence and disclaimer

Released under MIT. This dataset is independent and is **not** affiliated with,
endorsed by, or licensed by the UFC, Zuffa, TKO Group Holdings or any promotion.
All trademarks belong to their respective owners.

Odds data, where present elsewhere in the API, is third-party market data for
research, media and display — not for betting settlement. This dataset contains
no odds.
