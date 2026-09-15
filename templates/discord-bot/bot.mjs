#!/usr/bin/env node
/**
 * UFC Discord bot — posts the next card, then live fight updates.
 *
 * Two modes:
 *   card  — post the upcoming card (or the most recent results)
 *   live  — follow a live card and post round-by-round updates
 *
 * No Discord library needed: Discord webhooks are plain HTTP POSTs, which keeps
 * this to a single dependency and makes it trivial to run anywhere.
 *
 * Setup:
 *   1. In Discord: Channel settings -> Integrations -> Webhooks -> New Webhook
 *   2. Copy the webhook URL
 *   3. Create .env.local:
 *        CITO_API_KEY=your-key
 *        DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
 *   4. npm install && npm start
 *
 * Free API key (500 calls/month, no card): https://citoapi.com/signup/
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UfcClient } from "cito-ufc";

const here = dirname(fileURLToPath(import.meta.url));

/** Minimal .env.local loader so the template has no config dependency. */
function loadEnv() {
  const out = { ...process.env };
  try {
    const text = readFileSync(resolve(here, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !out[m[1]]) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no local env file */
  }
  return out;
}

const env = loadEnv();
const API_KEY = env.CITO_API_KEY;
const WEBHOOK = env.DISCORD_WEBHOOK_URL;

if (!API_KEY) {
  console.error("Missing CITO_API_KEY. Get a free key at https://citoapi.com/signup/");
  process.exit(1);
}
if (!WEBHOOK) {
  console.error("Missing DISCORD_WEBHOOK_URL. Create a channel webhook in Discord first.");
  process.exit(1);
}

const ufc = new UfcClient({ apiKey: API_KEY });

// ---- Discord ------------------------------------------------------------- //

/** Discord caps content at 2000 chars and embeds at 10 fields. */
async function post(payload) {
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord rejected the message: HTTP ${res.status} ${await res.text()}`);
  }
  // Respect Discord's rate limit.
  await new Promise((r) => setTimeout(r, 400));
}

function fmtDate(iso) {
  if (!iso) return "TBD";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function corner(bout, side) {
  const f = bout.fighters?.find((x) => (x.corner ?? "").toLowerCase() === side);
  return f?.fighterName ?? f?.fighterSlug ?? "TBD";
}

// ---- card poster --------------------------------------------------------- //

async function postCard({ results = false } = {}) {
  const events = results ? await ufc.recentEvents(1) : await ufc.upcomingEvents(1);
  const event = events[0];
  if (!event) {
    console.log("  no event found");
    return;
  }

  const card = await ufc.fightCard(event.slug);
  const mains = card.filter((b) => (b.cardSection ?? "").toLowerCase().includes("main"));
  const prelims = card.filter((b) => !mains.includes(b));

  const fields = [];

  if (mains.length) {
    fields.push({
      name: "Main card",
      value: mains
        .slice(0, 6)
        .map((b) => {
          const line = `**${corner(b, "red")}** vs **${corner(b, "blue")}**`;
          const extra = b.titleBout ? " 🏆" : "";
          return `${line}${extra}`;
        })
        .join("\n")
        .slice(0, 1024),
    });
  }

  if (prelims.length) {
    fields.push({
      name: "Prelims",
      value: prelims
        .slice(0, 8)
        .map((b) => `${corner(b, "red")} vs ${corner(b, "blue")}`)
        .join("\n")
        .slice(0, 1024),
    });
  }

  await post({
    username: "UFC API",
    embeds: [
      {
        title: results ? `Results: ${event.title}` : `Next card: ${event.title}`,
        description: [
          fmtDate(event.startsAt),
          event.locationText ?? event.venue ?? "",
          `${card.length} bouts`,
        ]
          .filter(Boolean)
          .join("\n"),
        color: 0x00e5cc,
        fields,
        footer: { text: "Data: Cito UFC API · citoapi.com" },
      },
    ],
  });

  console.log(`  posted ${results ? "results" : "card"}: ${event.title} (${card.length} bouts)`);
}

// ---- live tracker -------------------------------------------------------- //

async function trackLive() {
  const events = await ufc.upcomingEvents(5);
  if (!events.length) {
    console.log("  no upcoming events to track");
    return;
  }

  for (const event of events) {
    const card = await ufc.fightCard(event.slug);
    const main = card[0];
    if (!main?.id) continue;

    console.log(`  watching ${event.title} / bout ${main.id}`);

    const seen = new Map();
    for (;;) {
      let state;
      try {
        state = await ufc.liveState(main.id);
      } catch {
        await new Promise((r) => setTimeout(r, 20_000));
        continue;
      }

      if (state?.status === "live" || state?.currentRound) {
        const red = state.liveStats?.red;
        const blue = state.liveStats?.blue;
        const key = `${state.currentRound}:${state.currentTime}`;
        if (!seen.has(key)) {
          seen.set(key, true);
          await post({
            username: "UFC API",
            embeds: [
              {
                title: `${event.title} — Round ${state.currentRound}`,
                description: `**${corner(main, "red")}** vs **${corner(main, "blue")}**\nClock: ${state.currentTime ?? "—"}`,
                color: 0xff3b3b,
                fields: [
                  {
                    name: corner(main, "red"),
                    value: `Sig strikes: **${red?.sigStrikes ?? 0}**\nTakedowns: **${red?.takedowns ?? 0}**`,
                    inline: true,
                  },
                  {
                    name: corner(main, "blue"),
                    value: `Sig strikes: **${blue?.sigStrikes ?? 0}**\nTakedowns: **${blue?.takedowns ?? 0}**`,
                    inline: true,
                  },
                ],
                footer: { text: "Live · Cito UFC API" },
              },
            ],
          });
          console.log(`  R${state.currentRound} ${state.currentTime}`);
        }
      }

      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

// ---- entry --------------------------------------------------------------- //

const args = process.argv.slice(2);
const once = args.includes("--once");
const mode = args.find((a) => !a.startsWith("--")) ?? "card";

try {
  if (mode === "card") {
    await postCard();
  } else if (mode === "results") {
    await postCard({ results: true });
  } else if (mode === "live") {
    if (once) {
      console.log("  --once with live mode just checks the feed:");
      const events = await ufc.upcomingEvents(1);
      if (events[0]) {
        const card = await ufc.fightCard(events[0].slug);
        console.log(`  ${events[0].title}: ${card.length} bouts, main id ${card[0]?.id}`);
      }
    } else {
      await trackLive();
    }
  } else {
    console.error(`Unknown mode: ${mode}. Use card | results | live`);
    process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
