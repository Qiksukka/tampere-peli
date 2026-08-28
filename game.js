const PALETTE = [
  "#c57a4a",
  "#6f9a78",
  "#d0a14e",
  "#6a8ea8",
  "#c56d6d",
  "#7e73aa",
  "#4f9b96",
  "#b08968",
  "#9a7a4a",
  "#5d7f6a",
];

const I18N = {
  fi: {
    title: "Tampereen palapeli",
    tagline: "Sijoita kaupunginosa paikalleen",
    start: "Aloita",
    back: "Etusivu",
    lang: "In English",
    drag: "Raahaa palanen kartalle — tai napauta oikeaa aluetta",
    next: "Seuraava",
    placed: "Paikoillaan",
    time: "Aika",
    hint: "Vihje",
    skip: "Ohita",
    wrong: "Ei osunut — kokeile toisaalle",
    done: "Kaikki paikoillaan!",
    again: "Uusi peli",
    source:
      "Kartta: Tampereen kaupungin avoin data (suunnittelualueet ja tilastoalueet), CC BY 4.0.",
    result: (t, misses, hints) =>
      `Aika ${t}. Väärät yritykset ${misses}, vihjeitä ${hints}.`,
  },
  en: {
    title: "Tampere puzzle",
    tagline: "Put each district in its place",
    start: "Play",
    back: "Home",
    lang: "Suomeksi",
    drag: "Drag the piece onto the map — or tap the right area",
    next: "Up next",
    placed: "Placed",
    time: "Time",
    hint: "Hint",
    skip: "Skip",
    wrong: "Not quite — try another spot",
    done: "Every district is home!",
    again: "Play again",
    source:
      "Map: City of Tampere open data (planning and statistical areas), CC BY 4.0.",
    result: (t, misses, hints) =>
      `Time ${t}. Misses ${misses}, hints ${hints}.`,
  },
};

const app = document.getElementById("app");
let data = null;
let lang = navigator.language?.startsWith("fi") ? "fi" : "en";
let t = () => I18N[lang];

const state = {
  screen: "home",
  level: "easy",
  queue: [],
  current: null,
  placed: new Set(),
  startedAt: 0,
  elapsed: 0,
  misses: 0,
  hints: 0,
  timer: null,
  dragging: null,
};

function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function pathBounds(path) {
  const nums = [...path.matchAll(/-?\d*\.?\d+/g)].map(Number);
  const xs = [];
  const ys = [];
  for (let i = 0; i < nums.length; i += 2) {
    xs.push(nums[i]);
    ys.push(nums[i + 1]);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function needle() {
  return `<svg class="needle" viewBox="0 0 18 42" aria-hidden="true">
    <rect x="8" y="2" width="2" height="28" fill="#e2b45a"/>
    <polygon points="4,30 14,30 9,40" fill="#c4452e"/>
    <circle cx="9" cy="6" r="3.2" fill="#f4ead8"/>
  </svg>`;
}

function mapSvg(districts, opts = {}) {
  const [x, y, w, h] = data.viewBox;
  const paths = districts
    .map((d) => {
      const cls = opts.classFor ? opts.classFor(d) : "land";
      const color = opts.fillFor ? opts.fillFor(d) : "";
      const fill = color ? ` fill="${color}"` : "";
      const extra = opts.attrsFor ? opts.attrsFor(d) : "";
      return `<path class="${cls}" d="${d.path}"${fill} data-id="${d.id}" ${extra}><title>${d.name}</title></path>`;
    })
    .join("");
  return `<svg viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Tampere">
    <rect class="water-bg" x="${x}" y="${y}" width="${w}" height="${h}"></rect>
    ${paths}
  </svg>`;
}

function backdropDistricts() {
  return state.level === "hard"
    ? data.levels.hard.districts
    : data.levels.medium.districts;
}

function targetIds() {
  return new Set(data.levels[state.level].districts.map((d) => d.id));
}

function renderHome() {
  const copy = t();
  const poster = data.levels.medium.districts;
  app.innerHTML = `
    <header class="topbar">
      <div class="brand">${needle()}
        <div>
          <h1>${copy.title}</h1>
          <p>${copy.tagline}</p>
        </div>
      </div>
      <div class="spacer"></div>
      <button class="lang" type="button" data-act="lang">${copy.lang}</button>
    </header>
    <section class="home">
      <div class="poster">
        ${mapSvg(poster, { fillFor: (d) => colorFor(d.id), classFor: () => "placed" })}
      </div>
      <div class="menu">
        <div class="levels">
          ${Object.entries(data.levels)
            .map(
              ([id, lvl]) => `
            <button class="level" data-act="play" data-level="${id}">
              <strong>${lvl[lang === "fi" ? "labelFi" : "labelEn"]}</strong>
              <span>${lvl[lang === "fi" ? "blurbFi" : "blurbEn"]} · ${lvl.districts.length}</span>
            </button>`
            )
            .join("")}
        </div>
        <p class="note">${copy.source}</p>
      </div>
    </section>
  `;
}

function startGame(level) {
  state.screen = "game";
  state.level = level;
  state.placed = new Set();
  state.queue = shuffle(data.levels[level].districts);
  state.current = state.queue[0];
  state.startedAt = Date.now();
  state.elapsed = 0;
  state.misses = 0;
  state.hints = 0;
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.elapsed = Date.now() - state.startedAt;
    const el = document.getElementById("clock");
    if (el) el.textContent = fmt(state.elapsed);
  }, 250);
  renderGame();
}

function renderGame() {
  const copy = t();
  const level = data.levels[state.level];
  const total = level.districts.length;
  const current = state.current;
  const bounds = current ? pathBounds(current.path) : { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  const pad = 8;
  const vb = `${bounds.minX - pad} ${bounds.minY - pad} ${
    bounds.maxX - bounds.minX + pad * 2
  } ${bounds.maxY - bounds.minY + pad * 2}`;

  const targets = targetIds();
  const mapDistricts = backdropDistricts();

  app.innerHTML = `
    <header class="game-header">
      <button class="ghost" data-act="home" type="button">${copy.back}</button>
      <span class="stat">${level[lang === "fi" ? "labelFi" : "labelEn"]}</span>
      <span class="stat" id="clock">${fmt(state.elapsed)}</span>
      <span class="stat">${copy.placed} ${state.placed.size}/${total}</span>
      <div class="spacer"></div>
      <button class="lang" data-act="lang" type="button">${copy.lang}</button>
    </header>
    <section class="play">
      <div class="map-wrap" id="map">
        ${mapSvg(mapDistricts, {
          classFor: (d) => {
            if (state.placed.has(d.id)) return "placed";
            if (targets.has(d.id)) return "slot";
            return "land";
          },
          fillFor: (d) => (state.placed.has(d.id) ? colorFor(d.id) : ""),
          attrsFor: (d) => (targets.has(d.id) && !state.placed.has(d.id) ? 'data-slot="1"' : ""),
        })}
      </div>
      <aside class="tray">
        <p class="kicker">${copy.next}</p>
        <h2>${current ? current.name : "—"}</h2>
        <p class="kicker">${copy.drag}</p>
        ${
          current
            ? `<div class="piece" id="piece" title="${current.name}">
                <svg viewBox="${vb}"><path d="${current.path}"></path></svg>
              </div>`
            : ""
        }
        <div class="hint-row">
          <button type="button" data-act="hint">${copy.hint}</button>
        </div>
      </aside>
    </section>
  `;
  bindMap();
}

function bindMap() {
  const map = document.getElementById("map");
  const piece = document.getElementById("piece");
  if (!map) return;

  map.addEventListener("click", (e) => {
    const slot = e.target.closest("[data-slot]");
    if (!slot || !state.current) return;
    tryPlace(slot.dataset.id);
  });

  map.addEventListener("pointermove", (e) => {
    map.querySelectorAll(".is-hot").forEach((n) => n.classList.remove("is-hot"));
    const slot = e.target.closest("[data-slot]");
    if (slot) slot.classList.add("is-hot");
  });

  if (!piece) return;

  piece.addEventListener("pointerdown", (e) => {
    if (!state.current) return;
    e.preventDefault();
    piece.setPointerCapture(e.pointerId);
    const ghost = document.createElement("div");
    ghost.className = "ghost-piece";
    ghost.innerHTML = piece.innerHTML;
    ghost.style.width = "180px";
    document.body.appendChild(ghost);
    state.dragging = { ghost, pointerId: e.pointerId };
    moveGhost(e);
  });

  piece.addEventListener("pointermove", (e) => {
    if (!state.dragging) return;
    moveGhost(e);
  });

  piece.addEventListener("pointerup", (e) => {
    if (!state.dragging) return;
    const { ghost } = state.dragging;
    ghost.remove();
    state.dragging = null;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const slot = under?.closest?.("[data-slot]");
    if (slot) tryPlace(slot.dataset.id);
  });
}

function moveGhost(e) {
  const g = state.dragging?.ghost;
  if (!g) return;
  g.style.left = `${e.clientX - 90}px`;
  g.style.top = `${e.clientY - 90}px`;
}

function tryPlace(id) {
  if (!state.current) return;
  if (id === state.current.id) {
    state.placed.add(id);
    const idx = state.queue.findIndex((d) => d.id === id);
    if (idx >= 0) state.queue.splice(idx, 1);
    state.current = state.queue[0] || null;
    if (!state.current) {
      clearInterval(state.timer);
      renderGame();
      showWin();
      return;
    }
    renderGame();
    return;
  }
  state.misses += 1;
  const slot = document.querySelector(`[data-id="${id}"]`);
  if (slot) {
    slot.classList.add("is-wrong");
    setTimeout(() => slot.classList.remove("is-wrong"), 450);
  }
  toast(t().wrong);
}

function showHint() {
  if (!state.current) return;
  state.hints += 1;
  const slot = document.querySelector(`[data-id="${state.current.id}"]`);
  if (!slot) return;
  slot.classList.add("is-hint");
  slot.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  setTimeout(() => slot.classList.remove("is-hint"), 1400);
}

function showWin() {
  const copy = t();
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="card">
      <h2>${copy.done}</h2>
      <p>${copy.result(fmt(state.elapsed), state.misses, state.hints)}</p>
      <button type="button" data-act="replay">${copy.again}</button>
      <button type="button" data-act="home">${copy.back}</button>
    </div>`;
  app.appendChild(overlay);
}

function toast(msg) {
  document.querySelector(".toast")?.remove();
  const n = document.createElement("div");
  n.className = "toast";
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 1400);
}

app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "lang") {
    lang = lang === "fi" ? "en" : "fi";
    if (state.screen === "home") renderHome();
    else renderGame();
  }
  if (act === "play") startGame(btn.dataset.level);
  if (act === "home") {
    clearInterval(state.timer);
    state.screen = "home";
    renderHome();
  }
  if (act === "hint") showHint();
  if (act === "replay") startGame(state.level);
});

async function boot() {
  data = await fetch("./data/districts.json").then((r) => r.json());
  renderHome();
}

boot();
