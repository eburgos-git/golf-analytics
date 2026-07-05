/* ============================================================
   Golf Analytics — lógica principal
   Datos del Rapsodo MLM. Almacenamiento local (localStorage).
   ============================================================ */

const STORE_KEY = "golf_sessions_v2";
const PREF_KEY = "golf_prefs_v2";
const GOALS_KEY = "golf_goals_v1";

/* ---------- Estado ---------- */
let state = {
  sessions: [],          // [{id, date, name, fileName, shots:[...]}]
  goals: [],             // [{id, club, type:"fairway"|"side", sideMax, targetPct, windowDays, minCarry, createdAt}]
  prefs: {
    unit: "imperial",    // imperial (yd/mph) | metric (m/kmh)
    hand: "right",       // right | left
    benchmark: "amateur",// amateur | pro_senior
    fairway: 36,         // ancho de fairway en YARDAS (para % en calle)
    outliers: true       // excluir tiros atípicos (tops/lecturas erróneas) de las estadísticas
  }
};
const charts = {}; // referencias a instancias Chart.js por id

/* ---------- Utilidades de unidades ---------- */
const U = {
  dist(yd) { return state.prefs.unit === "metric" ? yd * 0.9144 : yd; },
  speed(mph) { return state.prefs.unit === "metric" ? mph * 1.609344 : mph; },
  height(ft) { return state.prefs.unit === "metric" ? ft * 0.3048 : ft; },
  toYd(v) { return state.prefs.unit === "metric" ? v / 0.9144 : v; }, // input de usuario → yardas internas
  distU() { return state.prefs.unit === "metric" ? "m" : "yd"; },
  speedU() { return state.prefs.unit === "metric" ? "km/h" : "mph"; },
  heightU() { return state.prefs.unit === "metric" ? "m" : "ft"; }
};

function fmt(n, dec = 1) {
  if (n === null || n === undefined || isNaN(n)) return "–";
  return Number(n).toFixed(dec);
}

/* ---------- Normalización de palos ---------- */
const CLUB_ORDER = [
  "driver", "3w", "5w", "7w", "9w",
  "2h", "3h", "4h", "5h", "6h",
  "2i", "3i", "4i", "5i", "6i", "7i", "8i", "9i",
  "pw", "gw", "aw", "sw", "lw"
];
const CLUB_LABEL = {
  driver: "Driver",
  "2w": "2 Madera", "3w": "3 Madera", "5w": "5 Madera", "7w": "7 Madera", "9w": "9 Madera",
  "2h": "Híbrido 2", "3h": "Híbrido 3", "4h": "Híbrido 4", "5h": "Híbrido 5", "6h": "Híbrido 6",
  "2i": "Hierro 2", "3i": "Hierro 3", "4i": "Hierro 4", "5i": "Hierro 5", "6i": "Hierro 6",
  "7i": "Hierro 7", "8i": "Hierro 8", "9i": "Hierro 9",
  pw: "PW (Pitching)", gw: "GW (Gap)", aw: "AW (Approach)", sw: "SW (Sand)", lw: "LW (Lob)"
};

function normalizeClub(raw) {
  if (!raw) return "desconocido";
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  s = s.replace("wood", "w").replace("madera", "w")
       .replace("iron", "i").replace("hierro", "i")
       .replace("hybrid", "h").replace("hibrido", "h").replace("híbrido", "h");
  if (["driver", "d", "dr", "1w"].includes(s)) return "driver";
  if (["pw", "p", "pitching"].includes(s)) return "pw";
  if (["gw", "g", "gap"].includes(s)) return "gw";
  if (["aw", "a", "approach"].includes(s)) return "aw";
  if (["sw", "s", "sand"].includes(s)) return "sw";
  if (["lw", "l", "lob"].includes(s)) return "lw";
  let m = s.match(/^(\d+)(w|i|h)$/);
  if (m) return m[1] + m[2];
  return s;
}
function clubLabel(key) { return CLUB_LABEL[key] || key.toUpperCase(); }
function clubSortIndex(key) {
  const i = CLUB_ORDER.indexOf(key);
  return i === -1 ? 999 : i;
}

/* ---------- Parseo de CSV ---------- */
function parseCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];
  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase());
  const idx = name => header.findIndex(h => h.includes(name));
  const col = {
    club: idx("club type"),
    carry: idx("carry"),
    total: idx("total"),
    ball: idx("ball speed"),
    la: idx("launch angle"),
    ld: idx("launch direction"),
    apex: idx("apex"),
    side: idx("side"),
    cs: idx("club speed"),
    smash: idx("smash")
  };
  const num = v => {
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? null : n;
  };
  const shots = [];
  for (let i = 1; i < lines.length; i++) {
    const r = parseCSVLine(lines[i]);
    const club = normalizeClub(r[col.club]);
    const carry = num(r[col.carry]);
    if (!club || carry === null) continue;
    shots.push({
      club,
      carry,
      total: num(r[col.total]),
      ball: num(r[col.ball]),
      la: num(r[col.la]),
      ld: num(r[col.ld]),
      apex: num(r[col.apex]),
      side: num(r[col.side]),
      cs: num(r[col.cs]),
      smash: num(r[col.smash])
    });
  }
  return shots;
}

/* Intenta extraer fecha del nombre de archivo (MMDDYY o MMDDYYYY o YYYYMMDD) */
function dateFromFilename(name) {
  const digits = name.match(/(\d{8}|\d{6})/g);
  if (!digits) return null;
  for (const d of digits) {
    let y, m, day;
    if (d.length === 8) {
      // probar YYYYMMDD
      if (+d.slice(0, 4) > 1990) { y = +d.slice(0, 4); m = +d.slice(4, 6); day = +d.slice(6, 8); }
      else { m = +d.slice(0, 2); day = +d.slice(2, 4); y = +d.slice(4, 8); }
    } else { // MMDDYY
      m = +d.slice(0, 2); day = +d.slice(2, 4); y = 2000 + +d.slice(4, 6);
    }
    if (m >= 1 && m <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

/* ---------- Estadística ---------- */
function mean(arr) { const a = arr.filter(x => x != null); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function std(arr) {
  const a = arr.filter(x => x != null);
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}
function median(arr) {
  const a = arr.filter(x => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function percentile(arr, p) {
  const a = arr.filter(x => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = (a.length - 1) * p / 100;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
/* Regresión lineal simple sobre una serie (x = 0..n-1).
   Devuelve pendiente y cambio total a lo largo de la serie. */
function linreg(ys) {
  const n = ys.length;
  if (n < 2) return null;
  const xm = (n - 1) / 2, ym = mean(ys);
  let sxy = 0, sxx = 0;
  ys.forEach((y, i) => { sxy += (i - xm) * (y - ym); sxx += (i - xm) ** 2; });
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, total: slope * (n - 1) };
}

/* ---------- Persistencia ---------- */
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.sessions));
  localStorage.setItem(PREF_KEY, JSON.stringify(state.prefs));
  localStorage.setItem(GOALS_KEY, JSON.stringify(state.goals));
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(s)) state.sessions = s;
    const p = JSON.parse(localStorage.getItem(PREF_KEY));
    if (p) state.prefs = { ...state.prefs, ...p };
    const g = JSON.parse(localStorage.getItem(GOALS_KEY));
    if (Array.isArray(g)) state.goals = g;
  } catch (e) { /* ignore */ }
}

/* ---------- Filtro por rango de fecha (global) ---------- */
// preset: all | last | 7d | 30d | 90d | ytd | custom
let dateFilter = { preset: "all", from: null, to: null };

function todayStr() { return new Date().toISOString().slice(0, 10); }
function sessionDates() { return state.sessions.map(s => s.date).filter(Boolean).sort(); }

function rangeFor(preset) {
  const today = todayStr();
  if (preset === "7d" || preset === "30d" || preset === "90d") {
    const days = { "7d": 7, "30d": 30, "90d": 90 }[preset];
    const d = new Date(); d.setDate(d.getDate() - days + 1);
    return { from: d.toISOString().slice(0, 10), to: today };
  }
  if (preset === "ytd") return { from: today.slice(0, 4) + "-01-01", to: today };
  return null;
}
function effectiveRange() {
  if (dateFilter.preset === "custom") return { from: dateFilter.from, to: dateFilter.to };
  return rangeFor(dateFilter.preset);
}

function filteredSessions() {
  const p = dateFilter.preset;
  if (p === "all") return state.sessions.slice();
  if (p === "last") {
    const dates = sessionDates();
    if (!dates.length) return state.sessions.slice();
    const max = dates[dates.length - 1];
    return state.sessions.filter(s => s.date === max);
  }
  const r = effectiveRange();
  if (!r) return state.sessions.slice();
  return state.sessions.filter(s => {
    if (!s.date) return false;
    if (r.from && s.date < r.from) return false;
    if (r.to && s.date > r.to) return false;
    return true;
  });
}

function activeShots() {
  const shots = [];
  filteredSessions().forEach(s => s.shots.forEach(sh => shots.push({ ...sh, _date: s.date, _sid: s.id })));
  return shots;
}
function clubsPresent(shots) {
  const set = [...new Set(shots.map(s => s.club))];
  return set.sort((a, b) => clubSortIndex(a) - clubSortIndex(b));
}

/* Tiros atípicos: cerca de 1.5×IQR del carry del palo (tops, duffs o lecturas
   erróneas del monitor). Se excluyen de las estadísticas si la preferencia está activa. */
function dropOutliers(sh) {
  if (!state.prefs.outliers || sh.length < 8) return { keep: sh, out: [] };
  const carries = sh.map(s => s.carry);
  const q1 = percentile(carries, 25), q3 = percentile(carries, 75);
  const iqr = q3 - q1, lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const keep = [], out = [];
  sh.forEach(s => ((s.carry < lo || s.carry > hi) ? out : keep).push(s));
  return { keep, out };
}

/* Curva en vuelo (yd): side carry real menos el side que explicaría solo la
   dirección de salida. >0 = la bola curvó hacia la derecha durante el vuelo. */
function curveOf(s) {
  if (s.side == null || s.carry == null) return null;
  return s.side - s.carry * Math.tan((s.ld || 0) * Math.PI / 180);
}

/* Estadísticas agregadas por palo */
function clubStats(shots, club) {
  const raw = shots.filter(s => s.club === club);
  const { keep: sh, out } = dropOutliers(raw);
  const carries = sh.map(s => s.carry);
  const smashes = sh.map(s => s.smash);
  const curves = sh.map(curveOf);
  // Carry "bien golpeado": tiros dentro del mejor 40% de smash factor del palo
  const smashCut = percentile(smashes, 60);
  const wellCarry = smashCut != null
    ? mean(sh.filter(s => s.smash != null && s.smash >= smashCut).map(s => s.carry))
    : null;
  return {
    club, n: sh.length, nRaw: raw.length, outliers: out,
    carryAvg: mean(carries), carryStd: std(carries),
    carryMed: median(carries), carryMin: Math.min(...carries), carryMax: Math.max(...carries),
    p25: percentile(carries, 25), p75: percentile(carries, 75),
    totalAvg: mean(sh.map(s => s.total)),
    rollAvg: mean(sh.map(s => (s.total != null && s.carry != null) ? s.total - s.carry : null)),
    ballAvg: mean(sh.map(s => s.ball)), ballStd: std(sh.map(s => s.ball)),
    csAvg: mean(sh.map(s => s.cs)),
    smashAvg: mean(sh.map(s => s.smash)), smashStd: std(sh.map(s => s.smash)),
    laAvg: mean(sh.map(s => s.la)), laStd: std(sh.map(s => s.la)),
    ldAvg: mean(sh.map(s => s.ld)), ldStd: std(sh.map(s => s.ld)),
    apexAvg: mean(sh.map(s => s.apex)),
    sideAvg: mean(sh.map(s => s.side)), sideStd: std(sh.map(s => s.side)),
    curveMed: median(curves), curves,
    wellCarry,
    shots: sh
  };
}

/* ---------- Forma de tiro (salida × curva) ---------- */
const SHAPE_TH = 2.5; // grados para considerar salida/curva "desviada"
function classifyShot(s) {
  if (s.side == null && s.ld == null) return null;
  const cv = curveOf(s);
  const curveDeg = cv == null ? 0 : Math.atan2(cv, s.carry || 1) * 180 / Math.PI;
  const cat = v => (v < -SHAPE_TH ? -1 : v > SHAPE_TH ? 1 : 0);
  return { start: cat(s.ld || 0), curve: cat(curveDeg) };
}
function shapeName(start, curve) {
  const hs = state.prefs.hand === "right" ? 1 : -1;
  const key = `${start * hs},${curve * hs}`; // +1 = lado del slice para el jugador
  return {
    "-1,-1": "Pull hook", "-1,0": "Pull", "-1,1": "Pull fade",
    "0,-1": "Draw", "0,0": "Recto", "0,1": "Fade",
    "1,-1": "Push draw", "1,0": "Push", "1,1": "Push slice"
  }[key];
}
function shapeMatrix(sh) {
  const counts = {}; let n = 0;
  sh.forEach(s => {
    const c = classifyShot(s); if (!c) return;
    const k = `${c.start},${c.curve}`;
    counts[k] = (counts[k] || 0) + 1; n++;
  });
  return { counts, n };
}

/* ---------- Gapping de la bolsa (solapes y huecos) ---------- */
function computeGapping(shots, minN = 5) {
  const sts = clubsPresent(shots)
    .map(c => clubStats(shots, c))
    .filter(st => st.n >= minN && st.carryAvg != null);
  const pairs = [];
  for (let i = 0; i < sts.length - 1; i++) {
    const a = sts[i], b = sts[i + 1]; // a = palo más largo según orden de bolsa
    const gap = a.carryAvg - b.carryAvg;
    let type = "ok";
    if (gap < 0) type = "invertido";
    else if (gap < 6) type = "solape";
    else if (gap > 25) type = "hueco";
    pairs.push({ a, b, gap, type });
  }
  return pairs;
}

/* ---------- Calentamiento / fatiga dentro de la sesión ----------
   Divide cada sesión en tercios según el orden de los tiros y compara
   carry relativo (% del promedio del palo en esa sesión) y smash. */
function warmupBuckets(club) {
  const rel = [[], [], []], sm = [[], [], []];
  let sessions = 0;
  filteredSessions().forEach(s => {
    const byClub = {};
    s.shots.forEach(sh => {
      if (club !== "__all" && sh.club !== club) return;
      (byClub[sh.club] = byClub[sh.club] || []).push(sh);
    });
    let used = false;
    Object.values(byClub).forEach(arr => {
      if (arr.length < 6) return; // muy pocos tiros para dividir en tercios
      used = true;
      const m = mean(arr.map(x => x.carry));
      arr.forEach((sh, i) => {
        const t = Math.min(2, Math.floor(i * 3 / arr.length));
        if (m) rel[t].push(100 * sh.carry / m);
        if (sh.smash != null) sm[t].push(sh.smash);
      });
    });
    if (used) sessions++;
  });
  return { rel: rel.map(mean), smash: sm.map(mean), sessions };
}

/* Consistencia 0-100 a partir del coef. de variación del carry */
function consistencyScore(st) {
  if (!st.carryAvg || st.n < 2) return null;
  const cv = st.carryStd / st.carryAvg;
  return Math.max(0, Math.min(100, Math.round(100 * (1 - cv / 0.12))));
}
function consistencyLabel(score) {
  if (score == null) return { txt: "–", cls: "" };
  if (score >= 80) return { txt: "Excelente", cls: "good" };
  if (score >= 60) return { txt: "Buena", cls: "ok" };
  if (score >= 40) return { txt: "Regular", cls: "warn" };
  return { txt: "Irregular", cls: "bad" };
}

/* En calle: apuntando al centro, una bola está fuera si |side carry| > mitad del ancho.
   Devuelve conteos y % dentro/fuera, con desglose izquierda/derecha. */
function fairwayStats(st) {
  const half = state.prefs.fairway / 2;
  const sides = st.shots.map(s => s.side).filter(x => x != null);
  if (!sides.length) return null;
  let inn = 0, left = 0, right = 0;
  sides.forEach(v => { if (v > half) right++; else if (v < -half) left++; else inn++; });
  const n = sides.length;
  return { n, in: inn, out: n - inn, left, right, half, inPct: Math.round(100 * inn / n), outPct: Math.round(100 * (n - inn) / n) };
}
function fairwayLabel(pct) {
  if (pct == null) return "";
  if (pct >= 70) return "good";
  if (pct >= 50) return "ok";
  if (pct >= 35) return "warn";
  return "bad";
}

/* ============================================================
   MOTOR DE PATRONES / INSIGHTS
   Genera tarjetas: fortalezas, a-mejorar, patrones.
   ============================================================ */
function generateInsights(shots) {
  const out = { strength: [], improve: [], pattern: [] };
  const clubs = clubsPresent(shots);

  clubs.forEach(club => {
    const st = clubStats(shots, club);
    if (st.n < 3) return;
    const lbl = clubLabel(club);
    const bench = BENCHMARKS[state.prefs.benchmark].data[club];

    /* --- Dirección de salida (cara / alineación) --- */
    if (st.ldAvg != null && st.n >= 5 && Math.abs(st.ldAvg) > 3) {
      const dir = st.ldAvg > 0 ? "derecha" : "izquierda";
      out.pattern.push({
        club: lbl,
        title: `Salida desviada a la ${dir} — ${lbl}`,
        body: `Tus bolas <b>salen</b> en promedio ${fmt(Math.abs(st.ldAvg), 1)}° a la ${dir}, antes de curvar. La dirección de salida depende sobre todo de la cara del palo en el impacto y de tu alineación: revisa apuntado, agarre y posición de bola.`
      });
    }

    /* --- Curva en vuelo (relación cara-trayectoria) --- */
    if (st.curveMed != null && st.n >= 5) {
      const cvs = st.curves.filter(c => c != null);
      const cSame = cvs.length ? cvs.filter(c => Math.sign(c) === Math.sign(st.curveMed)).length / cvs.length : 0;
      if (Math.abs(st.curveMed) > 8 && cSame > 0.6) {
        const dir = st.curveMed > 0 ? "derecha" : "izquierda";
        const toSlice = (st.curveMed > 0) === (state.prefs.hand === "right");
        out.pattern.push({
          club: lbl,
          title: `Curva tipo ${toSlice ? "fade/slice" : "draw/hook"} — ${lbl}`,
          body: `Además de la salida, la bola <b>curva en vuelo</b> ~${fmt(U.dist(Math.abs(st.curveMed)), 0)} ${U.distU()} hacia la ${dir} (${Math.round(cSame * 100)}% de los tiros curvan a ese lado). Indica cara ${toSlice ? "abierta" : "cerrada"} respecto a la trayectoria del swing.`
        });
      }
    }

    /* --- Tiro típico (forma dominante en la matriz 3×3) --- */
    const sm = shapeMatrix(st.shots);
    if (sm.n >= 8) {
      const top = Object.entries(sm.counts).sort((x, y) => y[1] - x[1])[0];
      const pct = Math.round(100 * top[1] / sm.n);
      const [ts, tc] = top[0].split(",").map(Number);
      if (pct >= 40 && !(ts === 0 && tc === 0)) {
        out.pattern.push({
          club: lbl,
          title: `Tiro típico: ${shapeName(ts, tc)} — ${lbl}`,
          body: `El <b>${pct}%</b> de tus tiros con ${lbl} son <b>${shapeName(ts, tc)}</b>. Conocer tu forma dominante te permite apuntar compensándola en cancha, o trabajarla en el rango. Mira la matriz en la pestaña Palo.`
        });
      }
    }

    /* --- Costo del impacto descentrado (con tu propia data) --- */
    if (st.wellCarry != null && st.carryAvg != null && st.n >= 8 && st.wellCarry - st.carryAvg >= 5) {
      out.improve.push({
        club: lbl,
        title: `Pierdes ~${fmt(U.dist(st.wellCarry - st.carryAvg), 0)} ${U.distU()} por impacto — ${lbl}`,
        body: `Cuando golpeas bien (tu mejor 40% de smash), la bola vuela ${fmt(U.dist(st.wellCarry), 0)} ${U.distU()}, vs ${fmt(U.dist(st.carryAvg), 0)} de promedio. Esa distancia ya está en tu swing: es solo centrar el impacto.`
      });
    }

    /* --- Dispersión lateral alta --- */
    if (st.sideStd != null && st.sideStd > 35) {
      out.improve.push({
        club: lbl,
        title: `Dispersión lateral alta — ${lbl}`,
        body: `Variación lateral de ±${fmt(U.dist(st.sideStd), 0)} ${U.distU()}. La cara del palo llega muy variable. Prioriza control de cara antes que distancia.`
      });
    } else if (st.sideStd != null && st.sideStd < 15 && Math.abs(st.sideAvg) < 12 && st.n >= 4) {
      out.strength.push({
        club: lbl,
        title: `Buena precisión lateral — ${lbl}`,
        body: `Dispersión lateral muy contenida (±${fmt(U.dist(st.sideStd), 0)} ${U.distU()}) y bien centrada. Palo confiable para apuntar a bandera.`
      });
    }

    /* --- En calle (relevante para driver/maderas/híbridos) --- */
    const isTee = club === "driver" || /^\d[wh]$/.test(club); // maderas e híbridos (no PW/SW/LW)
    if (isTee) {
      const fw = fairwayStats(st);
      if (fw && fw.n >= 4) {
        const side = fw.left === fw.right ? "" : (fw.left > fw.right ? " (sobre todo a la izquierda)" : " (sobre todo a la derecha)");
        if (fw.inPct < 50) {
          out.improve.push({ club: lbl, title: `Pocas bolas en calle — ${lbl}`, body: `Solo el <b>${fw.inPct}%</b> caería en una calle de ${fmt(U.dist(state.prefs.fairway), 0)} ${U.distU()} apuntando al centro: ${fw.out} de ${fw.n} tiros fuera (${fw.left} izq · ${fw.right} der)${side}. Reducir la dispersión lateral aquí baja tu score directamente.` });
        } else if (fw.inPct >= 75) {
          out.strength.push({ club: lbl, title: `Fiable desde el tee — ${lbl}`, body: `El <b>${fw.inPct}%</b> de tus bolas caería en calle (${fmt(U.dist(state.prefs.fairway), 0)} ${U.distU()}). Palo seguro para poner la bola en juego.` });
        }
      }
    }

    /* --- Consistencia de distancia --- */
    const cs = consistencyScore(st);
    if (cs != null && cs >= 80) {
      out.strength.push({ club: lbl, title: `Distancia muy consistente — ${lbl}`, body: `Carry estable en ${fmt(U.dist(st.carryAvg), 0)} ${U.distU()} (±${fmt(U.dist(st.carryStd), 0)}). Puedes confiar en este número para tu juego.` });
    } else if (cs != null && cs < 40) {
      out.improve.push({ club: lbl, title: `Distancia irregular — ${lbl}`, body: `El carry varía mucho (±${fmt(U.dist(st.carryStd), 0)} ${U.distU()} sobre ${fmt(U.dist(st.carryAvg), 0)}). Suele venir de impacto descentrado o tempo inconsistente.` });
    }

    /* --- Smash factor / calidad de impacto --- */
    const ideal = IDEAL_SMASH[club];
    if (st.smashAvg != null && ideal) {
      if (st.smashAvg < ideal - 0.08) {
        out.improve.push({ club: lbl, title: `Impacto descentrado — ${lbl}`, body: `Smash factor ${fmt(st.smashAvg, 2)} vs ${fmt(ideal, 2)} ideal. Estás perdiendo energía: golpes fuera del centro de la cara. Pierdes ~${fmt((ideal - st.smashAvg) * (st.csAvg || 80) * 1.8, 0)} ${U.distU()} de potencial.` });
      } else if (st.smashAvg >= ideal - 0.02) {
        out.strength.push({ club: lbl, title: `Impacto sólido — ${lbl}`, body: `Smash factor ${fmt(st.smashAvg, 2)} (ideal ${fmt(ideal, 2)}). Estás comprimiendo bien la bola en el centro de la cara.` });
      }
    }

    /* --- Ventana de launch angle --- */
    const win = LAUNCH_WINDOW[club];
    if (st.laAvg != null && win) {
      if (st.laAvg < win[0]) out.improve.push({ club: lbl, title: `Lanzamiento bajo — ${lbl}`, body: `Launch angle ${fmt(st.laAvg, 1)}° (ideal ${win[0]}-${win[1]}°). Bola demasiado plana: pierdes altura y carry. Revisa ángulo de ataque / posición de bola.` });
      else if (st.laAvg > win[1]) out.improve.push({ club: lbl, title: `Lanzamiento muy alto — ${lbl}`, body: `Launch angle ${fmt(st.laAvg, 1)}° (ideal ${win[0]}-${win[1]}°). Bola que sube demasiado y se queda corta o sufre con viento.` });
    }

    /* --- Comparación vs benchmark (carry) --- */
    if (bench && st.carryAvg != null) {
      const gap = st.carryAvg - bench.carry;
      if (gap >= 8) out.strength.push({ club: lbl, title: `Superas al ${BENCHMARKS[state.prefs.benchmark].label} — ${lbl}`, body: `Tu carry ${fmt(U.dist(st.carryAvg), 0)} ${U.distU()} supera la referencia (${fmt(U.dist(bench.carry), 0)}) por ${fmt(U.dist(gap), 0)} ${U.distU()}.` });
      else if (gap <= -15) out.improve.push({ club: lbl, title: `Por debajo de la referencia — ${lbl}`, body: `Tu carry ${fmt(U.dist(st.carryAvg), 0)} ${U.distU()} está ${fmt(U.dist(-gap), 0)} ${U.distU()} bajo el ${BENCHMARKS[state.prefs.benchmark].label} (${fmt(U.dist(bench.carry), 0)}).` });
    }
  });

  /* --- Gapping de la bolsa: solapes y huecos entre palos consecutivos --- */
  computeGapping(shots).forEach(p => {
    const la = clubLabel(p.a.club), lb = clubLabel(p.b.club);
    if (p.type === "solape" || p.type === "invertido") {
      const inv = p.type === "invertido" ? ` De hecho, ${lb} te vuela <b>más</b> que ${la}.` : "";
      out.improve.push({
        title: `Solape de distancias: ${la} y ${lb}`,
        body: `Vuelan casi lo mismo (${fmt(U.dist(p.a.carryAvg), 0)} vs ${fmt(U.dist(p.b.carryAvg), 0)} ${U.distU()}).${inv} En cancha son intercambiables: suele indicar impacto descentrado con el palo largo. Un gap sano es de 10–15 ${U.distU()}.`
      });
    } else if (p.type === "hueco") {
      out.improve.push({
        title: `Hueco de ${fmt(U.dist(p.gap), 0)} ${U.distU()} entre ${la} y ${lb}`,
        body: `Entre ${la} (${fmt(U.dist(p.a.carryAvg), 0)} ${U.distU()}) y ${lb} (${fmt(U.dist(p.b.carryAvg), 0)}) queda una zona de distancias sin palo. Considera un palo intermedio o practica medios tiros para cubrirla.`
      });
    }
  });

  /* --- Calentamiento / fatiga dentro de la sesión --- */
  const wb = warmupBuckets("__all");
  if (wb.sessions >= 3 && wb.rel[0] != null && wb.rel[2] != null) {
    const d = wb.rel[2] - wb.rel[0];
    if (d <= -3) {
      out.pattern.push({
        title: "Bajas al final de la sesión",
        body: `En el último tercio de tus sesiones el carry cae un <b>${fmt(Math.abs(d), 1)}%</b> respecto al inicio (promedio de ${wb.sessions} sesiones). Puede ser fatiga: considera sesiones más cortas o pausas.`
      });
    } else if (d >= 3) {
      out.pattern.push({
        title: "Necesitas más calentamiento",
        body: `Tu primer tercio de sesión vuela un <b>${fmt(d, 1)}%</b> menos que el final (promedio de ${wb.sessions} sesiones). Calienta antes de contar tus tiros, y en cancha calienta antes del tee 1.`
      });
    }
  }

  /* --- Evolución entre sesiones (tendencia por regresión) dentro del rango --- */
  const fsessions = filteredSessions();
  if (fsessions.length >= 2) {
    const ordered = [...fsessions].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const allClubs = clubsPresent(activeShots());
    allClubs.forEach(club => {
      const series = ordered.map(s => {
        const sh = s.shots.filter(x => x.club === club);
        return sh.length >= 2 ? mean(sh.map(x => x.carry)) : null;
      }).filter(x => x != null);
      // Con 3+ sesiones usamos regresión (menos sensible a una sesión suelta);
      // con 2, la diferencia directa.
      const change = series.length >= 3 ? (linreg(series) || {}).total
                   : series.length === 2 ? series[1] - series[0] : null;
      if (change == null) return;
      const nTxt = series.length >= 3 ? `tendencia sobre ${series.length} sesiones` : "entre tus 2 sesiones";
      if (change >= 8) out.strength.push({ club: clubLabel(club), title: `Mejora real — ${clubLabel(club)}`, body: `Tu carry subió ~${fmt(U.dist(change), 0)} ${U.distU()} (${nTxt}). Progreso sostenido.` });
      else if (change <= -8) out.improve.push({ club: clubLabel(club), title: `Retroceso — ${clubLabel(club)}`, body: `Tu carry bajó ~${fmt(U.dist(-change), 0)} ${U.distU()} (${nTxt}). Revisa qué cambió en tu técnica.` });
    });
  }

  return out;
}

/* ============================================================
   GRÁFICOS (Chart.js)
   ============================================================ */
const COLORS = {
  green: "#2e7d4f", greenL: "#5bbf86", gold: "#d4a13a",
  red: "#d65a5a", blue: "#4a8fd6", grid: "rgba(255,255,255,.08)",
  text: "#c7d0c9"
};
function makeChart(id, config) {
  const el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) charts[id].destroy();
  Chart.defaults.color = COLORS.text;
  Chart.defaults.font.family = "system-ui, -apple-system, sans-serif";
  charts[id] = new Chart(el, config);
}
function gridOpts(extra = {}) {
  return {
    grid: { color: COLORS.grid }, ticks: { color: COLORS.text }, ...extra
  };
}

/* ============================================================
   RENDER PRINCIPAL
   ============================================================ */
function renderAll() {
  const hasData = state.sessions.length > 0;
  document.getElementById("empty-state").style.display = hasData ? "none" : "flex";
  document.getElementById("app-main").style.display = hasData ? "block" : "none";
  document.getElementById("toolbar").style.display = hasData ? "flex" : "none";
  if (!hasData) return;

  renderRangeFilter();
  renderOverview();
  renderClubTab();
  renderEvolution();
  renderPatterns();
  renderGoals();
  renderBenchmark();
  renderSessions();
  syncPrefControls();
}

function renderRangeFilter() {
  const sel = document.getElementById("range-preset");
  sel.value = dateFilter.preset;
  const custom = dateFilter.preset === "custom";
  const from = document.getElementById("range-from");
  const to = document.getElementById("range-to");
  from.style.display = custom ? "" : "none";
  to.style.display = custom ? "" : "none";
  if (custom) { from.value = dateFilter.from || ""; to.value = dateFilter.to || ""; }
  const n = filteredSessions().length;
  document.getElementById("range-count").textContent = `${n} ${n === 1 ? "sesión" : "sesiones"} · ${activeShots().length} tiros`;
}

/* ---------- RESUMEN ---------- */
function renderOverview() {
  const shots = activeShots();
  const clubs = clubsPresent(shots);
  const dates = filteredSessions().map(s => s.date).filter(Boolean).sort();
  document.getElementById("ov-shots").textContent = shots.length;
  document.getElementById("ov-clubs").textContent = clubs.length;
  document.getElementById("ov-sessions").textContent = filteredSessions().length;
  document.getElementById("ov-range").textContent = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "–";

  // Tabla de la bolsa
  const bench = BENCHMARKS[state.prefs.benchmark].data;
  const rows = clubs.map(c => {
    const st = clubStats(shots, c);
    const cs = consistencyScore(st);
    const cl = consistencyLabel(cs);
    const b = bench[c];
    const gap = b ? st.carryAvg - b.carry : null;
    const gapTxt = gap == null ? "–" : `<span class="${gap >= 0 ? 'pos' : 'neg'}">${gap >= 0 ? '+' : ''}${fmt(U.dist(gap), 0)}</span>`;
    const fw = fairwayStats(st);
    const fwTxt = fw ? `<span class="badge ${fairwayLabel(fw.inPct)}">${fw.inPct}%</span>` : "–";
    return `<tr>
      <td class="club-cell">${clubLabel(c)}</td>
      <td>${st.n}</td>
      <td class="num">${fmt(U.dist(st.carryAvg), 0)}</td>
      <td class="num">±${fmt(U.dist(st.carryStd), 0)}</td>
      <td class="num muted">${fmt(U.dist(st.p25), 0)}–${fmt(U.dist(st.p75), 0)}</td>
      <td class="num">${fmt(U.speed(st.ballAvg), 0)}</td>
      <td class="num">${fmt(st.smashAvg, 2)}</td>
      <td class="num">±${fmt(U.dist(st.sideStd), 0)}</td>
      <td>${fwTxt}</td>
      <td><span class="badge ${cl.cls}">${cl.txt}</span></td>
      <td class="num">${gapTxt}</td>
    </tr>`;
  }).join("");
  document.getElementById("bag-table-body").innerHTML = rows;
  document.getElementById("bag-bench-label").textContent = BENCHMARKS[state.prefs.benchmark].label;
  document.getElementById("bag-fairway-label").textContent = `${fmt(U.dist(state.prefs.fairway), 0)} ${U.distU()} (±${fmt(U.dist(state.prefs.fairway / 2), 0)})`;

  // Gráfico de carry por palo (gapping)
  const labels = clubs.map(clubLabel);
  const carryData = clubs.map(c => U.dist(clubStats(shots, c).carryAvg));
  const benchData = clubs.map(c => bench[c] ? U.dist(bench[c].carry) : null);
  renderGappingAnalysis(shots);
  renderRecords(shots);

  makeChart("chart-gapping", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: `Tu carry (${U.distU()})`, data: carryData, borderColor: COLORS.green, backgroundColor: "rgba(46,125,79,.18)", fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: COLORS.green, borderWidth: 3 },
        { label: BENCHMARKS[state.prefs.benchmark].label, data: benchData, borderColor: COLORS.gold, backgroundColor: COLORS.gold, tension: .3, pointRadius: 4, pointBackgroundColor: COLORS.gold, borderWidth: 3, borderDash: [6, 4], fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y, 0)} ${U.distU()}` } } },
      scales: { x: gridOpts(), y: gridOpts({ title: { display: true, text: `Carry (${U.distU()})` }, beginAtZero: true }) }
    }
  });
}

/* Lista de solapes/huecos entre palos consecutivos, bajo el gráfico de gapping */
function renderGappingAnalysis(shots) {
  const el = document.getElementById("gapping-analysis");
  if (!el) return;
  const pairs = computeGapping(shots);
  if (!pairs.length) { el.innerHTML = ""; return; }
  const badge = {
    ok: `<span class="badge good">OK</span>`,
    solape: `<span class="badge warn">Solape</span>`,
    invertido: `<span class="badge bad">Invertido</span>`,
    hueco: `<span class="badge bad">Hueco</span>`
  };
  const issues = pairs.filter(p => p.type !== "ok").length;
  el.innerHTML = `
    <div class="gap-head">Gaps entre palos consecutivos ${issues ? `· <span class="neg">${issues} a revisar</span>` : `· <span class="pos">todo sano</span>`} <span class="muted">(ideal 10–15 ${U.distU()})</span></div>
    ${pairs.map(p => `
      <div class="gap-row">
        <span class="gap-clubs">${clubLabel(p.a.club)} → ${clubLabel(p.b.club)}</span>
        <span class="gap-val num">${p.gap >= 0 ? "" : "−"}${fmt(U.dist(Math.abs(p.gap)), 0)} ${U.distU()}</span>
        ${badge[p.type]}
      </div>`).join("")}`;
}

/* Récords personales dentro del rango elegido */
function renderRecords(shots) {
  const el = document.getElementById("records-grid");
  if (!el) return;
  const clubs = clubsPresent(shots);
  let bestCarry = null, bestSmash = null, bestClub = null;
  clubs.forEach(c => {
    const st = clubStats(shots, c);
    st.shots.forEach(s => {
      if (!bestCarry || s.carry > bestCarry.v) bestCarry = { v: s.carry, club: c, date: s._date };
      if (s.smash != null && (!bestSmash || s.smash > bestSmash.v)) bestSmash = { v: s.smash, club: c, date: s._date };
    });
    const cs = consistencyScore(st);
    if (st.n >= 8 && cs != null && (!bestClub || cs > bestClub.v)) bestClub = { v: cs, club: c };
  });
  let bestSession = null;
  filteredSessions().forEach(s => {
    if (s.shots.length < 10) return;
    const m = mean(s.shots.map(x => x.smash));
    if (m != null && (!bestSession || m > bestSession.v)) bestSession = { v: m, date: s.date || s.name };
  });
  const rec = (v, l, s) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
  el.innerHTML =
    (bestCarry ? rec(`${fmt(U.dist(bestCarry.v), 0)} <span class="metric-unit">${U.distU()}</span>`, "Carry récord", `${clubLabel(bestCarry.club)} · ${bestCarry.date || ""}`) : "") +
    (bestSmash ? rec(fmt(bestSmash.v, 2), "Mejor smash", `${clubLabel(bestSmash.club)} · ${bestSmash.date || ""}`) : "") +
    (bestClub ? rec(clubLabel(bestClub.club), "Palo más consistente", `consistencia ${bestClub.v}/100`) : "") +
    (bestSession ? rec(bestSession.date, "Mejor sesión", `smash medio ${fmt(bestSession.v, 2)}`) : "");
}

/* ---------- POR PALO ---------- */
function renderClubTab() {
  const shots = activeShots();
  const clubs = clubsPresent(shots);
  const sel = document.getElementById("club-select");
  const prev = sel.value;
  sel.innerHTML = clubs.map(c => `<option value="${c}">${clubLabel(c)}</option>`).join("");
  sel.value = clubs.includes(prev) ? prev : clubs[0];
  drawClubDetail(sel.value);
}

function drawClubDetail(club) {
  const shots = activeShots();
  const st = clubStats(shots, club);
  if (!st || !st.n) return;
  const bench = BENCHMARKS[state.prefs.benchmark].data[club];

  const metric = (label, val, unit, sub) => `
    <div class="metric">
      <div class="metric-label">${label}</div>
      <div class="metric-val">${val}<span class="metric-unit">${unit || ""}</span></div>
      ${sub ? `<div class="metric-sub">${sub}</div>` : ""}
    </div>`;

  const effic = (st.carryAvg != null && st.csAvg) ? U.dist(st.carryAvg) / U.speed(st.csAvg) : null;
  const wellGain = (st.wellCarry != null && st.carryAvg != null) ? st.wellCarry - st.carryAvg : null;
  document.getElementById("club-metrics").innerHTML =
    metric("Carry medio", fmt(U.dist(st.carryAvg), 0), U.distU(), `mediana ${fmt(U.dist(st.carryMed), 0)} · ±${fmt(U.dist(st.carryStd), 0)}`) +
    metric("Ventana de juego", `${fmt(U.dist(st.p25), 0)}–${fmt(U.dist(st.p75), 0)}`, U.distU(), "aquí cae el 50% central de tus tiros") +
    metric("Bien golpeado", fmt(U.dist(st.wellCarry), 0), U.distU(), wellGain != null ? `mejor 40% de smash · ${wellGain >= 0 ? "+" : ""}${fmt(U.dist(wellGain), 0)} vs media` : "") +
    metric("Total medio", fmt(U.dist(st.totalAvg), 0), U.distU(), `roll ${fmt(U.dist(st.rollAvg), 0)} ${U.distU()} · máx ${fmt(U.dist(st.carryMax), 0)} carry`) +
    metric("Ball speed", fmt(U.speed(st.ballAvg), 1), U.speedU(), `club ${fmt(U.speed(st.csAvg), 1)} ${U.speedU()}`) +
    metric("Smash factor", fmt(st.smashAvg, 2), "", IDEAL_SMASH[club] ? `ideal ${fmt(IDEAL_SMASH[club], 2)}` : "") +
    metric("Eficiencia", fmt(effic, 2), `${U.distU()}/${U.speedU()}`, "carry por unidad de club speed") +
    metric("Launch angle", fmt(st.laAvg, 1), "°", `±${fmt(st.laStd, 1)}°`) +
    metric("Apex", fmt(U.height(st.apexAvg), 0), U.heightU(), "") +
    metric("Salida media", `${st.ldAvg > 0 ? "+" : ""}${fmt(st.ldAvg, 1)}`, "°", `dirección inicial (+ der / − izq) · ±${fmt(st.ldStd, 1)}°`) +
    metric("Curva en vuelo", `${st.curveMed > 0 ? "+" : ""}${fmt(U.dist(st.curveMed), 0)}`, U.distU(), "mediana · + derecha / − izquierda") +
    metric("Lateral medio", fmt(U.dist(st.sideAvg), 0), U.distU(), `±${fmt(U.dist(st.sideStd), 0)} dispersión`) +
    (() => { const fw = fairwayStats(st); return fw
      ? metric("En calle", `${fw.inPct}%`, "", `fuera: ${fw.left} izq · ${fw.right} der · calle ${fmt(U.dist(state.prefs.fairway), 0)} ${U.distU()}`)
      : metric("En calle", "–", "", ""); })() +
    metric("Tiros", st.n, "", `consistencia ${consistencyLabel(consistencyScore(st)).txt}${st.nRaw > st.n ? ` · ${st.nRaw - st.n} atípico${st.nRaw - st.n > 1 ? "s" : ""} excluido${st.nRaw - st.n > 1 ? "s" : ""}` : ""}`);

  renderShapeMatrix(st);

  // Scatter de dispersión (lateral vs carry) — vista "desde atrás"
  const half = state.prefs.fairway / 2;            // mitad del ancho, en yardas
  const halfDisp = U.dist(half);                    // en unidad de display
  const inPts = [], outPts = [];
  st.shots.forEach(s => {
    const pt = { x: U.dist(s.side || 0), y: U.dist(s.carry) };
    (Math.abs(s.side || 0) <= half ? inPts : outPts).push(pt);
  });

  // Plugin para dibujar los márgenes del fairway (líneas segmentadas tenues + banda)
  const fairwayBand = {
    id: "fairwayBand",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: area, scales: { x } } = chart;
      const pxL = x.getPixelForValue(-halfDisp);
      const pxR = x.getPixelForValue(halfDisp);
      const left = Math.max(area.left, Math.min(pxL, pxR));
      const right = Math.min(area.right, Math.max(pxL, pxR));
      ctx.save();
      // banda de calle muy tenue
      ctx.fillStyle = "rgba(91,191,134,.07)";
      ctx.fillRect(left, area.top, right - left, area.bottom - area.top);
      // líneas segmentadas en los márgenes
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(214,255,228,.45)";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillStyle = "rgba(214,255,228,.55)";
      [{ px: pxL, t: "borde calle" }, { px: pxR, t: "borde calle" }].forEach(({ px }) => {
        if (px < area.left || px > area.right) return;
        ctx.beginPath();
        ctx.moveTo(px, area.top);
        ctx.lineTo(px, area.bottom);
        ctx.stroke();
      });
      ctx.restore();
    }
  };

  // Elipses de dispersión: ≈68% (1σ) y ≈95% (2σ) de tus tiros
  const sigmaEllipse = {
    id: "sigmaEllipse",
    afterDatasetsDraw(chart) {
      if (st.n < 5 || !st.carryStd) return;
      const { ctx, chartArea: area, scales: { x, y } } = chart;
      const cx = x.getPixelForValue(U.dist(st.sideAvg || 0));
      const cy = y.getPixelForValue(U.dist(st.carryAvg));
      const rx = Math.abs(x.getPixelForValue(U.dist((st.sideAvg || 0) + (st.sideStd || 0))) - cx);
      const ry = Math.abs(y.getPixelForValue(U.dist(st.carryAvg + st.carryStd)) - cy);
      if (!rx || !ry) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      ctx.clip();
      [[1, .55], [2, .25]].forEach(([k, alpha]) => {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * k, ry * k, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(212,161,58,${alpha})`;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      ctx.restore();
    }
  };
  const outlierPts = st.outliers.map(s => ({ x: U.dist(s.side || 0), y: U.dist(s.carry) }));

  makeChart("chart-dispersion", {
    type: "scatter",
    data: {
      datasets: [
        { label: "En calle", data: inPts, backgroundColor: COLORS.greenL, pointRadius: 5 },
        { label: "Fuera", data: outPts, backgroundColor: COLORS.red, pointRadius: 5 },
        { label: "Objetivo", data: [{ x: 0, y: U.dist(st.carryAvg) }], backgroundColor: COLORS.gold, pointRadius: 7, pointStyle: "rectRot" },
        ...(outlierPts.length ? [{ label: "Atípico (excluido)", data: outlierPts, backgroundColor: "transparent", borderColor: "rgba(160,175,166,.8)", borderWidth: 2, pointStyle: "crossRot", pointRadius: 6 }] : [])
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top" }, tooltip: { callbacks: { label: c => `${fmt(c.parsed.y, 0)} ${U.distU()} carry, ${fmt(c.parsed.x, 0)} lateral` } } },
      scales: {
        x: gridOpts({ title: { display: true, text: `← Izquierda · calle ${fmt(U.dist(state.prefs.fairway), 0)} ${U.distU()} · Derecha →` }, suggestedMin: -Math.max(50, halfDisp * 1.3), suggestedMax: Math.max(50, halfDisp * 1.3) }),
        y: gridOpts({ title: { display: true, text: `Carry (${U.distU()})` } })
      }
    },
    plugins: [fairwayBand, sigmaEllipse]
  });

  // Comparación vs benchmark
  const cmp = document.getElementById("club-bench");
  if (bench) {
    const bar = (label, val, ref, unit, dec = 0) => {
      const pct = ref ? Math.min(140, (val / ref) * 100) : 0;
      const refPct = ref ? Math.min(140, 100) : 0;
      const good = val >= ref;
      return `<div class="benchbar">
        <div class="benchbar-top"><span>${label}</span><span>${fmt(val, dec)} ${unit} <span class="muted">/ ${fmt(ref, dec)}</span></span></div>
        <div class="benchbar-track">
          <div class="benchbar-fill ${good ? 'good' : 'under'}" style="width:${Math.min(100, pct / 1.4)}%"></div>
          <div class="benchbar-ref" style="left:${refPct / 1.4}%"></div>
        </div>
      </div>`;
    };
    cmp.innerHTML = `<h3>Comparación vs ${BENCHMARKS[state.prefs.benchmark].label}</h3>` +
      bar("Carry", U.dist(st.carryAvg), U.dist(bench.carry), U.distU()) +
      bar("Ball speed", U.speed(st.ballAvg), U.speed(bench.ball), U.speedU()) +
      bar("Club speed", U.speed(st.csAvg), U.speed(bench.club), U.speedU()) +
      bar("Smash factor", st.smashAvg, bench.smash, "", 2);
  } else {
    cmp.innerHTML = `<p class="muted">No hay referencia disponible para este palo.</p>`;
  }
}

/* Matriz 3×3 de forma de tiro: salida (izq/recto/der) × curva (izq/recta/der) */
function renderShapeMatrix(st) {
  const grid = document.getElementById("shape-grid");
  const cap = document.getElementById("shape-caption");
  if (!grid) return;
  const sm = shapeMatrix(st.shots);
  if (sm.n < 5) {
    cap.textContent = "";
    grid.innerHTML = `<p class="muted">Se necesitan al menos 5 tiros con dirección para clasificar la forma de tiro.</p>`;
    return;
  }
  const maxCount = Math.max(...Object.values(sm.counts));
  const startLbl = { "-1": "Sale izq", "0": "Sale recto", "1": "Sale der" };
  const curveLbl = { "-1": "Curva izq", "0": "Sin curva", "1": "Curva der" };
  let html = `<div class="shape-cell hd"></div>` +
    [-1, 0, 1].map(s => `<div class="shape-cell hd">${startLbl[s]}</div>`).join("");
  [-1, 0, 1].forEach(cv => {
    html += `<div class="shape-cell hd">${curveLbl[cv]}</div>`;
    [-1, 0, 1].forEach(s => {
      const count = sm.counts[`${s},${cv}`] || 0;
      const pct = Math.round(100 * count / sm.n);
      const ratio = count / maxCount;
      const isTop = count === maxCount && count > 0;
      // Celdas dominantes: fondo verde casi sólido con texto oscuro;
      // el resto, tinte tenue con texto claro. Evita el rango medio sin contraste.
      const dark = ratio > .5;
      const alpha = !count ? 0 : dark ? .62 + .33 * ratio : .12 + .4 * ratio;
      html += `<div class="shape-cell${isTop ? " top" : ""}${dark ? " dark" : ""}" style="background:rgba(91,191,134,${alpha.toFixed(2)})">
        <div class="nm">${shapeName(s, cv)}</div>
        <div class="pc">${pct}%</div>
        <div class="ct">${count} tiro${count === 1 ? "" : "s"}</div>
      </div>`;
    });
  });
  grid.innerHTML = html;
  const top = Object.entries(sm.counts).sort((a, b) => b[1] - a[1])[0];
  const [ts, tc] = top[0].split(",").map(Number);
  cap.innerHTML = `Cada tiro se clasifica por su <b>dirección de salida</b> (columna) y su <b>curva en vuelo</b> (fila), con umbral de ±${SHAPE_TH}°. Tu forma dominante: <b>${shapeName(ts, tc)}</b> (${Math.round(100 * top[1] / sm.n)}% de ${sm.n} tiros).`;
}

/* ---------- EVOLUCIÓN ---------- */
function renderEvolution() {
  const clubs = clubsPresent(activeShots());
  const selC = document.getElementById("evo-club");
  const prevC = selC.value;
  selC.innerHTML = `<option value="__all">Todos los palos</option>` + clubs.map(c => `<option value="${c}">${clubLabel(c)}</option>`).join("");
  selC.value = (prevC && (prevC === "__all" || clubs.includes(prevC))) ? prevC : "__all";
  drawEvolution();
}

function drawEvolution() {
  const club = document.getElementById("evo-club").value;
  const metric = document.getElementById("evo-metric").value; // carry|ball|smash|side|la
  const ordered = [...filteredSessions()].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (ordered.length < 2) {
    document.getElementById("evo-note").textContent = "Necesitas al menos 2 sesiones en el rango para ver tu evolución. Amplía el rango de fechas o carga más archivos.";
  } else {
    document.getElementById("evo-note").textContent = "";
  }
  const labels = ordered.map(s => s.date || s.name);

  const metricFn = (sh) => {
    const vals = {
      carry: sh.map(x => x.carry), ball: sh.map(x => x.ball),
      smash: sh.map(x => x.smash), side: sh.map(x => Math.abs(x.side || 0)),
      la: sh.map(x => x.la), ld: sh.map(x => x.ld),
      roll: sh.map(x => (x.total != null && x.carry != null) ? x.total - x.carry : null)
    }[metric];
    return mean(vals);
  };
  const conv = (v) => {
    if (v == null) return null;
    if (metric === "carry" || metric === "side" || metric === "roll") return U.dist(v);
    if (metric === "ball") return U.speed(v);
    return v;
  };

  let datasets = [];
  const palette = [COLORS.green, COLORS.gold, COLORS.blue, COLORS.red, COLORS.greenL, "#9b6dd6", "#d68f4a", "#4ad6b5"];
  if (club === "__all") {
    const clubs = clubsPresent(activeShots());
    clubs.forEach((c, i) => {
      const data = ordered.map(s => { const sh = s.shots.filter(x => x.club === c); return sh.length ? conv(metricFn(sh)) : null; });
      datasets.push({ label: clubLabel(c), data, borderColor: palette[i % palette.length], backgroundColor: palette[i % palette.length], tension: .3, spanGaps: true, pointRadius: 3 });
    });
  } else {
    const data = ordered.map(s => { const sh = s.shots.filter(x => x.club === club); return sh.length ? conv(metricFn(sh)) : null; });
    datasets = [{ label: clubLabel(club), data, borderColor: COLORS.green, backgroundColor: "rgba(46,125,79,.2)", fill: true, tension: .3, spanGaps: true, pointRadius: 4 }];
  }

  makeChart("chart-evolution", {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
      scales: { x: gridOpts(), y: gridOpts() }
    }
  });

  drawWarmup();
}

/* Calentamiento / fatiga: carry relativo y smash por tercio de sesión */
function drawWarmup() {
  const club = document.getElementById("evo-club").value;
  const wb = warmupBuckets(club);
  const note = document.getElementById("warmup-note");
  if (!wb.sessions || wb.rel.every(v => v == null)) {
    note.textContent = "No hay suficientes tiros por sesión para este análisis (se necesitan 6+ tiros del mismo palo en una sesión).";
    if (charts["chart-warmup"]) { charts["chart-warmup"].destroy(); delete charts["chart-warmup"]; }
    return;
  }
  const d = (wb.rel[0] != null && wb.rel[2] != null) ? wb.rel[2] - wb.rel[0] : null;
  note.textContent =
    d == null ? "" :
    d <= -3 ? `Tu carry cae un ${fmt(Math.abs(d), 1)}% en el último tercio: posible fatiga (${wb.sessions} sesiones).` :
    d >= 3 ? `Tu primer tercio vuela un ${fmt(d, 1)}% menos que el final: te falta calentamiento (${wb.sessions} sesiones).` :
    `Rendimiento estable a lo largo de la sesión (${wb.sessions} sesiones analizadas). Sin señales de fatiga ni de falta de calentamiento.`;

  makeChart("chart-warmup", {
    type: "bar",
    data: {
      labels: ["Inicio", "Mitad", "Final"],
      datasets: [
        { label: "Carry relativo (%)", data: wb.rel, backgroundColor: "rgba(91,191,134,.55)", borderColor: COLORS.greenL, borderWidth: 1.5, yAxisID: "y" },
        { label: "Smash factor", data: wb.smash, type: "line", borderColor: COLORS.gold, backgroundColor: COLORS.gold, pointRadius: 4, tension: .3, yAxisID: "y1" }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
        tooltip: { callbacks: { label: c => c.dataset.yAxisID === "y" ? `${c.dataset.label}: ${fmt(c.parsed.y, 1)}%` : `${c.dataset.label}: ${fmt(c.parsed.y, 2)}` } }
      },
      scales: {
        x: gridOpts(),
        y: gridOpts({ title: { display: true, text: "Carry vs promedio de sesión (%)" }, suggestedMin: 92, suggestedMax: 108 }),
        y1: { position: "right", grid: { drawOnChartArea: false }, ticks: { color: COLORS.gold }, title: { display: true, text: "Smash", color: COLORS.gold } }
      }
    }
  });
}

/* ---------- PATRONES ---------- */
function renderPatterns() {
  const ins = generateInsights(activeShots());
  const card = (i, type) => `<div class="insight ${type}">
    <div class="insight-title">${i.title}</div>
    <div class="insight-body">${i.body}</div>
  </div>`;
  const fill = (id, arr, type, empty) => {
    document.getElementById(id).innerHTML = arr.length ? arr.map(i => card(i, type)).join("") : `<p class="muted">${empty}</p>`;
  };
  fill("ins-strength", ins.strength, "strength", "Aún sin fortalezas destacadas. Carga más tiros.");
  fill("ins-improve", ins.improve, "improve", "Sin áreas críticas detectadas. ¡Bien!");
  fill("ins-pattern", ins.pattern, "pattern", "Sin patrones de desviación marcados.");
  document.getElementById("ins-count").textContent = ins.strength.length + ins.improve.length + ins.pattern.length;
}

/* ---------- BENCHMARK ---------- */
function renderBenchmark() {
  const shots = activeShots();
  const clubs = clubsPresent(shots);
  const bench = BENCHMARKS[state.prefs.benchmark].data;
  document.getElementById("bench-title").textContent = `Comparación vs ${BENCHMARKS[state.prefs.benchmark].label}`;
  document.getElementById("bench-desc").textContent = BENCHMARKS[state.prefs.benchmark].desc;

  const rows = clubs.map(c => {
    const st = clubStats(shots, c);
    const b = bench[c];
    if (!b) return "";
    const gc = st.carryAvg - b.carry;
    const gb = st.ballAvg - b.ball;
    const gs = st.smashAvg - b.smash;
    const pill = (v, dec = 0) => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${fmt(dec === 2 ? v : U.dist(v), dec)}</span>`;
    const pillS = (v) => `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : ''}${fmt(v, 2)}</span>`;
    return `<tr>
      <td class="club-cell">${clubLabel(c)}</td>
      <td class="num">${fmt(U.dist(st.carryAvg), 0)}</td>
      <td class="num muted">${fmt(U.dist(b.carry), 0)}</td>
      <td class="num">${pill(gc, 0)}</td>
      <td class="num">${fmt(U.speed(st.ballAvg), 0)}</td>
      <td class="num muted">${fmt(U.speed(b.ball), 0)}</td>
      <td class="num">${fmt(st.smashAvg, 2)}</td>
      <td class="num">${pillS(gs)}</td>
    </tr>`;
  }).join("");
  document.getElementById("bench-table-body").innerHTML = rows;

  // Radar: por palo o promedio de todos (% de tu métrica vs el benchmark)
  const metrics = ["carry", "ball", "club", "smash"];
  const mlabels = { carry: "Carry", ball: "Ball speed", club: "Club speed", smash: "Smash" };

  // Selector de palo del radar
  const rsel = document.getElementById("bench-radar-club");
  const prev = rsel.value;
  rsel.innerHTML = `<option value="__all">Promedio de todos los palos</option>` +
    clubs.map(c => `<option value="${c}">${clubLabel(c)}</option>`).join("");
  rsel.value = (prev === "__all" || clubs.includes(prev)) ? prev : "__all";
  const radarClub = rsel.value;

  const ratioFor = (m, c) => {
    const st = clubStats(shots, c); const b = bench[c];
    if (!b) return null;
    const mine = { carry: st.carryAvg, ball: st.ballAvg, club: st.csAvg, smash: st.smashAvg }[m];
    const ref = { carry: b.carry, ball: b.ball, club: b.club, smash: b.smash }[m];
    return (mine != null && ref) ? (mine / ref) * 100 : null;
  };
  const vals = metrics.map(m => {
    if (radarClub === "__all") {
      const ratios = clubs.map(c => ratioFor(m, c)).filter(x => x != null);
      return ratios.length ? mean(ratios) : 0;
    }
    const r = ratioFor(m, radarClub);
    return r == null ? 0 : r;
  });
  document.getElementById("bench-radar-caption").textContent =
    (radarClub === "__all"
      ? `Promedio de tus ${clubs.length} palos`
      : `Solo ${clubLabel(radarClub)}`) +
    ` · 100% (línea dorada) = nivel ${BENCHMARKS[state.prefs.benchmark].label}`;
  makeChart("chart-radar", {
    type: "radar",
    data: {
      labels: metrics.map(m => mlabels[m]),
      datasets: [
        { label: "Tú", data: vals, borderColor: COLORS.green, backgroundColor: "rgba(46,125,79,.32)", pointBackgroundColor: COLORS.green, borderWidth: 2, pointRadius: 3 },
        { label: BENCHMARKS[state.prefs.benchmark].label, data: [100, 100, 100, 100], borderColor: COLORS.gold, backgroundColor: "transparent", pointRadius: 0, borderWidth: 1.5, borderDash: [5, 4] }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.r, 0)}%` } }
      },
      scales: {
        r: {
          suggestedMin: 60, suggestedMax: 120,
          grid: { color: COLORS.grid },
          angleLines: { color: COLORS.grid },
          pointLabels: { color: COLORS.text, font: { size: 12 } },
          ticks: { display: false }  // sin números radiales para no recargar la vista
        }
      }
    }
  });
}

/* ============================================================
   METAS POR PALO
   Meta = % de tiros que cumplen un criterio (en calle, o
   |side| ≤ X) dentro de una ventana móvil de N días, contando
   solo tiros con carry > mínimo. Independiente del filtro de
   fechas global.
   ============================================================ */
function goalCriterionLimit(goal) {
  return goal.type === "fairway" ? state.prefs.fairway / 2 : goal.sideMax;
}

/* % de cumplimiento con la ventana terminando en endDate (YYYY-MM-DD) */
function goalPct(goal, endDate) {
  const d = new Date(endDate + "T00:00:00");
  d.setDate(d.getDate() - goal.windowDays + 1);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const limit = goalCriterionLimit(goal);
  let n = 0, hits = 0;
  state.sessions.forEach(s => {
    if (!s.date || s.date < from || s.date > endDate) return;
    s.shots.forEach(sh => {
      if (sh.club !== goal.club) return;
      if (sh.carry == null || sh.carry <= (goal.minCarry || 0)) return;
      if (sh.side == null) return;
      n++;
      if (Math.abs(sh.side) <= limit) hits++;
    });
  });
  return { n, hits, pct: n ? 100 * hits / n : null, from };
}

function goalTitle(goal) {
  const crit = goal.type === "fairway"
    ? `${goal.targetPct}% en calle`
    : `${goal.targetPct}% con lateral ≤ ${fmt(U.dist(goal.sideMax), 0)} ${U.distU()}`;
  return `${clubLabel(goal.club)} — ${crit}`;
}

function renderGoals() {
  const listEl = document.getElementById("goals-list");
  if (!listEl) return;

  // Selector de palo del formulario (palos con datos; si no hay, la bolsa completa)
  const sel = document.getElementById("goal-club");
  const prev = sel.value;
  const clubs = [...new Set(state.sessions.flatMap(s => s.shots.map(x => x.club)))]
    .sort((a, b) => clubSortIndex(a) - clubSortIndex(b));
  const opts = clubs.length ? clubs : CLUB_ORDER;
  sel.innerHTML = opts.map(c => `<option value="${c}">${clubLabel(c)}</option>`).join("");
  if (opts.includes(prev)) sel.value = prev;
  document.querySelectorAll(".goal-unit").forEach(e => e.textContent = U.distU());

  // Limpia gráficos de metas eliminadas
  Object.keys(charts).forEach(id => {
    if (id.startsWith("chart-goal-")) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; }
  });

  if (!state.goals.length) {
    listEl.innerHTML = `<p class="muted" style="padding:0 4px">Sin metas definidas. Crea la primera con el formulario de arriba: podrás seguir tu avance sesión a sesión desde el día en que la definas.</p>`;
    return;
  }

  const today = todayStr();
  listEl.innerHTML = state.goals.map(g => {
    const cur = goalPct(g, today);
    const achieved = cur.pct != null && cur.pct >= g.targetPct;
    const badge = cur.pct == null ? `<span class="badge">sin tiros</span>`
      : achieved ? `<span class="badge good">Lograda 🎉</span>`
      : cur.pct >= g.targetPct * 0.85 ? `<span class="badge warn">Cerca</span>`
      : `<span class="badge bad">Lejos</span>`;
    const fill = cur.pct == null ? 0 : Math.min(100, cur.pct);
    const minTxt = g.minCarry ? ` · carry &gt; ${fmt(U.dist(g.minCarry), 0)} ${U.distU()}` : "";
    return `<div class="card goal-card" data-gid="${g.id}">
      <div class="goal-head">
        <div>
          <div class="goal-title">${goalTitle(g)}</div>
          <div class="goal-sub muted">últimos ${g.windowDays} días${minTxt} · inicio ${g.createdAt}</div>
        </div>
        <button class="btn-del" data-goal-del="${g.id}">Eliminar</button>
      </div>
      <div class="goal-status">
        <div class="goal-now">${cur.pct == null ? "–" : fmt(cur.pct, 0) + "%"}<span class="goal-target-txt"> / ${g.targetPct}%</span></div>
        ${badge}
        <span class="muted goal-n">${cur.n} tiro${cur.n === 1 ? "" : "s"} válido${cur.n === 1 ? "" : "s"} en la ventana</span>
      </div>
      <div class="benchbar-track goal-bar">
        <div class="benchbar-fill ${achieved ? "good" : "under"}" style="width:${fill}%"></div>
        <div class="benchbar-ref" style="left:${Math.min(100, g.targetPct)}%"></div>
      </div>
      <div class="chart-wrap short"><canvas id="chart-goal-${g.id}"></canvas></div>
      <p class="goal-trend muted" id="goal-trend-${g.id}"></p>
    </div>`;
  }).join("");

  state.goals.forEach(drawGoalChart);

  document.querySelectorAll("[data-goal-del]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("¿Eliminar esta meta?")) return;
    state.goals = state.goals.filter(g => g.id !== b.dataset.goalDel);
    save(); renderGoals();
  }));
}

/* Evolución de la meta: % móvil en cada fecha de sesión (+ hoy), gris antes
   de definir la meta y verde desde su definición, vs línea de la meta. */
function drawGoalChart(g) {
  const dates = [...new Set([...sessionDates(), g.createdAt, todayStr()])].sort();
  const pts = dates.map(d => ({ d, pct: goalPct(g, d).pct }));
  const labels = pts.map(p => p.d);
  const pre = pts.map(p => (p.d <= g.createdAt ? p.pct : null));
  const post = pts.map(p => (p.d >= g.createdAt ? p.pct : null));

  makeChart(`chart-goal-${g.id}`, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Antes de la meta", data: pre, borderColor: "rgba(160,175,166,.55)", backgroundColor: "rgba(160,175,166,.55)", pointRadius: 3, tension: .3, spanGaps: true },
        { label: "Desde la meta", data: post, borderColor: COLORS.green, backgroundColor: "rgba(46,125,79,.18)", fill: true, pointRadius: 4, pointBackgroundColor: COLORS.green, borderWidth: 2.5, tension: .3, spanGaps: true },
        { label: `Meta ${g.targetPct}%`, data: labels.map(() => g.targetPct), borderColor: COLORS.gold, backgroundColor: COLORS.gold, borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { boxWidth: 18 } },
        tooltip: { callbacks: { label: c => c.parsed.y == null ? "" : `${c.dataset.label}: ${fmt(c.parsed.y, 0)}%` } }
      },
      scales: {
        x: gridOpts(),
        y: gridOpts({ title: { display: true, text: "% de cumplimiento" }, suggestedMin: 0, suggestedMax: 100 })
      }
    }
  });

  // Tendencia: comparar los dos últimos puntos con datos desde la definición
  const postPts = pts.filter(p => p.d >= g.createdAt && p.pct != null);
  const el = document.getElementById(`goal-trend-${g.id}`);
  if (postPts.length >= 2) {
    const delta = postPts[postPts.length - 1].pct - postPts[postPts.length - 2].pct;
    el.textContent = Math.abs(delta) < 1 ? "→ Estable respecto a la medición anterior."
      : delta > 0 ? `↗ Te acercas a la meta: +${fmt(delta, 0)} pts vs la medición anterior.`
      : `↘ Te alejas de la meta: −${fmt(Math.abs(delta), 0)} pts vs la medición anterior.`;
  } else {
    el.textContent = "Aún no hay sesiones nuevas desde que definiste la meta: carga tiros para ver tu avance.";
  }
}

/* ---------- SESIONES ---------- */
function renderSessions() {
  const ordered = [...state.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  document.getElementById("sessions-list").innerHTML = ordered.map(s => `
    <div class="session-row" data-id="${s.id}">
      <div class="session-info">
        <input class="session-date" type="date" value="${s.date || ""}" data-id="${s.id}">
        <input class="session-name" type="text" value="${s.name}" data-id="${s.id}">
        <span class="muted">${s.shots.length} tiros · ${[...new Set(s.shots.map(x => x.club))].length} palos</span>
      </div>
      <button class="btn-del" data-id="${s.id}">Eliminar</button>
    </div>`).join("") || `<p class="muted">Sin sesiones.</p>`;
}

/* ============================================================
   CARGA DE ARCHIVOS
   ============================================================ */
function addSession(fileName, text) {
  const shots = parseCSV(text);
  if (!shots.length) { alert(`No se encontraron tiros válidos en "${fileName}".`); return false; }
  const date = dateFromFilename(fileName) || new Date().toISOString().slice(0, 10);
  state.sessions.push({
    id: "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    date,
    name: fileName.replace(/\.csv$/i, ""),
    fileName,
    shots
  });
  return true;
}

function handleFiles(fileList) {
  const files = [...fileList].filter(f => /\.csv$/i.test(f.name));
  if (!files.length) { alert("Selecciona archivos .csv del monitor."); return; }
  let pending = files.length, added = 0;
  files.forEach(f => {
    const reader = new FileReader();
    reader.onload = e => {
      if (addSession(f.name, e.target.result)) added++;
      if (--pending === 0) { save(); renderAll(); if (added) goTab("overview"); }
    };
    reader.readAsText(f);
  });
}

/* ============================================================
   NAVEGACIÓN / CONTROLES
   ============================================================ */
function goTab(name) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
  // Los canvas creados mientras la pestaña estaba oculta tienen tamaño 0:
  // forzamos un resize al mostrarla para que se dibujen correctamente.
  requestAnimationFrame(() => Object.values(charts).forEach(c => { try { c && c.resize(); } catch (e) {} }));
}

function syncPrefControls() {
  document.querySelectorAll("[data-unit]").forEach(b => b.classList.toggle("active", b.dataset.unit === state.prefs.unit));
  document.querySelectorAll("[data-hand]").forEach(b => b.classList.toggle("active", b.dataset.hand === state.prefs.hand));
  document.querySelectorAll("[data-fairway]").forEach(b => b.classList.toggle("active", +b.dataset.fairway === state.prefs.fairway));
  document.querySelectorAll("[data-outliers]").forEach(b => b.classList.toggle("active", (b.dataset.outliers === "on") === !!state.prefs.outliers));
  const fi = document.getElementById("fairway-input");
  if (fi && document.activeElement !== fi) fi.value = state.prefs.fairway;
  const bs = document.getElementById("benchmark-select");
  if (bs) bs.value = state.prefs.benchmark;
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  load();

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => goTab(b.dataset.tab)));

  // Upload
  const fileInput = document.getElementById("file-input");
  document.querySelectorAll(".upload-trigger").forEach(b => b.addEventListener("click", () => fileInput.click()));
  fileInput.addEventListener("change", e => { handleFiles(e.target.files); e.target.value = ""; });

  // Drag & drop
  const drop = document.getElementById("empty-state");
  ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", e => handleFiles(e.dataTransfer.files));

  // Demo
  const demoBtn = document.getElementById("load-demo");
  if (demoBtn) demoBtn.addEventListener("click", () => {
    if (typeof DEMO_CSV !== "undefined") { addSession("demo_062826.csv", DEMO_CSV); save(); renderAll(); goTab("overview"); }
  });

  // Filtro por rango de fecha
  document.getElementById("range-preset").addEventListener("change", e => {
    const v = e.target.value;
    if (v === "custom") {
      const dates = sessionDates();
      dateFilter = {
        preset: "custom",
        from: dateFilter.from || dates[0] || todayStr(),
        to: dateFilter.to || dates[dates.length - 1] || todayStr()
      };
    } else {
      dateFilter = { preset: v, from: null, to: null };
    }
    renderAll();
  });
  document.getElementById("range-from").addEventListener("change", e => { dateFilter.from = e.target.value || null; renderAll(); });
  document.getElementById("range-to").addEventListener("change", e => { dateFilter.to = e.target.value || null; renderAll(); });

  // Selección de palo / evolución / benchmark
  document.getElementById("club-select").addEventListener("change", e => drawClubDetail(e.target.value));
  document.getElementById("evo-club").addEventListener("change", drawEvolution);
  document.getElementById("evo-metric").addEventListener("change", drawEvolution);
  document.getElementById("benchmark-select").addEventListener("change", e => { state.prefs.benchmark = e.target.value; save(); renderAll(); });
  document.getElementById("bench-radar-club").addEventListener("change", renderBenchmark);

  // Unidades / mano / fairway
  document.querySelectorAll("[data-unit]").forEach(b => b.addEventListener("click", () => { state.prefs.unit = b.dataset.unit; save(); renderAll(); }));
  document.querySelectorAll("[data-hand]").forEach(b => b.addEventListener("click", () => { state.prefs.hand = b.dataset.hand; save(); renderAll(); }));
  document.querySelectorAll("[data-fairway]").forEach(b => b.addEventListener("click", () => { state.prefs.fairway = +b.dataset.fairway; save(); renderAll(); }));
  document.querySelectorAll("[data-outliers]").forEach(b => b.addEventListener("click", () => { state.prefs.outliers = b.dataset.outliers === "on"; save(); renderAll(); }));
  document.getElementById("fairway-input").addEventListener("change", e => {
    const v = Math.max(10, Math.min(80, +e.target.value || 36));
    state.prefs.fairway = v; save(); renderAll();
  });

  // Metas
  document.getElementById("goal-type").addEventListener("change", e => {
    document.getElementById("goal-side-wrap").style.display = e.target.value === "side" ? "" : "none";
  });
  const goalStart = document.getElementById("goal-start");
  goalStart.value = todayStr();
  goalStart.max = todayStr();
  document.getElementById("goal-add").addEventListener("click", () => {
    const club = document.getElementById("goal-club").value;
    const type = document.getElementById("goal-type").value;
    const targetPct = Math.max(1, Math.min(100, +document.getElementById("goal-target").value || 50));
    const windowDays = Math.max(1, Math.min(365, +document.getElementById("goal-window").value || 30));
    const minCarry = Math.max(0, U.toYd(+document.getElementById("goal-mincarry").value || 0));
    const sideMax = Math.max(1, U.toYd(+document.getElementById("goal-side").value || 20));
    if (!club) { alert("Elige un palo para la meta."); return; }
    // Inicio de la meta: puede ser pasado (para ver de dónde vienes); nunca futuro
    let start = document.getElementById("goal-start").value || todayStr();
    if (start > todayStr()) start = todayStr();
    state.goals.push({
      id: "g_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      club, type,
      sideMax: type === "side" ? sideMax : null,
      targetPct, windowDays, minCarry,
      createdAt: start
    });
    save(); renderGoals();
  });

  // Editar sesiones (delegación)
  document.getElementById("sessions-list").addEventListener("change", e => {
    const id = e.target.dataset.id; if (!id) return;
    const s = state.sessions.find(x => x.id === id); if (!s) return;
    if (e.target.classList.contains("session-date")) s.date = e.target.value;
    if (e.target.classList.contains("session-name")) s.name = e.target.value;
    save(); renderRangeFilter();
  });
  document.getElementById("sessions-list").addEventListener("click", e => {
    if (!e.target.classList.contains("btn-del")) return;
    const id = e.target.dataset.id;
    if (confirm("¿Eliminar esta sesión?")) {
      state.sessions = state.sessions.filter(x => x.id !== id);
      save(); renderAll();
    }
  });
  document.getElementById("clear-all").addEventListener("click", () => {
    if (confirm("¿Borrar TODOS los datos? Esto no se puede deshacer.")) {
      state.sessions = []; dateFilter = { preset: "all", from: null, to: null }; save(); renderAll();
    }
  });

  // Export / import JSON (respaldo)
  document.getElementById("export-data").addEventListener("click", () => {
    const payload = { version: 2, sessions: state.sessions, goals: state.goals, prefs: state.prefs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "golf-analytics-respaldo.json";
    a.click();
  });
  document.getElementById("import-input").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (Array.isArray(data)) { // formato antiguo: solo sesiones
          state.sessions = data; save(); renderAll(); alert("Datos restaurados.");
        } else if (data && Array.isArray(data.sessions)) {
          state.sessions = data.sessions;
          if (Array.isArray(data.goals)) state.goals = data.goals;
          if (data.prefs) state.prefs = { ...state.prefs, ...data.prefs };
          save(); renderAll(); alert("Datos restaurados.");
        } else alert("Archivo de respaldo inválido.");
      } catch { alert("Archivo de respaldo inválido."); }
    };
    r.readAsText(f);
    e.target.value = "";
  });

  syncPrefControls();
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
