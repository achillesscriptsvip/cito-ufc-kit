/**
 * UFC Live Fight Data — a dashboard that runs entirely in your browser.
 *
 * Built on the Cito UFC API. Your key is stored in localStorage and sent only to
 * api.citoapi.com; nothing is proxied through the Space.
 *
 * Free key, 500 calls/month, no card: https://citoapi.com/signup/
 */

const API = "https://api.citoapi.com/api/v1";
const WS = "wss://api.citoapi.com/api/v1/ufc/live/ws";
const STORE_KEY = "cito_ufc_api_key";

const $ = (id) => document.getElementById(id);
const app = $("app");
const statusEl = $("status");
const keyInput = $("apikey");

let apiKey = null;
let socket = null;
let liveBoutId = null;

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function fmtDate(iso) {
  if (!iso) return "TBD";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function setStatus(text, cls = "") {
  statusEl.className = `pill ${cls}`;
  statusEl.textContent = text;
}

function corner(bout, side) {
  const f = (bout.fighters || []).find((x) => (x.corner || "").toLowerCase() === side);
  return f?.fighterName || f?.fighterSlug || "TBD";
}

async function get(path, params = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { "x-api-key": apiKey, accept: "application/json" } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = body?.error?.code;
    throw err;
  }
  return body && typeof body === "object" && "data" in body ? body.data : body;
}

// --------------------------------------------------------------------------
// renderers
// --------------------------------------------------------------------------

const skeletons = (n = 5) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join("");

function boutTag(b) {
  if (b.status === "live") return '<span class="tag" style="color:#fff;background:var(--live);border-color:var(--live)">Live</span>';
  if (b.status === "completed" && b.method) {
    const who = (b.fighters || []).find((f) => f.fighterSlug === b.winnerFighterSlug);
    const short = (who?.fighterName || "").split(" ").pop() || "—";
    return `<span class="tag final">${esc(short)} · ${esc(b.method)}${b.resultRound ? ` R${b.resultRound}` : ""}</span>`;
  }
  if (b.titleBout) return '<span class="tag title">Title</span>';
  return `<span class="tag">${esc((b.weightClass || "").split(" ")[0])}</span>`;
}

function renderBouts(bouts) {
  if (!bouts.length) return '<div class="empty">No bouts published for this card yet.</div>';
  return bouts
    .map(
      (b) => `
      <div class="bout${b.status === "live" ? " is-live" : ""}">
        <div class="fighter">${esc(corner(b, "red"))}</div>
        <div class="mid">vs</div>
        <div class="fighter right">${esc(corner(b, "blue"))}</div>
        <div>${boutTag(b)}</div>
      </div>`,
    )
    .join("");
}

function renderRankings(rows) {
  if (!rows.length) return '<div class="empty">No ranking rows for this division.</div>';
  return rows
    .map((r) => {
      const isChamp = r.isChampion || (r.rankText || "").toUpperCase() === "C";
      return `
        <div class="rank-row">
          <span class="rank${isChamp ? " champ" : ""}">${esc(isChamp ? "C" : r.rankText ?? r.rank ?? "—")}</span>
          <span>${esc(r.fighterName || r.fighterSlug || "")}</span>
          <span class="country">${esc(r.country || "")}</span>
        </div>`;
    })
    .join("");
}

function renderLive(state) {
  const stats = state?.liveStats || {};
  const red = stats.red || {};
  const blue = stats.blue || {};
  const round = state?.currentRound;
  const clock = round ? `R${round} ${state.currentTime || ""}` : state?.currentTime || "—";

  return `
    <div class="live-grid">
      <div class="corner red">
        <div class="corner-name">Red corner</div>
        <div class="stat-line"><span class="label">Sig strikes</span><span class="value">${red.sigStrikes ?? 0}</span></div>
        <div class="stat-line"><span class="label">Takedowns</span><span class="value">${red.takedowns ?? 0}</span></div>
      </div>
      <div class="clock">${esc(clock)}</div>
      <div class="corner blue">
        <div class="corner-name">Blue corner</div>
        <div class="stat-line"><span class="label">Sig strikes</span><span class="value">${blue.sigStrikes ?? 0}</span></div>
        <div class="stat-line"><span class="label">Takedowns</span><span class="value">${blue.takedowns ?? 0}</span></div>
      </div>
    </div>`;
}

// --------------------------------------------------------------------------
// snapshot (the dashboard renders from this immediately, with no key needed)
// --------------------------------------------------------------------------

async function loadSnapshot() {
  let snap;
  try {
    const res = await fetch("./snapshot.json", { cache: "no-store" });
    if (!res.ok) throw new Error("no snapshot");
    snap = await res.json();
  } catch {
    return false;
  }

  const card = snap.card || [];
  const rankings = snap.rankings || [];
  const divisions = [...new Set(rankings.map((r) => r.normalizedDivision || r.division).filter(Boolean))];
  const firstDiv = divisions.find((d) => /lightweight|heavyweight|featherweight/i.test(d)) || divisions[0] || "";
  const filtered = rankings.filter((r) => (r.normalizedDivision || r.division) === firstDiv);
  const cov = snap.coverage || {};
  const when = snap.generatedAt ? new Date(snap.generatedAt).toLocaleString() : "";

  app.innerHTML = `
    <section class="block">
      <div class="block-title">Next card <span class="sub">snapshot from ${esc(when)}</span></div>
      ${
        snap.event
          ? `<div class="event-head">
               <h2>${esc(snap.event.title)}</h2>
               <div class="meta">
                 <span>${esc(fmtDate(snap.event.startsAt))}</span>
                 <span>${esc(snap.event.locationText || "")}</span>
                 <span>${card.length} bouts</span>
               </div>
             </div>`
          : ""
      }
      ${renderBouts(card)}
    </section>

    ${
      snap.recent
        ? `<section class="block">
             <div class="block-title">Last card · results</div>
             <div class="event-head">
               <h2>${esc(snap.recent.title)}</h2>
               <div class="meta"><span>${esc(fmtDate(snap.recent.startsAt))}</span></div>
             </div>
             ${renderBouts(snap.recent.card || [])}
           </section>`
        : ""
    }

    <section class="block">
      <div class="block-title">Rankings <span class="sub">media panel</span></div>
      <div class="rank-controls">
        <select id="division">
          ${divisions
            .map((d) => `<option value="${esc(d)}"${d === firstDiv ? " selected" : ""}>${esc(d.replace(/-/g, " "))}</option>`)
            .join("")}
        </select>
      </div>
      <div id="ranklist">${renderRankings(filtered)}</div>
    </section>

    ${
      cov.fighters
        ? `<section class="block">
             <div class="block-title">Coverage</div>
             <div class="coverage">
               ${[
                 ["Fighters", cov.fighters],
                 ["Active", cov.activeFighters],
                 ["Events", cov.events],
                 ["Bouts", cov.bouts],
                 ["Round stat rows", cov.roundStats],
               ]
                 .filter(([, v]) => v)
                 .map(
                   ([label, v]) =>
                     `<div class="cov"><span class="cov-n">${Number(v).toLocaleString()}</span><span class="cov-l">${esc(label)}</span></div>`,
                 )
                 .join("")}
             </div>
           </section>`
        : ""
    }

    <section class="block">
      <div class="block-title">Live fight night <span class="sub">WebSocket</span></div>
      <div id="livebox">
        <div class="empty">
          <strong>Live streaming needs a key.</strong>
          <p>
            Paste a free Cito API key above to stream in-round clock, strikes and
            takedowns over a WebSocket when a card is live. The snapshot above
            needs no key.
          </p>
        </div>
      </div>
    </section>`;

  setStatus("Snapshot", "ok");

  const select = $("division");
  select?.addEventListener("change", () => {
    const rows = rankings.filter((r) => (r.normalizedDivision || r.division) === select.value);
    $("ranklist").innerHTML = renderRankings(rows);
  });

  return true;
}

// --------------------------------------------------------------------------
// load (live, with the user's own key)
// --------------------------------------------------------------------------

async function load() {
  app.innerHTML = `
    <section class="block"><div class="block-title">Next card</div>${skeletons(5)}</section>
    <section class="block"><div class="block-title">Rankings</div>${skeletons(6)}</section>`;

  setStatus("Loading…");

  try {
    // Next event + its card
    const upcoming = await get("/ufc/events/upcoming", { limit: 1 });
    const event = upcoming?.[0];

    if (!event?.slug) {
      app.innerHTML = '<div class="empty"><strong>No upcoming events.</strong>Check back on a fight week.</div>';
      setStatus("Connected", "ok");
      return;
    }

    const card = await get(`/ufc/events/${encodeURIComponent(event.slug)}/bouts`);
    const bouts = Array.isArray(card) ? card : [];

    // Rankings
    let rankingRows = [];
    try {
      rankingRows = await get("/ufc/rankings/media", {});
    } catch {
      rankingRows = [];
    }

    const divisions = [...new Set((rankingRows || []).map((r) => r.normalizedDivision || r.division).filter(Boolean))];
    const firstDiv = divisions.find((d) => /lightweight|heavyweight|featherweight/i.test(d)) || divisions[0];
    const filtered = firstDiv
      ? (rankingRows || []).filter((r) => (r.normalizedDivision || r.division) === firstDiv)
      : [];

    app.innerHTML = `
      <section class="block">
        <div class="block-title">Next card</div>
        <div class="event-head">
          <h2>${esc(event.title)}</h2>
          <div class="meta">
            <span>${esc(fmtDate(event.startsAt))}</span>
            <span>${esc(event.locationText || event.venue || "")}</span>
            <span>${bouts.length} bouts</span>
          </div>
        </div>
        ${renderBouts(bouts)}
      </section>

      <section class="block">
        <div class="block-title">
          Rankings
          <span class="sub">media panel</span>
        </div>
        <div class="rank-controls">
          <select id="division">
            ${divisions.map((d) => `<option value="${esc(d)}"${d === firstDiv ? " selected" : ""}>${esc(d.replace(/-/g, " "))}</option>`).join("")}
          </select>
        </div>
        <div id="ranklist">${renderRankings(filtered)}</div>
      </section>

      <section class="block">
        <div class="block-title">Live fight night <span class="sub">WebSocket</span></div>
        <div id="livebox">
          <div class="empty">
            <strong>Not live right now.</strong>
            <p>This panel streams in-round state over a WebSocket from Cito. It fills in automatically when a card is live.</p>
          </div>
        </div>
      </section>`;

    setStatus("Connected", "ok");

    // Division switcher
    const select = $("division");
    select?.addEventListener("change", () => {
      const rows = (rankingRows || []).filter(
        (r) => (r.normalizedDivision || r.division) === select.value,
      );
      $("ranklist").innerHTML = renderRankings(rows);
    });

    // Try to go live
    const main = bouts[0];
    if (main?.id) startWatching(main.id, event.title);
  } catch (err) {
    const hint =
      err.status === 401 || err.status === 403
        ? "That key was rejected. Check it, or grab a fresh free one."
        : err.status === 429
          ? "Rate limit reached — the free tier is 500 calls/month."
          : "Could not reach the Cito UFC API.";
    app.innerHTML = `<div class="err"><strong>${esc(err.message)}</strong>${hint}</div>`;
    setStatus("Error", "");
  }
}

// --------------------------------------------------------------------------
// live
// --------------------------------------------------------------------------

function startWatching(boutId, eventTitle) {
  liveBoutId = boutId;

  const poll = async () => {
    try {
      const state = await get(`/ufc/live/${encodeURIComponent(boutId)}/state`);
      if (state && (state.status === "live" || state.currentRound)) {
        const box = $("livebox");
        if (box) {
          box.innerHTML =
            renderLive(state) +
            `<div class="live-note">${esc(eventTitle)} · updating live</div>`;
        }
        setStatus("Live", "live");
        connectSocket(boutId);
        return true;
      }
    } catch {
      /* not live yet */
    }
    return false;
  };

  (async () => {
    if (await poll()) return;
    // Poll occasionally rather than hammering the API on the free tier.
    const timer = setInterval(async () => {
      if (document.hidden) return;
      if (await poll()) clearInterval(timer);
    }, 30000);
  })();
}

function connectSocket(boutId) {
  if (socket) return;
  try {
    socket = new WebSocket(`${WS}?api_key=${encodeURIComponent(apiKey)}`);
  } catch {
    return;
  }

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ action: "subscribe", rooms: [`bout:${boutId}`] }));
  });

  socket.addEventListener("message", (ev) => {
    let frame;
    try {
      frame = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!frame || ["ready", "subscribed", "pong"].includes(frame.type)) return;
    const box = $("livebox");
    if (box) box.innerHTML = renderLive(frame) + '<div class="live-note">Streaming live via WebSocket</div>';
  });

  socket.addEventListener("close", () => {
    socket = null;
  });
}

// --------------------------------------------------------------------------
// wiring
// --------------------------------------------------------------------------

$("connect").addEventListener("click", () => {
  const value = keyInput.value.trim();
  if (!value) {
    keyInput.focus();
    return;
  }
  apiKey = value;
  try {
    localStorage.setItem(STORE_KEY, value);
  } catch {
    /* private mode */
  }
  keyInput.value = "";
  keyInput.placeholder = "Key saved ✓";
  load();
});

$("forget").addEventListener("click", () => {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
  apiKey = null;
  if (socket) {
    socket.close();
    socket = null;
  }
  keyInput.value = "";
  keyInput.placeholder = "Paste your free Cito API key (cito_…)";
  app.innerHTML =
    '<div class="empty"><strong>Key forgotten.</strong><p>Paste a key to load data again.</p></div>';
  setStatus("Not connected");
});

keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("connect").click();
});

// Restore a saved key on load, otherwise render the baked snapshot.
(async () => {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      apiKey = saved;
      keyInput.placeholder = "Using saved key — paste a new one to replace";
      await load();
      return;
    }
  } catch {
    /* private mode */
  }
  const ok = await loadSnapshot();
  if (!ok) {
    app.innerHTML =
      '<div class="empty"><strong>No snapshot found.</strong><p>Paste a free Cito API key above to load live data.</p></div>';
    setStatus("Not connected");
  }
})();
