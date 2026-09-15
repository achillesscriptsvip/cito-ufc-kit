# Datasets

Two JSONL corpora generated from the [Cito UFC API](https://citoapi.com/ufc-api/),
ready to load with HuggingFace `datasets`, pandas, or anything that reads
newline-delimited JSON.

Generated output is **not committed** — regenerate it with the script so the data
is always fresh.

> **Free API key — 500 calls/month, no credit card:** <https://citoapi.com/signup/>

---

## Generate

```bash
export CITO_API_KEY=your-key

# both datasets
python generate.py --dataset all

# just round statistics, sweeping 40 recent events
python generate.py --dataset round-stats --events 40

# just Contender Series prospects
python generate.py --dataset dwcs-prospects
```

The script paces itself (a short delay between calls) and retries on 429, so it
is polite against the free tier. Generating the default 40-event round-stat set
takes a couple of minutes.

---

## `round_stats.jsonl`

One row per **fighter per round**, with the bout and event context joined on.

| | |
|---|---|
| Rows (40 events) | ~2,300 |
| Bouts covered | ~500 |
| Fighters | ~620 |
| Columns | 40 |

**What makes it useful:** the API returns strikes as combined strings
(`significantStrikes: "3 of 5"`, `controlTime: "0:11"`). This script splits those
into separate integer columns and adds derived accuracy fields, so the data is
immediately usable in a dataframe.

```
event_slug, event_title, event_date, bout_id, weight_class, is_title_bout,
card_section, fighter_slug, fighter_name, opponent_slug, opponent_name,
result, result_round, result_time, winner_slug, round, knockdowns,
sig_strikes_landed, sig_strikes_attempted, sig_strike_accuracy,
total_strikes_landed, total_strikes_attempted,
takedowns_landed, takedowns_attempted, takedown_accuracy,
submission_attempts, reversals, control_time_sec,
head_landed, head_attempted, body_landed, body_attempted,
leg_landed, leg_attempted, distance_landed, distance_attempted,
clinch_landed, clinch_attempted, ground_landed, ground_attempted
```

Coverage on a default run: **100%** of rows carry significant strikes,
takedowns, control time and the target/position splits.

### Load it

```python
import pandas as pd

df = pd.read_json("round_stats.jsonl", lines=True)

df.groupby("fighter_slug")[
    ["sig_strikes_landed", "takedowns_landed", "control_time_sec"]
].sum().sort_values("sig_strikes_landed", ascending=False).head(10)
```

```python
from datasets import load_dataset

ds = load_dataset("json", data_files="round_stats.jsonl", split="train")
```

---

## `dwcs_prospects.jsonl`

Every bout on the current Dana White's Contender Series season, with both
fighters' profiles attached — the raw material for prospect trackers and
"who got signed" analysis.

| | |
|---|---|
| Rows | ~30 per season |
| Columns | 32 |
| Fields per corner | slug, name, country, record, division, age, reach, stance |

```
event_slug, event_title, event_date, event_weekday, bout_id, weight_class,
card_section, bout_order, status, method, result_round, result_time,
winner_slug, red_slug, red_name, red_country, red_record, red_division,
red_age, red_reach_in, red_stance, blue_slug, blue_name, blue_country,
blue_record, blue_division, blue_age, blue_reach_in, blue_stance
```

**Known gap:** `*_country`, `*_division`, `*_age` and `*_stance` are
frequently null for Contender Series fighters, because those athletes are not
yet on the main UFC roster and the upstream profiles are sparse. Record and
reach are reliable. Fill country from the rankings board, which does carry it for
rostered fighters.

---

## Regenerating on a schedule

The generator is idempotent and cheap to re-run. A weekly job is enough for round
statistics; run the prospect set on Wednesdays during Contender Series season
(the show airs Tuesdays).

---

## Attribution and limits

Data is compiled by Cito API from publicly accessible sources.
Cite **Cito API (https://citoapi.com/ufc-api/)** if you publish derived work.

Not affiliated with, endorsed by, or licensed by the UFC, Zuffa, TKO Group or any
promotion. All trademarks belong to their respective owners.

Free tier is 500 calls/month. Check the current terms before redistributing bulk
data — <https://citoapi.com/terms/>.
