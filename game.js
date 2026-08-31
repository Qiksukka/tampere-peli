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
    clueAlong: "Ihan Tammerkosken varrella.",
    clueDir: {
      N: "Pohjoiseen koskesta.",
      NE: "Koilliseen koskesta.",
      E: "Itään koskesta.",
      SE: "Kaakkoon koskesta.",
      S: "Etelään koskesta.",
      SW: "Lounaaseen koskesta.",
      W: "Länteen koskesta.",
      NW: "Luoteeseen koskesta.",
    },
    clueNear: (name) => `Lähellä: ${name}.`,
    clueNasijarvi: "Näsijärven puolella.",
    cluePyhajarvi: "Pyhäjärven puolella.",
    skip: "Ohita",
    tries: "Arvaukset",
    lives: "Elämät",
    score: "Pisteet",
    zoomIn: "Lähennä",
    zoomOut: "Loitonna",
    wrong: "Ei osunut — kokeile toisaalle",
    outOfGuesses: "Arvaukset loppuivat",
    done: "Kaikki paikoillaan!",
    finished: "Kierros ohi",
    again: "Uusi peli",
    landmarks: "Koski, tornit ja järvet auttavat suuntaamaan.",
    source:
      "Kartta: Tampereen kaupungin avoin data (suunnittelualueet ja tilastoalueet), CC BY 4.0.",
    result: (score, found, skipped, t, misses, hints) =>
      `${score} pistettä. Löysit ${found}, ohitit ${skipped}. Aika ${t}. Väärät ${misses}, vihjeitä ${hints}.`,
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
    clueAlong: "Right along Tammerkoski.",
    clueDir: {
      N: "North of the rapids.",
      NE: "Northeast of the rapids.",
      E: "East of the rapids.",
      SE: "Southeast of the rapids.",
      S: "South of the rapids.",
      SW: "Southwest of the rapids.",
      W: "West of the rapids.",
      NW: "Northwest of the rapids.",
    },
    clueNear: (name) => `Near ${name}.`,
    clueNasijarvi: "On the Näsijärvi side.",
    cluePyhajarvi: "On the Pyhäjärvi side.",
    skip: "Skip",
    tries: "Guesses",
    lives: "Lives",
    score: "Score",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    wrong: "Not quite — try another spot",
    outOfGuesses: "No guesses left",
    done: "Every district is home!",
    finished: "Round over",
    again: "Play again",
    landmarks: "Use the rapids, towers and lakes to get your bearings.",
    source:
      "Map: City of Tampere open data (planning and statistical areas), CC BY 4.0.",
    result: (score, found, skipped, t, misses, hints) =>
      `${score} points. Found ${found}, skipped ${skipped}. Time ${t}. Misses ${misses}, hints ${hints}.`,
  },
};

const MAX_TRIES = 5;
const SCORE_FOUND = 100;
const SCORE_HINTED = 40;
const SCORE_GUESS_LEFT = 25;

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
  triesLeft: MAX_TRIES,
  roundTotal: 0,
  score: 0,
  found: new Set(),
  skipped: new Set(),
  hintedCurrent: false,
  hints: 0,
  hintText: "",
  hintDir: null,
  timer: null,
  mapZoom: 1,
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

function waterLayer() {
  const lm = data.landmarks;
  if (!lm) return "";
  const waters = (lm.koski.waters || [])
    .map((p) => `<path class="koski-water" d="${p}"></path>`)
    .join("");
  const lakes = (lm.lakes || [])
    .flatMap((l) => (l.paths || []).map((p) => `<path class="lake" d="${p}"></path>`))
    .join("");
  return `<g class="water-layer" pointer-events="none">${lakes}${waters}</g>`;
}

function landmarkOverlay() {
  const lm = data.landmarks;
  if (!lm) return "";
  const places = (lm.places || [])
    .map((p) => {
      const label = shortPlace(p);
      return `<g class="pin" transform="translate(${p.x},${p.y})">
        <circle class="pin-dot" r="2"></circle>
        <text class="pin-label" x="${label.dx}" y="${label.dy}" text-anchor="${label.anchor}">${label.text}</text>
      </g>`;
    })
    .join("");
  const lakes = (lm.lakes || [])
    .map((l) => `<text class="lake-label" x="${l.x}" y="${l.y}">${locName(l)}</text>`)
    .join("");
  return `<g class="landmarks" pointer-events="none">
      <path class="koski-line" d="${lm.koski.path}"></path>
      ${hintRay()}
      <text class="koski-label" x="${lm.koski.x}" y="${lm.koski.y}" dx="-8">${locName(lm.koski)}</text>
      ${lakes}
      ${places}
    </g>`;
}

function shortPlace(p) {
  const shorts = {
    nasinneula: { fi: "Näsinneula", en: "Näsinneula", dx: -4, dy: -3.5, anchor: "end" },
    "pyynikki-tower": { fi: "Pyynikki", en: "Pyynikki", dx: -4, dy: 7, anchor: "end" },
    asema: { fi: "Asema", en: "Station", dx: 4, dy: -3.5, anchor: "start" },
    "nokia-arena": { fi: "Arena", en: "Arena", dx: 4, dy: 7, anchor: "start" },
    ratina: { fi: "Ratina", en: "Ratina", dx: -4, dy: 7, anchor: "end" },
    "tampere-talo": { fi: "Tampere-talo", en: "Tampere Hall", dx: 4, dy: -3.5, anchor: "start" },
  };
  const s = shorts[p.id] || {
    fi: p.nameFi,
    en: p.nameEn,
    dx: 4,
    dy: -3.5,
    anchor: "start",
  };
  return { text: lang === "fi" ? s.fi : s.en, dx: s.dx, dy: s.dy, anchor: s.anchor };
}

function hintRay() {
  if (!state.hintDir || !data.landmarks?.koski) return "";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const i = dirs.indexOf(state.hintDir);
  if (i < 0) return "";
  const rad = (i * Math.PI) / 4;
  const k = data.landmarks.koski;
  const len = 70;
  const x2 = k.x + Math.sin(rad) * len;
  const y2 = k.y - Math.cos(rad) * len;
  return `<line class="hint-ray" x1="${k.x}" y1="${k.y}" x2="${x2}" y2="${y2}"></line>`;
}

function mapSvg(districts, opts = {}) {
  const [x, y, w, h] = opts.viewBox || data.viewBox;
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
  const water = opts.landmarks === false ? "" : waterLayer();
  const zoom = state.mapZoom || 1;
  return `<svg viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Tampere" style="width:${zoom * 100}%; height:${zoom * 100}%">
    <rect class="water-bg" x="${x}" y="${y}" width="${w}" height="${h}"></rect>
    ${water}
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
  app.className = "is-home";
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
              <span>${lvl[lang === "fi" ? "blurbFi" : "blurbEn"]} · ${lvl.pick || lvl.districts.length}</span>
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
  const lvl = data.levels[level];
  const pool = shuffle(lvl.districts);
  state.queue = lvl.pick ? pool.slice(0, lvl.pick) : pool;
  state.roundTotal = state.queue.length;
  state.current = state.queue[0];
  state.startedAt = Date.now();
  state.elapsed = 0;
  state.misses = 0;
  state.triesLeft = MAX_TRIES;
  state.score = 0;
  state.found = new Set();
  state.skipped = new Set();
  state.hintedCurrent = false;
  state.hints = 0;
  state.hintText = "";
  state.hintDir = null;
  state.mapZoom = 1;
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    state.elapsed = Date.now() - state.startedAt;
    const el = document.getElementById("clock");
    if (el) el.textContent = fmt(state.elapsed);
  }, 250);
  renderGame();
}

function livesHtml() {
  const copy = t();
  const hearts = Array.from({ length: MAX_TRIES }, (_, i) => {
    const on = i < state.triesLeft;
    return `<svg class="heart ${on ? "is-on" : "is-off"}" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 14S1.8 10 1.8 6.4C1.8 4.3 3.4 3 5.2 3c1.1 0 2 .6 2.8 1.6C8.8 3.6 9.7 3 10.8 3c1.8 0 3.4 1.3 3.4 3.4C14.2 10 8 14 8 14z"/>
    </svg>`;
  }).join("");
  return `<div class="lives" id="tries" role="img" aria-label="${copy.lives} ${state.triesLeft}/${MAX_TRIES}">${hearts}</div>`;
}

function changeMapZoom(delta) {
  const wrap = document.getElementById("map");
  const cx = wrap ? (wrap.scrollLeft + wrap.clientWidth / 2) / Math.max(wrap.scrollWidth, 1) : 0.5;
  const cy = wrap ? (wrap.scrollTop + wrap.clientHeight / 2) / Math.max(wrap.scrollHeight, 1) : 0.5;
  state.mapZoom = Math.min(3, Math.max(1, +(state.mapZoom + delta).toFixed(2)));
  renderGame();
  const next = document.getElementById("map");
  if (!next) return;
  next.scrollLeft = cx * next.scrollWidth - next.clientWidth / 2;
  next.scrollTop = cy * next.scrollHeight - next.clientHeight / 2;
}

function renderGame() {
  const copy = t();
  const level = data.levels[state.level];
  const total = state.roundTotal;
  const current = state.current;
  const mapDistricts = backdropDistricts();
  const viewBox = level.viewBox || data.viewBox;

  app.className = "is-game";
  app.innerHTML = `
    <header class="game-header">
      <button class="ghost" data-act="home" type="button">${copy.back}</button>
      ${livesHtml()}
      <span class="stat" id="score">${copy.score} ${state.score}</span>
      <span class="stat" id="clock">${fmt(state.elapsed)}</span>
      <span class="stat hide-narrow">${level[lang === "fi" ? "labelFi" : "labelEn"]}</span>
      <span class="stat">${copy.placed} ${state.placed.size}/${total}</span>
      <span class="spacer"></span>
      <button class="lang" data-act="lang" type="button">${copy.lang}</button>
    </header>
    <section class="play">
      <div class="map-panel">
        <div class="map-tools">
          <button type="button" data-act="zoom-in" ${state.mapZoom >= 3 ? "disabled" : ""} aria-label="${copy.zoomIn}">+</button>
          <button type="button" data-act="zoom-out" ${state.mapZoom <= 1 ? "disabled" : ""} aria-label="${copy.zoomOut}">−</button>
        </div>
        <div class="map-wrap" id="map">
        ${mapSvg(mapDistricts, {
          titles: false,
          viewBox,
          classFor: (d) => {
            if (state.skipped.has(d.id)) return "placed skipped";
            if (state.placed.has(d.id) || state.found.has(d.id)) return "placed";
            return "slot";
          },
          fillFor: (d) => (state.placed.has(d.id) ? colorFor(d.id) : ""),
          attrsFor: (d) => (state.placed.has(d.id) ? "" : 'data-slot="1"'),
        })}
        </div>
      </div>
      <aside class="tray">
        <p class="kicker">${copy.next}</p>
        <h2>${current ? current.name : "—"}</h2>
        <p class="prompt">${copy.drag}</p>
        <p class="hint-copy">${state.hintText || copy.landmarks}</p>
        <div class="hint-row">
          <button type="button" data-act="hint">${copy.hint}</button>
          <button type="button" class="skip" data-act="skip">${copy.skip}</button>
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

function advanceQueue() {
  const idx = state.queue.findIndex((d) => d.id === state.current?.id);
  if (idx >= 0) state.queue.splice(idx, 1);
  state.current = state.queue[0] || null;
  state.hintText = "";
  state.hintDir = null;
  state.hintedCurrent = false;
  if (!state.current) {
    finishRound();
    return;
  }
  renderGame();
}

function skipDistrict() {
  if (!state.current) return;
  state.skipped.add(state.current.id);
  state.placed.add(state.current.id);
  advanceQueue();
}

function tryPlace(id) {
  if (!state.current || state.triesLeft <= 0) return;
  if (id === state.current.id) {
    state.score += state.hintedCurrent ? SCORE_HINTED : SCORE_FOUND;
    state.found.add(id);
    state.placed.add(id);
    advanceQueue();
    return;
  }
  state.misses += 1;
  state.triesLeft -= 1;
  const slot = document.querySelector(`[data-id="${id}"]`);
  if (slot) {
    slot.classList.add("is-wrong");
    setTimeout(() => slot.classList.remove("is-wrong"), 450);
  }
  if (state.triesLeft <= 0) {
    toast(t().outOfGuesses);
    finishRound();
    return;
  }
  updateLives();
  toast(t().wrong);
}

function updateLives() {
  const el = document.getElementById("tries");
  if (!el) return;
  el.outerHTML = livesHtml();
}

function finishRound() {
  state.score += state.triesLeft * SCORE_GUESS_LEFT;
  state.current = null;
  clearInterval(state.timer);
  renderGame();
  showEnd();
}

function compassDir(dx, dy) {
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function clueFor(district) {
  const copy = t();
  const k = data.landmarks.koski;
  const dx = district.cx - k.x;
  const dy = district.cy - k.y;
  const dist = Math.hypot(dx, dy);
  const dir = compassDir(dx, dy);
  const parts = [];
  if (dist < 28) {
    parts.push(copy.clueAlong);
    state.hintDir = null;
  } else {
    parts.push(copy.clueDir[dir]);
    state.hintDir = dir;
  }
  let nearest = null;
  let nearestD = 58;
  for (const p of data.landmarks.places) {
    const pd = Math.hypot(district.cx - p.x, district.cy - p.y);
    if (pd < nearestD) {
      nearestD = pd;
      nearest = p;
    }
  }
  if (nearest) parts.push(copy.clueNear(locName(nearest)));
  if (district.cy < k.y - 28) parts.push(copy.clueNasijarvi);
  if (district.cy > k.y + 36) parts.push(copy.cluePyhajarvi);
  return parts.join(" ");
}

function showHint() {
  if (!state.current) return;
  state.hints += 1;
  state.hintedCurrent = true;
  state.hintText = clueFor(state.current);
  renderGame();
}

function showEnd() {
  const copy = t();
  const total = state.roundTotal;
  const perfect = state.found.size === total && state.skipped.size === 0;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="card">
      <h2>${perfect ? copy.done : copy.finished}</h2>
      <p class="score-line">${state.score}</p>
      <p>${copy.result(
        state.score,
        state.found.size,
        state.skipped.size,
        fmt(state.elapsed),
        state.misses,
        state.hints
      )}</p>
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
    if (state.hintText && state.current) state.hintText = clueFor(state.current);
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
  if (act === "skip") skipDistrict();
  if (act === "zoom-in") changeMapZoom(0.4);
  if (act === "zoom-out") changeMapZoom(-0.4);
  if (act === "replay") startGame(state.level);
});

async function boot() {
  data = await fetch("./data/districts.json").then((r) => r.json());
  renderHome();
}

boot();
