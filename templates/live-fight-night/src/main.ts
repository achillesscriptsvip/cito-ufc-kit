/**
 * Live UFC fight-night dashboard.
 *
 * Reads the next card from the Cito UFC API, renders it, and — when a bout is
 * live — streams in-round state over the WebSocket instead of polling.
 *
 * The API key is read from `.env.local` (VITE_CITO_API_KEY) for local
 * development. In production, proxy these calls through your own backend so the
 * key is never shipped to the browser.
 */

import { UfcClient } from "cito-ufc";
import type { Bout, Event, LiveState } from "cito-ufc";
import "./style.css";

const KEY = import.meta.env.VITE_CITO_API_KEY as string | undefined;
const app = document.querySelector<HTMLDivElement>("#app")!;

function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function cornerName(b: Bout, side: "red" | "blue"): string {
  const f = b.fighters?.find((x) => (x.corner ?? "").toLowerCase() === side);
  return f?.fighterName ?? f?.fighterSlug ?? "TBD";
}

function boutTag(b: Bout): string {
  if (b.status === "live") return `<span class="tag live">Live</span>`;
  if (b.status === "completed") {
    const w = b.fighters?.find((f) => f.fighterSlug === b.winnerFighterSlug);
    const how = [b.method, b.resultRound ? `R${b.resultRound}` : null, b.resultTime]
      .filter(Boolean)
      .join(" ");
    return `<span class="tag final">${esc(w?.fighterName ?? "—")} · ${esc(how)}</span>`;
  }
  if (b.titleBout) return `<span class="tag title">Title</span>`;
  return `<span class="tag">${esc(b.weightClass ?? "")}</span>`;
}

function renderError(title: string, detail: string): void {
  app.innerHTML = `
    <div class="top">
      <div class="brand"><span class="dot"></span><h1>UFC Live</h1></div>
    </div>
    <div class="error">
      <strong>${esc(title)}</strong><br /><br />
      ${detail}
    </div>
    <footer>
      <span>Cito UFC API</span>
      <a href="https://citoapi.com/signup/" target="_blank" rel="noopener">Get a free API key</a>
      <a href="https://citoapi.com/docs/api/ufc/" target="_blank" rel="noopener">Docs</a>
    </footer>`;
}

function renderNeedsKey(): void {
  renderError(
    "No API key configured",
    `Create <code>.env.local</code> next to <code>package.json</code> containing:
     <br /><br />
     <code>VITE_CITO_API_KEY=your-key</code>
     <br /><br />
     Don't have one? Get a free key (500 calls/month, no card) at
     <a href="https://citoapi.com/signup/" target="_blank" rel="noopener">citoapi.com/signup</a>.`,
  );
}

function renderShell(event: Event, bouts: Bout[]): void {
  const main = bouts[0];
  const redName = main ? cornerName(main, "red") : "TBD";
  const blueName = main ? cornerName(main, "blue") : "TBD";

  app.innerHTML = `
    <div class="top">
      <div class="brand"><span class="dot"></span><h1>UFC Live</h1></div>
      <div id="status"><span class="pill">Connecting…</span></div>
    </div>

    <div class="event">
      <h2>${esc(event.title)}</h2>
      <div class="meta">
        <span>${esc(fmtDate(event.startsAt))}</span>
        <span>${esc(event.locationText ?? event.venue ?? "")}</span>
        <span>${bouts.length} bouts</span>
      </div>
    </div>

    <div class="live-panel">
      <div class="live-head">
        <h3>Main event</h3>
        <span class="clock" id="clock">—</span>
      </div>
      <div class="stats">
        <div class="corner red">
          <div class="corner-name">${esc(redName)}</div>
          <div class="stat-row"><span class="label">Sig strikes</span><span class="value" id="red-strikes">—</span></div>
          <div class="stat-row"><span class="label">Takedowns</span><span class="value" id="red-td">—</span></div>
        </div>
        <div class="vs">VS</div>
        <div class="corner blue">
          <div class="corner-name">${esc(blueName)}</div>
          <div class="stat-row"><span class="label">Sig strikes</span><span class="value" id="blue-strikes">—</span></div>
          <div class="stat-row"><span class="label">Takedowns</span><span class="value" id="blue-td">—</span></div>
        </div>
      </div>
      <div id="live-note" style="margin-top:16px;color:var(--muted);font-size:13px"></div>
    </div>

    <div class="card-title">Fight card</div>
    <div id="card">
      ${bouts.map(boutRow).join("")}
    </div>

    <footer>
      <span id="lag"></span>
      <a href="https://citoapi.com/signup/" target="_blank" rel="noopener">Get a free API key</a>
      <a href="https://citoapi.com/docs/api/ufc/" target="_blank" rel="noopener">Docs</a>
      <a href="https://github.com/achillesscriptsvip/cito-ufc-kit" target="_blank" rel="noopener">Source</a>
    </footer>`;
}

function boutRow(b: Bout): string {
  const red = cornerName(b, "red");
  const blue = cornerName(b, "blue");
  const isLive = b.status === "live";
  return `
    <div class="bout${isLive ? " is-live" : ""}">
      <div class="fighter">${esc(red)}</div>
      <div class="mid">vs</div>
      <div class="fighter right">${esc(blue)}</div>
      <div>${boutTag(b)}</div>
    </div>`;
}

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function applyLive(state: LiveState): void {
  const round = state.currentRound;
  const time = state.currentTime;
  setText("clock", round ? `R${round} ${time ?? ""}` : (time ?? "—"));

  const stats = state.liveStats ?? {};
  const red = stats.red ?? stats.RED;
  const blue = stats.blue ?? stats.BLUE;

  setText("red-strikes", red?.sigStrikes != null ? String(red.sigStrikes) : "—");
  setText("red-td", red?.takedowns != null ? String(red.takedowns) : "—");
  setText("blue-strikes", blue?.sigStrikes != null ? String(blue.sigStrikes) : "—");
  setText("blue-td", blue?.takedowns != null ? String(blue.takedowns) : "—");

  if (state.lagSeconds != null) setText("lag", `feed lag ${Math.round(state.lagSeconds)}s`);
}

function setStatus(html: string): void {
  const el = document.getElementById("status");
  if (el) el.innerHTML = html;
}

/** Poll the live state of the main event until the card actually goes live. */
async function pollUntilLive(
  ufc: UfcClient,
  boutId: string,
  onLive: (state: LiveState) => void,
): Promise<void> {
  for (;;) {
    try {
      const state = await ufc.liveState(boutId);
      if (state && (state.status === "live" || state.currentRound)) {
        onLive(state);
        setStatus(`<span class="pill live"><span class="blink"></span>Live</span>`);
        return;
      }
    } catch {
      /* not live yet, or no state — keep waiting */
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

async function main(): Promise<void> {
  if (!KEY) {
    renderNeedsKey();
    return;
  }

  const ufc = new UfcClient({ apiKey: KEY });

  let event: Event | null = null;
  try {
    event = await ufc.nextEvent();
  } catch (err) {
    renderError(
      "Could not reach the Cito UFC API",
      `<code>${esc((err as Error).message)}</code><br /><br />
       Check that <code>VITE_CITO_API_KEY</code> is a valid, active key.`,
    );
    return;
  }

  if (!event) {
    renderError("No upcoming events", "The schedule is empty right now. Try again on a fight week.");
    return;
  }

  const eventSlug = event.slug;
  if (!eventSlug) {
    renderError("Event has no slug", "The API returned an event without a slug, which is unexpected.");
    return;
  }

  let bouts: Bout[] = [];
  try {
    bouts = await ufc.fightCard(eventSlug);
  } catch (err) {
    renderError("Could not load the fight card", `<code>${esc((err as Error).message)}</code>`);
    return;
  }

  if (!bouts.length) {
    renderError(
      "Card not announced yet",
      "This event has no bouts published yet. Cards usually fill in closer to fight night.",
    );
    return;
  }

  renderShell(event, bouts);

  const note = document.getElementById("live-note");
  const main = bouts[0];
  const mainId = main?.id;

  if (!mainId) {
    if (note) note.textContent = "Main event has no bout id yet.";
    return;
  }

  // Watch for the card going live, then switch to the WebSocket stream.
  void pollUntilLive(ufc, mainId, (state) => applyLive(state)).then(async () => {
    if (note) note.textContent = "";
    try {
      for await (const frame of ufc.liveStream({ boutId: mainId })) {
        applyLive(frame);
      }
      if (note) note.textContent = "Stream closed.";
      setStatus(`<span class="pill">Ended</span>`);
    } catch (err) {
      if (note) {
        note.textContent = `Stream unavailable (${(err as Error).message}). Falling back to polling.`;
      }
      // Fallback: poll every 15s so the dashboard still updates.
      for (;;) {
        try {
          applyLive(await ufc.liveState(mainId));
        } catch {
          /* keep trying */
        }
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
  });

  if (note) {
    note.textContent = `Waiting for ${event.title} to go live — this page updates automatically.`;
  }
}

void main();
