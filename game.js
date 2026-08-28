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
    drag: "Napauta oikeaa paikkaa kartalla",
    next: "Sijoita",
    placed: "Paikoillaan",
    time: "Aika",
    hint: "Vihje",
    skip: "Ohita",
    wrong: "Ei osunut — kokeile toisaalle",
    done: "Kaikki paikoillaan!",
    again: "Uusi peli",
    landmarks: "Koski, tornit ja järvet auttavat suuntaamaan.",
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
    drag: "Tap the right place on the map",
    next: "Place",
    placed: "Placed",
    time: "Time",
    hint: "Hint",
    skip: "Skip",
    wrong: "Not quite — try another spot",
    done: "Every district is home!",
    again: "Play again",
    landmarks: "Use the rapids, towers and lakes to get your bearings.",
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
};

function colorFor(id) {
  let h = 0;
  for (const ch of id) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
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

function locName(obj) {
  return obj[lang === "fi" ? "nameFi" : "nameEn"];
}

function landmarkOverlay() {
  const lm = data.landmarks;
  if (!lm) return "";
  const waters = (lm.koski.waters || [])
    .map((p) => `<path class="koski-water" d="${p}"></path>`)
    .join("");
  const places = lm.places
    .map((p) => {
      const mark =
        p.icon === "tower"
          ? `<polygon points="0,-10 2.4,-2 -2.4,-2"/><rect x="-0.8" y="-2" width="1.6" height="7"/>`
          : `<circle r="2.5"/>`;
      return `<g class="pin" transform="translate(${p.x},${p.y})">${mark}<text dy="-13">${locName(p)}</text></g>`;
    })
    .join("");
  const lakes = lm.lakes
    .map((l) => `<text class="lake-label" x="${l.x}" y="${l.y}">${locName(l)}</text>`)
    .join("");
  return `<g class="landmarks" pointer-events="none">
    ${waters}
    <path class="koski-line" d="${lm.koski.path}"></path>
    <text class="koski-label" x="${lm.koski.x}" y="${lm.koski.y}" dx="-16">${locName(lm.koski)}</text>
    ${lakes}
    ${places}
  </g>`;
}

function mapSvg(districts, opts = {}) {
  const [x, y, w, h] = data.viewBox;
  const showTitles = opts.titles !== false;
  const paths = districts
    .map((d) => {
      const cls = opts.classFor ? opts.classFor(d) : "land";
      const color = opts.fillFor ? opts.fillFor(d) : "";
      const fill = color ? ` fill="${color}"` : "";
      const extra = opts.attrsFor ? opts.attrsFor(d) : "";
      const title = showTitles ? `<title>${d.name}</title>` : "";
      return `<path class="${cls}" d="${d.path}"${fill} data-id="${d.id}" ${extra}>${title}</path>`;
    })
    .join("");
  const overlay = opts.landmarks === false ? "" : landmarkOverlay();
  return `<svg viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Tampere">
    <rect class="water-bg" x="${x}" y="${y}" width="${w}" height="${h}"></rect>
    ${paths}
    ${overlay}
  </svg>`;
}

function backdropDistricts() {
  return state.level === "hard"
    ? data.levels.hard.districts
    : data.levels.medium.districts;
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
          titles: false,
          classFor: (d) => (state.placed.has(d.id) ? "placed" : "slot"),
          fillFor: (d) => (state.placed.has(d.id) ? colorFor(d.id) : ""),
          attrsFor: (d) => (state.placed.has(d.id) ? "" : 'data-slot="1"'),
        })}
      </div>
      <aside class="tray">
        <p class="kicker">${copy.next}</p>
        <h2>${current ? current.name : "—"}</h2>
        <p class="prompt">${copy.drag}</p>
        <p class="hint-copy">${copy.landmarks}</p>
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
