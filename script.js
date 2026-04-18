/* ==========================================================================
   THE CROSSWORD LEDGER — client-side app
   Fetches the aggregated poll data, computes stats, and renders the UI.
   ========================================================================== */

const API_URL = "https://crossword.x7x11x13.workers.dev/";
const DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const PAGE_SIZE = 25;

const state = {
  all: [],          // raw array from API, oldest→newest sorted
  filtered: [],
  visibleCount: PAGE_SIZE,
  filters: { day: "all", sort: "date-desc", search: "" },
};

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
async function loadData() {
  setStatus("Setting the type…");
  const r = await fetch(API_URL, { cache: "no-cache" });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const raw = await r.json();
  const enriched = raw
    .filter(e => e && e.dateString)
    .map(e => ({ ...e, date: parseDate(e.dateString) }))
    .sort((a, b) => a.date - b.date); // oldest first
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
  }
  if (worst) {
    $("#statWorstRating").textContent = worst.averageRating.toFixed(2);
    $("#statWorstDate").innerHTML = `<em>${worst.dayName}, ${fmtShortDate(worst.date)}</em><br>${escapeHtml(worst.author)}`;
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
        <div class="byday-name">${d.slice(0,3).toUpperCase()}day</div>
        <div class="byday-avg">${avg.toFixed(2)}</div>
        <div class="byday-meta"><em>${arr.length.toLocaleString()} puzzles</em></div>
        <div class="byday-bar">${bars}</div>
        <div class="byday-scale"><span>Exc.</span><span>Terr.</span></div>
      </div>
    `;
  }).join("");
}

/* ---------- HEATMAP ----------------------------------------------------- */
let activeTip = null;

function renderHeatmapYears(data) {
  const sel = $("#heatmapYear");
  const years = [...new Set(data.map(e => e.date.getFullYear()))].sort((a,b) => b - a);
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  sel.value = years[0];
  sel.addEventListener("change", () => renderHeatmap(data, Number(sel.value)));
}

function renderHeatmap(data, year) {
  const host = $("#heatmap");
  host.innerHTML = "";

  // Build lookup keyed by YYYY-MM-DD for this year
  const byKey = new Map();
  for (const e of data) {
    if (e.date.getFullYear() === year) {
      byKey.set(keyForDate(e.date), e);
    }
  }

  // Build the grid: start from the Monday on/before Jan 1; end at the Sunday on/after Dec 31.
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  // shift to Monday-based week (Mon=0..Sun=6)
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
      const sameYear = cur.getFullYear() === year;
      const inRange = sameYear && cur <= end;
      const isFuture = cur > today;

      if (!sameYear) {
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
          cell.style.gridColumn = col + 1;
          cell.style.gridRow = row + 1;
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

      // track first column of each month to anchor month labels below
      if (sameYear && cur.getDate() <= 7 && row === 0) {
        monthPositions[cur.getMonth()] = col;
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
  // place labels using CSS grid proportional to columns
  const entries = Object.entries(positions).map(([m, col]) => [Number(m), Number(col)]);
  entries.sort((a, b) => a[0] - b[0]);
  host.style.display = "grid";
  host.style.gridTemplateColumns = `repeat(${cols}, 14px)`;
  host.style.gap = "2px";
  host.style.paddingLeft = "44px";
  host.innerHTML = "";
  entries.forEach(([m, col]) => {
    const span = document.createElement("span");
    span.textContent = months[m];
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
function applyFilters() {
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
  const toShow = state.filtered.slice(0, state.visibleCount);
  host.innerHTML = toShow.map(puzzleListItem).join("");

  $("#archiveCount").textContent =
    `Showing ${toShow.length.toLocaleString()} of ${state.filtered.length.toLocaleString()} puzzles`;
  $("#loadMore").style.display = state.visibleCount < state.filtered.length ? "" : "none";
}

function puzzleListItem(e) {
  const score = e.averageRating;
  const cls = ratingClass(score);
  const nyt = nytUrlForDate(e.date);
  return `
    <li class="puzzle-item">
      <div class="pi-day">${e.dayName.slice(0,3).toUpperCase()}<strong>${String(e.date.getDate()).padStart(2,"0")}</strong></div>
      <div class="pi-date">${fmtShortDate(e.date)}</div>
      <div class="pi-meta">
        <div class="pi-author">${escapeHtml(e.author || "—")}</div>
        <div class="pi-votes">${e.votes.toLocaleString()} votes · Ed. ${escapeHtml(e.editor || "—")}</div>
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
async function init() {
  renderMasthead();
  wireFilters();
  try {
    const data = await loadData();
    state.all = data;
    renderFeature(data);
    renderStats(data);
    renderByDay(data);
    renderHeatmapYears(data);
    renderHeatmap(data, new Date().getFullYear());
    applyFilters();
    setStatus(`Loaded ${data.length.toLocaleString()} puzzles`);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to load data: ${err.message}`, true);
  }
}

document.addEventListener("DOMContentLoaded", init);
