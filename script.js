/* ==========================================================================
   THE CROSSWORD LEDGER — client-side app
   Fetches the aggregated poll data, computes stats, and renders the UI.
   ========================================================================== */

const API_URL = "https://crossword.x7x11x13.workers.dev/";
const FALLBACK_URL = "./data.json";
const DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const PAGE_SIZE = 25;
const STORAGE_KEY = "cwl.filters.v1";

const state = {
  all: [],          // raw array from API, oldest→newest sorted
  filtered: [],
  visibleCount: PAGE_SIZE,
  filters: { day: "all", sort: "rating-desc", search: "" },
};

const HEATMAP_MIN_PUZZLES = 5;
const HEATMAP_RANGE_LAST365 = "last365";

/* ---------- utility ----------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function parseDate(mdy) {
  // "04/12/2026" → Date (local)
  const [m, d, y] = mdy.split("/").map(Number);
  return new Date(y, m - 1, d);
}
function fmtLongDate(date) {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function fmtShortDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function nytUrlForDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `https://www.nytimes.com/crosswords/game/daily/${y}/${m}/${d}`;
}
function ratingClass(r) {
  if (r == null) return "mid";
  if (r >= 3.65) return "hi";
  if (r >= 3.0)  return "mid";
  return "lo";
}
function ratingLevel(r) {
  // 0..4 for heatmap buckets
  if (r == null) return -1;
  if (r < 2.5) return 0;
  if (r < 3.0) return 1;
  if (r < 3.5) return 2;
  if (r < 4.0) return 3;
  return 4;
}
function setStatus(text, isError = false) {
  const el = $("#status");
  if (!text) {
    el.classList.remove("show", "err");
    return;
  }
  el.textContent = text;
  el.classList.toggle("err", !!isError);
  el.classList.add("show");
  if (!isError) {
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => el.classList.remove("show"), 2500);
  }
}

/* ---------- data fetch -------------------------------------------------- */
async function fetchFromUrl(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const body = await r.text();
  if (body.startsWith("error code")) throw new Error(`${url} → ${body.trim()}`);
  return JSON.parse(body);
}

async function loadData() {
  setStatus("Setting the type…");
  let raw, usedFallback = false;
  try {
    raw = await fetchFromUrl(API_URL);
  } catch (err) {
    console.warn("Live API failed, trying local snapshot:", err.message);
    raw = await fetchFromUrl(FALLBACK_URL);
    usedFallback = true;
  }
  const enriched = raw
    .filter(e => e && e.dateString)
    .map(e => ({ ...e, date: parseDate(e.dateString) }))
    .sort((a, b) => a.date - b.date); // oldest first
  if (usedFallback) {
    setStatus("Live API unreachable — showing cached snapshot", false);
    const lastDate = enriched[enriched.length - 1]?.date;
    if (lastDate) {
      const note = document.createElement("div");
      note.className = "cache-note";
      note.innerHTML = `<strong>⚠</strong> The upstream poll API is currently unreachable. Showing a cached snapshot through <em>${fmtLongDate(lastDate)}</em>.`;
      document.querySelector(".masthead").after(note);
    }
  }
  return enriched;
}

/* ---------- MASTHEAD / META --------------------------------------------- */
function renderMasthead() {
  const now = new Date();
  $("#todayDate").textContent = fmtLongDate(now).toUpperCase();
  $("#footerYear").textContent = now.getFullYear();

  // Volume = years since the subreddit-era (jan 2020), issue = day-of-year.
  const epoch = new Date(2020, 0, 1);
  const years = now.getFullYear() - epoch.getFullYear() + 1;
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now - startOfYear) / 86400000);
  $("#volNum").textContent = toRoman(years);
  $("#issueNum").textContent = doy;
}

function toRoman(n) {
  const map = [["M",1000],["CM",900],["D",500],["CD",400],["C",100],["XC",90],["L",50],["XL",40],["X",10],["IX",9],["V",5],["IV",4],["I",1]];
  let s = "";
  for (const [r, v] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

/* ---------- FEATURED LATEST PUZZLE -------------------------------------- */
function renderFeature(data) {
  // Most recent puzzle with a poll and votes
  const latest = [...data].reverse().find(e => e.pollExists && e.votes > 0) || data[data.length - 1];
  if (!latest) return;

  $("#featDayband").textContent = latest.dayName.toUpperCase();
  $("#featDate").textContent = fmtLongDate(latest.date);
  $("#featVotes").textContent = latest.votes.toLocaleString();
  $("#featAuthor").textContent = latest.author || "Unknown constructor";
  $("#featEditor").textContent = latest.editor || "—";

  const score = latest.averageRating ?? 0;
  $("#featScore").textContent = score.toFixed(2);
  $("#featScore").style.color = ratingClass(score) === "lo" ? "var(--accent-deep)" : "var(--accent)";

  $("#featPlay").href = nytUrlForDate(latest.date);
  $("#featReddit").href = latest.pollURL || "#";
  if (!latest.pollURL) $("#featReddit").style.display = "none";

  renderDistribution(latest);
  renderFeatureMiniGrid();

  $("#featureCard").classList.add("reveal");
}

function renderDistribution(p) {
  const rows = [
    ["excellent", "Excellent · 5", p.excellentPercentage],
    ["good",      "Good · 4",      p.goodPercentage],
    ["average",   "Average · 3",   p.averagePercentage],
    ["poor",      "Poor · 2",      p.poorPercentage],
    ["terrible",  "Terrible · 1",  p.terriblePercentage],
  ];
  const host = $("#featDist");
  host.innerHTML = rows.map(([cls, label, pct]) => `
    <div class="dist-row ${cls}">
      <span class="dist-label">${label}</span>
      <span class="dist-bar"><span class="dist-bar-fill" style="width:${(pct ?? 0).toFixed(1)}%"></span></span>
      <span class="dist-pct">${(pct ?? 0).toFixed(1)}%</span>
    </div>
  `).join("");
}

function renderFeatureMiniGrid() {
  // Decorative 5x5 mini "crossword" — deterministic pattern
  const host = $("#featMiniGrid");
  host.innerHTML = "";
  const pattern = [
    0,0,0,1,0,
    0,1,0,0,0,
    0,0,0,0,0,
    0,0,0,1,0,
    0,1,0,0,0,
  ];
  const accent = 7; // one cell turned vermillion for flourish
  pattern.forEach((v, i) => {
    const cell = document.createElement("div");
    cell.className = "mini-cell" + (v ? " on" : "") + (i === accent ? " accent" : "");
    if (!v && i !== accent) cell.textContent = i + 1;
    host.appendChild(cell);
  });
}

/* ---------- AT A GLANCE STATS ------------------------------------------- */
function renderStats(data) {
  const polled = data.filter(e => e.pollExists && e.votes > 0);
  const total = polled.length;

  const mean = polled.reduce((a, b) => a + b.averageRating, 0) / Math.max(1, total);
  const first = polled[0], last = polled[polled.length - 1];

  const best = [...polled].sort((a, b) => b.averageRating - a.averageRating)[0];
  const worst = [...polled].sort((a, b) => a.averageRating - b.averageRating)[0];

  $("#statTotal").textContent = total.toLocaleString();
  $("#statRange").textContent = first && last
    ? `${fmtShortDate(first.date)} → ${fmtShortDate(last.date)}`
    : "—";
  $("#statAvg").textContent = mean.toFixed(2);

  if (best) {
    $("#statBestRating").textContent = best.averageRating.toFixed(2);
    $("#statBestDate").innerHTML = `<em>${best.dayName}, ${fmtShortDate(best.date)}</em><br>${escapeHtml(best.author)}`;
    $("#statBestLink").href = nytUrlForDate(best.date);
    $("#statBestLink").title = `Play: ${best.author} — ${fmtShortDate(best.date)}`;
  }
  if (worst) {
    $("#statWorstRating").textContent = worst.averageRating.toFixed(2);
    $("#statWorstDate").innerHTML = `<em>${worst.dayName}, ${fmtShortDate(worst.date)}</em><br>${escapeHtml(worst.author)}`;
    $("#statWorstLink").href = nytUrlForDate(worst.date);
    $("#statWorstLink").title = `Play: ${worst.author} — ${fmtShortDate(worst.date)}`;
  }
}

/* ---------- BY DAY OF WEEK ---------------------------------------------- */
function renderByDay(data) {
  const polled = data.filter(e => e.pollExists && e.votes > 0);
  const byDay = Object.fromEntries(DAY_ORDER.map(d => [d, []]));
  for (const e of polled) if (byDay[e.dayName]) byDay[e.dayName].push(e);

  const host = $("#bydayGrid");
  host.innerHTML = DAY_ORDER.map(d => {
    const arr = byDay[d];
    if (!arr.length) return "";
    const avg = arr.reduce((a, b) => a + b.averageRating, 0) / arr.length;
    const dist = {
      e: arr.reduce((a, b) => a + (b.excellentPercentage || 0), 0) / arr.length,
      g: arr.reduce((a, b) => a + (b.goodPercentage || 0), 0) / arr.length,
      a: arr.reduce((a, b) => a + (b.averagePercentage || 0), 0) / arr.length,
      p: arr.reduce((a, b) => a + (b.poorPercentage || 0), 0) / arr.length,
      t: arr.reduce((a, b) => a + (b.terriblePercentage || 0), 0) / arr.length,
    };
    const bars = [
      ["e", dist.e], ["g", dist.g], ["a", dist.a], ["p", dist.p], ["t", dist.t]
    ].map(([cls, v]) =>
      `<div class="bb ${cls}" style="height:${Math.max(2, v)}%"></div>`
    ).join("");

    return `
      <div class="byday-col">
        <div class="byday-name">${d.toUpperCase()}</div>
        <div class="byday-avg">${avg.toFixed(2)}</div>
        <div class="byday-meta"><em>${arr.length.toLocaleString()} puzzles</em></div>
        <div class="byday-bar">${bars}</div>
        <div class="byday-scale"><span>Exc.</span><span>Terr.</span></div>
      </div>
    `;
  }).join("");
}

/* ---------- CONSTRUCTORS ------------------------------------------------ */
function splitConstructors(author) {
  // Normalize collaborators — "A and B", "A & B", "A, B, and C"
  return String(author || "")
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map(s => s.trim())
    .filter(Boolean);
}

function aggregateConstructors(data) {
  const byName = new Map();
  for (const e of data) {
    if (!e.pollExists || !e.votes) continue;
    for (const name of splitConstructors(e.author)) {
      if (!byName.has(name)) byName.set(name, { name, puzzles: [], sum: 0 });
      const rec = byName.get(name);
      rec.puzzles.push(e);
      rec.sum += e.averageRating;
    }
  }
  const out = [];
  for (const rec of byName.values()) {
    rec.count = rec.puzzles.length;
    rec.avg = rec.sum / rec.count;
    out.push(rec);
  }
  return out;
}

function renderConstructors(data) {
  const MIN = HEATMAP_MIN_PUZZLES; // min puzzles to qualify
  const all = aggregateConstructors(data).filter(r => r.count >= MIN);

  const top = [...all].sort((a, b) => b.avg - a.avg || b.count - a.count).slice(0, 5);
  const bot = [...all].sort((a, b) => a.avg - b.avg || b.count - a.count).slice(0, 5);

  const row = (r, idx, kind) => {
    const best = [...r.puzzles].sort((a, b) => b.averageRating - a.averageRating)[0];
    const worst = [...r.puzzles].sort((a, b) => a.averageRating - b.averageRating)[0];
    const featured = kind === "top" ? best : worst;
    const featLabel = kind === "top" ? "Best" : "Worst";
    return `
      <li class="cx-row cx-${kind}">
        <span class="cx-rank">${idx + 1}</span>
        <div class="cx-main">
          <div class="cx-name">${escapeHtml(r.name)}</div>
          <div class="cx-meta">
            ${r.count} puzzles ·
            <a href="${nytUrlForDate(featured.date)}" target="_blank" rel="noopener" class="cx-feat">
              ${featLabel}: ${featured.averageRating.toFixed(2)} <span class="cx-feat-date">(${fmtShortDate(featured.date)})</span>
            </a>
          </div>
        </div>
        <div class="cx-avg ${kind === "top" ? "hi" : "lo"}">${r.avg.toFixed(2)}</div>
      </li>
    `;
  };

  const topHost = $("#constructorTop");
  const botHost = $("#constructorBottom");
  if (topHost) topHost.innerHTML = top.map((r, i) => row(r, i, "top")).join("");
  if (botHost) botHost.innerHTML = bot.map((r, i) => row(r, i, "bot")).join("");
}

function updateSearchPlaceholder(data) {
  const box = $("#searchBox");
  if (!box) return;
  const counts = new Map();
  for (const e of data) {
    if (!e.pollExists || !e.votes) continue;
    for (const name of splitConstructors(e.author)) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  const top3 = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n]) => {
      // use surname when available
      const parts = n.split(/\s+/);
      return parts[parts.length - 1];
    });
  if (top3.length) box.placeholder = `e.g. ${top3.join(", ")}…`;
}

/* ---------- HEATMAP ----------------------------------------------------- */
let activeTip = null;

function renderHeatmapYears(data) {
  const sel = $("#heatmapYear");
  const years = [...new Set(data.map(e => e.date.getFullYear()))].sort((a,b) => b - a);
  const opts = [`<option value="${HEATMAP_RANGE_LAST365}">Last 365 days</option>`]
    .concat(years.map(y => `<option value="${y}">${y}</option>`));
  sel.innerHTML = opts.join("");
  sel.value = HEATMAP_RANGE_LAST365;
  sel.addEventListener("change", () => {
    const v = sel.value;
    if (v === HEATMAP_RANGE_LAST365) renderHeatmap(data, HEATMAP_RANGE_LAST365);
    else renderHeatmap(data, Number(v));
  });
}

function resolveHeatmapRange(range) {
  // Returns { start, end, showMonthLabels } — start/end are inclusive day bounds.
  if (range === HEATMAP_RANGE_LAST365) {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    start.setDate(end.getDate() - 364);
    return { start, end, showMonthLabels: true };
  }
  const year = Number(range);
  return {
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31),
    showMonthLabels: true,
  };
}

function renderHeatmap(data, range) {
  const host = $("#heatmap");
  host.innerHTML = "";

  const { start, end } = resolveHeatmapRange(range);

  // Build lookup keyed by YYYY-MM-DD for entries within range
  const byKey = new Map();
  for (const e of data) {
    if (e.date >= start && e.date <= end) {
      byKey.set(keyForDate(e.date), e);
    }
  }

  // Build the grid: start from the Monday on/before start; end at the Sunday on/after end.
  const dowMon = (d) => (d.getDay() + 6) % 7;
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - dowMon(start));
  const gridEnd = new Date(end);
  gridEnd.setDate(end.getDate() + (6 - dowMon(end)));

  // Iterate by week (column), by day (row)
  const today = new Date();
  const monthPositions = {};
  const cur = new Date(gridStart);
  let col = 0;
  while (cur <= gridEnd) {
    for (let row = 0; row < 7; row++) {
      const cell = document.createElement("div");
      const inRange = cur >= start && cur <= end;
      const isFuture = cur > today;

      if (!inRange) {
        cell.className = "hm-cell empty";
      } else {
        const entry = byKey.get(keyForDate(cur));
        if (isFuture) {
          cell.className = "hm-cell empty";
        } else if (!entry || !entry.pollExists || !entry.votes) {
          cell.className = "hm-cell null";
          cell.dataset.date = keyForDate(cur);
        } else {
          const lvl = ratingLevel(entry.averageRating);
          cell.className = `hm-cell l${lvl}`;
          cell.dataset.date = keyForDate(cur);
          cell.dataset.rating = entry.averageRating.toFixed(2);
          cell.dataset.author = entry.author || "";
          cell.dataset.day = entry.dayName || "";
          cell.dataset.votes = entry.votes || 0;
          cell.addEventListener("mouseenter", showTip);
          cell.addEventListener("mouseleave", hideTip);
          cell.addEventListener("click", () => {
            window.open(nytUrlForDate(new Date(entry.date)), "_blank", "noopener");
          });
        }
      }
      cell.style.gridColumn = col + 1;
      cell.style.gridRow = row + 1;
      host.appendChild(cell);

      // Track first column of each distinct month (across range) for labels.
      if (inRange && row === 0) {
        const monthKey = `${cur.getFullYear()}-${String(cur.getMonth()).padStart(2,"0")}`;
        if (!(monthKey in monthPositions) && cur.getDate() <= 7) {
          monthPositions[monthKey] = { col, month: cur.getMonth(), year: cur.getFullYear() };
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    col++;
  }

  host.style.gridTemplateColumns = `repeat(${col}, 14px)`;

  renderHeatmapMonths(monthPositions, col);
}

function keyForDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderHeatmapMonths(positions, cols) {
  const host = $("#heatmapMonths");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const entries = Object.values(positions).sort((a, b) => a.col - b.col);
  host.style.display = "grid";
  host.style.gridTemplateColumns = `repeat(${cols}, 14px)`;
  host.style.gap = "2px";
  host.style.paddingLeft = "44px";
  host.innerHTML = "";
  // When the range spans >1 calendar year, include the year for January labels.
  const crossYear = entries.length > 1 && entries[0].year !== entries[entries.length - 1].year;
  entries.forEach(({ col, month, year }) => {
    const span = document.createElement("span");
    span.textContent = (crossYear && month === 0) ? `${months[month]} ’${String(year).slice(-2)}` : months[month];
    span.style.gridColumn = `${col + 1} / span 4`;
    host.appendChild(span);
  });
}

function showTip(e) {
  hideTip();
  const cell = e.currentTarget;
  const { date, rating, author, day, votes } = cell.dataset;
  const tip = document.createElement("div");
  tip.className = "hm-tip";
  tip.innerHTML = `
    <div><strong>${day} · ${date}</strong></div>
    <div>Rating: ${rating ?? "—"} / 5.00</div>
    <div>${author ? escapeHtml(author) : "—"}</div>
    <div>${Number(votes).toLocaleString()} votes</div>
  `;
  const rect = cell.getBoundingClientRect();
  tip.style.left = rect.left + rect.width / 2 + window.scrollX + "px";
  tip.style.top  = rect.top + window.scrollY - 6 + "px";
  document.body.appendChild(tip);
  activeTip = tip;
}
function hideTip() {
  if (activeTip) { activeTip.remove(); activeTip = null; }
}

/* ---------- ARCHIVE: list + filters ------------------------------------- */
function persistFilters() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.filters)); }
  catch {}
}

function applyFilters() {
  persistFilters();
  const { day, sort, search } = state.filters;
  let out = state.all.filter(e => e.pollExists && e.votes > 0);

  if (day !== "all") out = out.filter(e => e.dayName === day);
  if (search) {
    const q = search.toLowerCase();
    out = out.filter(e => (e.author || "").toLowerCase().includes(q));
  }

  const sorters = {
    "date-desc":   (a, b) => b.date - a.date,
    "date-asc":    (a, b) => a.date - b.date,
    "rating-desc": (a, b) => b.averageRating - a.averageRating,
    "rating-asc":  (a, b) => a.averageRating - b.averageRating,
    "votes-desc":  (a, b) => b.votes - a.votes,
  };
  out.sort(sorters[sort] || sorters["date-desc"]);
  state.filtered = out;
  state.visibleCount = PAGE_SIZE;
  renderList();
}

function renderList() {
  const host = $("#puzzleList");
  const ranked = state.filters.sort === "rating-desc" || state.filters.sort === "rating-asc";
  const dudMode = state.filters.sort === "rating-asc"; // top three positions are "worst"
  const toShow = state.filtered.slice(0, state.visibleCount);
  host.classList.toggle("ranked", ranked);
  host.innerHTML = toShow.map((e, i) => puzzleListItem(e, i, ranked, dudMode)).join("");

  $("#archiveCount").textContent =
    `Showing ${toShow.length.toLocaleString()} of ${state.filtered.length.toLocaleString()} puzzles`;
  $("#loadMore").style.display = state.visibleCount < state.filtered.length ? "" : "none";
}

const ICONS = {
  star: `<svg class="award-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.77 6.63 7.18.6-5.46 4.7 1.66 7.01L12 17.42l-6.15 3.71 1.66-7.01L2.05 9.43l7.18-.6z"/></svg>`,
  turkey: `<svg class="award-icon" viewBox="0 0 24 24" aria-hidden="true">
      <!-- tail feathers -->
      <path d="M12 3.5 L12 12 M6.7 4.9 L10 12 M2.8 8.3 L8 12 M17.3 4.9 L14 12 M21.2 8.3 L16 12"/>
      <!-- body -->
      <circle cx="12" cy="16.5" r="3.4"/>
      <!-- beak + wattle -->
      <path d="M12 14.5 L11.5 16 L12 16.5 M13.5 15.4 L14.4 15.4"/>
    </svg>`,
  lemon: `<svg class="award-icon" viewBox="0 0 24 24" aria-hidden="true">
      <!-- leaf -->
      <path d="M16 5.3 Q18.6 4 20.2 5.1 Q19.3 7 17 7.2"/>
      <!-- lemon body -->
      <ellipse cx="11.5" cy="13" rx="7.5" ry="6"/>
      <!-- slice divisions -->
      <line x1="11.5" y1="7" x2="11.5" y2="19"/>
      <line x1="4" y1="13" x2="19" y2="13"/>
      <line x1="6" y1="8" x2="17" y2="18"/>
      <line x1="6" y1="18" x2="17" y2="8"/>
    </svg>`,
  clunker: `<svg class="award-icon" viewBox="0 0 24 24" aria-hidden="true">
      <!-- car body -->
      <path d="M3 15 L5 10 H19 L21 15 V18 H3 Z"/>
      <!-- window -->
      <path d="M7 10 L8.5 7 H15.5 L17 10"/>
      <!-- wheels -->
      <circle cx="7.5" cy="18" r="1.6"/>
      <circle cx="16.5" cy="18" r="1.6"/>
      <!-- smoke puffs (cracked) -->
      <path d="M20 8 Q22 7 22 9 M19 6 Q21 5 21 7"/>
      <!-- crack -->
      <path d="M11 11 L12 13 L11.5 14.5 L13 16" stroke-dasharray="1 1.6"/>
    </svg>`,
};

const MEDALS = [
  { cls: "gold",    label: "Gold",    icon: ICONS.star },
  { cls: "silver",  label: "Silver",  icon: ICONS.star },
  { cls: "bronze",  label: "Bronze",  icon: ICONS.star },
];
const DUDS = [
  { cls: "dud turkey",  label: "Turkey",  icon: ICONS.turkey },
  { cls: "dud lemon",   label: "Lemon",   icon: ICONS.lemon },
  { cls: "dud clunker", label: "Clunker", icon: ICONS.clunker },
];

function rankBadge(index, dudMode) {
  const rank = index + 1;
  if (index < 3) {
    const m = dudMode ? DUDS[index] : MEDALS[index];
    const bucket = dudMode ? "dud-rank" : `${m.cls.split(" ")[0]}-rank`;
    return `
      <div class="pi-rank ${bucket}">
        <div class="pi-award ${m.cls}">
          ${m.icon}
          <span class="rank-pip">${rank}</span>
        </div>
        <div class="pi-award-label">${m.label}</div>
      </div>
    `;
  }
  return `<div class="pi-rank"><div class="pi-rank-num">${rank}</div></div>`;
}

function puzzleListItem(e, index, ranked, dudMode) {
  const score = e.averageRating;
  const cls = ratingClass(score);
  const nyt = nytUrlForDate(e.date);
  const rankHtml = ranked ? rankBadge(index, dudMode) : "";
  return `
    <li class="puzzle-item">
      ${rankHtml}
      <div class="pi-meta">
        <div class="pi-date-primary">${fmtLongDate(e.date)}</div>
        <div class="pi-byline-name">${escapeHtml(e.author || "—")}</div>
        <div class="pi-sub">${e.votes.toLocaleString()} votes · Ed. ${escapeHtml(e.editor || "—")}</div>
      </div>
      <div class="pi-rating">
        <span class="pi-rating-num ${cls}">${score.toFixed(2)}</span>
        <span class="pi-rating-dash">/5</span>
      </div>
      <div class="pi-actions">
        <a class="pi-link pi-link-primary" href="${nyt}" target="_blank" rel="noopener" title="Play on NYTimes.com">Play</a>
        ${e.pollURL ? `<a class="pi-link" href="${e.pollURL}" target="_blank" rel="noopener" title="Reddit discussion">Poll</a>` : ""}
      </div>
    </li>
  `;
}

function wireFilters() {
  $$("#dayChips .chip").forEach(ch => {
    ch.addEventListener("click", () => {
      $$("#dayChips .chip").forEach(c => c.classList.remove("chip-on"));
      ch.classList.add("chip-on");
      state.filters.day = ch.dataset.day;
      applyFilters();
    });
  });
  $("#sortBy").addEventListener("change", (e) => {
    state.filters.sort = e.target.value;
    applyFilters();
  });
  $("#searchBox").addEventListener("input", debounce((e) => {
    state.filters.search = e.target.value.trim();
    applyFilters();
  }, 120));
  $("#loadMore").addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderList();
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- safety ------------------------------------------------------ */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ---------- init -------------------------------------------------------- */
const ALLOWED_SORTS = ["date-desc","date-asc","rating-desc","rating-asc","votes-desc"];
const ALLOWED_DAYS  = ["all","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function restoreFilters() {
  // 1) stored preference
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (ALLOWED_SORTS.includes(s?.sort)) state.filters.sort = s.sort;
      if (ALLOWED_DAYS.includes(s?.day))   state.filters.day  = s.day;
      if (typeof s?.search === "string")    state.filters.search = s.search;
    }
  } catch {}

  // 2) URL hash overrides
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const sort = params.get("sort");
  const day = params.get("day");
  if (sort && ALLOWED_SORTS.includes(sort)) state.filters.sort = sort;
  if (day  && ALLOWED_DAYS.includes(day))   state.filters.day  = day;

  // 3) reflect into DOM controls
  const sel = $("#sortBy"); if (sel) sel.value = state.filters.sort;
  $$("#dayChips .chip").forEach(c => c.classList.toggle("chip-on", c.dataset.day === state.filters.day));
  const box = $("#searchBox"); if (box) box.value = state.filters.search || "";
}

async function init() {
  renderMasthead();
  wireFilters();
  restoreFilters();
  try {
    const data = await loadData();
    state.all = data;
    renderFeature(data);
    renderStats(data);
    renderByDay(data);
    renderHeatmapYears(data);
    renderHeatmap(data, HEATMAP_RANGE_LAST365);
    renderConstructors(data);
    updateSearchPlaceholder(data);
    applyFilters();
    setStatus(`Loaded ${data.length.toLocaleString()} puzzles`);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to load data: ${err.message}`, true);
  }
}

document.addEventListener("DOMContentLoaded", init);
