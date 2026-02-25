import { ParsedPDF, Setup, Operation } from './pdfParser';

export interface Metrics {
  group: string;
  full_name: string;
  total_time: number;
  setup_times: number[];
  total_cut: number;
  total_rapid: number;
  n_ops: number;
  n_ops_per_setup: number[];
  n_products: number;
  tc_total: number;
  n_strategies: number;
  strategies: string[];
  strat_time: Record<string, number>;
  strat_count: Record<string, number>;
  tool_time: Record<string, number>;
  tool_trefs: Record<string, string[]>;
  weighted_feed: number;
  max_tool_time: number;
  max_tool_prod: string;
  tools_over_50: number;
  tools_over_75: number;
  tools_over_100: number;
  avg_util: number;
  cut_ratio: number;
  ops_per_tool: number;
  productivity: number;
  max_tool_pct_cycle: number;
  tool_life_s: number;
}

function extractShortName(fullName: string): string {
  const match = fullName.match(/((?:NC|TP|GR)\d+)/i);
  if (match) return match[1].toUpperCase();
  const clean = fullName.replace(/[_-]/g, ' ').trim().split(/\s+/);
  return clean.length > 0 ? clean[0] : fullName;
}

export function computeMetrics(parsed: ParsedPDF, toolLifeS: number = 1200): Metrics {
  const allOps: Operation[] = [];
  parsed.setups.forEach(s => allOps.push(...s.operations));

  if (allOps.length === 0) {
    throw new Error(`No operations found in '${parsed.name}'`);
  }

  let totalTime = parsed.setups.reduce((sum, s) => sum + s.cycle_time_s, 0);
  if (totalTime === 0) {
    totalTime = allOps.reduce((sum, o) => sum + o.cycle_time_s, 0);
  }

  const totalCut = allOps.reduce((sum, o) => sum + o.cutting_dist, 0);
  const totalRapid = allOps.reduce((sum, o) => sum + o.rapid_dist, 0);
  const nOps = allOps.length;

  const setupTimes = parsed.setups.map(s => s.cycle_time_s);

  const products = new Set(allOps.filter(o => o.product !== 'N/A').map(o => o.product));

  let toolChanges = 0;
  for (const setup of parsed.setups) {
    for (let i = 1; i < setup.operations.length; i++) {
      if (setup.operations[i].tool_t !== setup.operations[i - 1].tool_t) {
        toolChanges++;
      }
    }
  }

  const strategies = new Set(allOps.map(o => o.strategy));
  const stratTime: Record<string, number> = {};
  const stratCount: Record<string, number> = {};
  for (const o of allOps) {
    stratTime[o.strategy] = (stratTime[o.strategy] || 0) + o.cycle_time_s;
    stratCount[o.strategy] = (stratCount[o.strategy] || 0) + 1;
  }

  const toolTime: Record<string, number> = {};
  const toolTrefsMap: Record<string, Set<string>> = {};
  for (const o of allOps) {
    toolTime[o.product] = (toolTime[o.product] || 0) + o.cycle_time_s;
    if (!toolTrefsMap[o.product]) toolTrefsMap[o.product] = new Set();
    toolTrefsMap[o.product].add(o.tool_t);
  }

  const toolTrefs: Record<string, string[]> = {};
  for (const k in toolTrefsMap) {
    toolTrefs[k] = Array.from(toolTrefsMap[k]).sort();
  }

  const weightedFeed = totalCut ? allOps.reduce((sum, o) => sum + o.max_feedrate * o.cutting_dist, 0) / totalCut : 0;

  const toolTimesArray = Object.values(toolTime);
  const maxToolTime = toolTimesArray.length ? Math.max(...toolTimesArray) : 0;
  let maxToolProd = "N/A";
  for (const k in toolTime) {
    if (toolTime[k] === maxToolTime) {
      maxToolProd = k;
      break;
    }
  }

  const toolsOver50 = toolTimesArray.filter(t => t / toolLifeS > 0.5).length;
  const toolsOver75 = toolTimesArray.filter(t => t / toolLifeS > 0.75).length;
  const toolsOver100 = toolTimesArray.filter(t => t / toolLifeS > 1.0).length;
  const avgUtil = toolTimesArray.length ? toolTimesArray.reduce((sum, t) => sum + t / toolLifeS, 0) / toolTimesArray.length : 0;

  const nProducts = products.size;
  const shortName = extractShortName(parsed.name);

  return {
    group: shortName,
    full_name: parsed.name,
    total_time: totalTime,
    setup_times: setupTimes,
    total_cut: totalCut,
    total_rapid: totalRapid,
    n_ops: nOps,
    n_ops_per_setup: parsed.setups.map(s => s.operations.length),
    n_products: nProducts,
    tc_total: toolChanges,
    n_strategies: strategies.size,
    strategies: Array.from(strategies),
    strat_time: stratTime,
    strat_count: stratCount,
    tool_time: toolTime,
    tool_trefs: toolTrefs,
    weighted_feed: weightedFeed,
    max_tool_time: maxToolTime,
    max_tool_prod: maxToolProd,
    tools_over_50: toolsOver50,
    tools_over_75: toolsOver75,
    tools_over_100: toolsOver100,
    avg_util: avgUtil,
    cut_ratio: (totalCut + totalRapid) ? totalCut / (totalCut + totalRapid) : 0,
    ops_per_tool: nProducts ? nOps / nProducts : 0,
    productivity: totalTime ? totalCut / (totalTime / 60) : 0,
    max_tool_pct_cycle: totalTime ? maxToolTime / totalTime : 0,
    tool_life_s: toolLifeS,
  };
}

export const CATEGORY_WEIGHTS: Record<string, number> = {
  'Efficienza Temporale': 0.30,
  'Utilizzo Utensili': 0.20,
  'Vita Utile': 0.20,
  'Efficienza di Percorso': 0.15,
  'Complessità del Ciclo': 0.10,
  'Aggressività di Taglio': 0.05,
};

export function relativeScore(valA: number, valB: number, lowerIsBetter: boolean = true): [number, number] {
  if (valA === 0 && valB === 0) return [100.0, 100.0];
  if (lowerIsBetter) {
    const best = Math.min(valA, valB);
    if (valA === 0) return [100.0, 0.0];
    if (valB === 0) return [0.0, 100.0];
    return [Math.round((best / valA) * 1000) / 10, Math.round((best / valB) * 1000) / 10];
  } else {
    const best = Math.max(valA, valB);
    if (best === 0) return [100.0, 100.0];
    return [Math.round((valA / best) * 1000) / 10, Math.round((valB / best) * 1000) / 10];
  }
}

export function toolLifeScore(metrics: Metrics): number {
  const limit = metrics.tool_life_s;
  const scores: number[] = [];
  for (const t of Object.values(metrics.tool_time)) {
    const pct = t / limit;
    let s = 0;
    if (pct <= 0.5) s = 100;
    else if (pct <= 0.75) s = 80;
    else if (pct <= 1.0) s = 60;
    else s = Math.max(0, 60 - (pct - 1.0) * 200);
    scores.push(s);
  }
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 100;
}

export function fmtTime(s: number): string {
  s = Math.floor(s);
  const sec = s % 60;
  const mTotal = Math.floor(s / 60);
  const m = mTotal % 60;
  const h = Math.floor(mTotal / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  return `${m}m ${pad(sec)}s`;
}

export interface DriverResult {
  cat: string;
  name: string;
  valA: number;
  valB: number;
  scoreA: number;
  scoreB: number;
  dispA: string;
  dispB: string;
}

export interface ScoreResult {
  drivers: DriverResult[];
  catScoresA: Record<string, number>;
  catScoresB: Record<string, number>;
  totalA: number;
  totalB: number;
}

export function computeScores(ma: Metrics, mb: Metrics): ScoreResult {
  const drivers: DriverResult[] = [];

  function add(cat: string, name: string, valA: number, valB: number, scoreA: number, scoreB: number, dispA: string, dispB: string) {
    drivers.push({ cat, name, valA, valB, scoreA, scoreB, dispA, dispB });
  }

  const [s1a, s1b] = relativeScore(ma.total_time, mb.total_time, true);
  add('Efficienza Temporale', 'Tempo ciclo complessivo', ma.total_time, mb.total_time, s1a, s1b, fmtTime(ma.total_time), fmtTime(mb.total_time));

  const tma = ma.n_ops ? ma.total_time / ma.n_ops : 0;
  const tmb = mb.n_ops ? mb.total_time / mb.n_ops : 0;
  const [s2a, s2b] = relativeScore(tma, tmb, true);
  add('Efficienza Temporale', 'Tempo medio per operazione', tma, tmb, s2a, s2b, fmtTime(tma), fmtTime(tmb));

  const [s3a, s3b] = relativeScore(ma.n_products, mb.n_products, true);
  add('Utilizzo Utensili', 'N° utensili univoci', ma.n_products, mb.n_products, s3a, s3b, String(ma.n_products), String(mb.n_products));

  const [s4a, s4b] = relativeScore(ma.tc_total, mb.tc_total, true);
  add('Utilizzo Utensili', 'N° cambi utensile', ma.tc_total, mb.tc_total, s4a, s4b, String(ma.tc_total), String(mb.tc_total));

  const tlsA = toolLifeScore(ma);
  const tlsB = toolLifeScore(mb);
  add('Vita Utile', 'Score vita utile (non lineare)', tlsA, tlsB, tlsA, tlsB, `${tlsA.toFixed(1)}/100`, `${tlsB.toFixed(1)}/100`);

  const [s6a, s6b] = relativeScore(ma.max_tool_pct_cycle, mb.max_tool_pct_cycle, true);
  add('Vita Utile', 'Concentrazione utensile più impiegato', ma.max_tool_pct_cycle, mb.max_tool_pct_cycle, s6a, s6b, `${(ma.max_tool_pct_cycle * 100).toFixed(1)}%`, `${(mb.max_tool_pct_cycle * 100).toFixed(1)}%`);

  const penA = Math.max(0, 100 - ma.tools_over_100 * 50);
  const penB = Math.max(0, 100 - mb.tools_over_100 * 50);
  add('Vita Utile', 'Penalità superamento vita (−50pt/utensile)', ma.tools_over_100, mb.tools_over_100, penA, penB, `${ma.tools_over_100} utensili`, `${mb.tools_over_100} utensili`);

  const [s8a, s8b] = relativeScore(ma.cut_ratio, mb.cut_ratio, false);
  add('Efficienza di Percorso', 'Rapporto taglio / (taglio + rapido)', ma.cut_ratio, mb.cut_ratio, s8a, s8b, `${(ma.cut_ratio * 100).toFixed(1)}%`, `${(mb.cut_ratio * 100).toFixed(1)}%`);

  const da = ma.total_cut + ma.total_rapid;
  const db = mb.total_cut + mb.total_rapid;
  const [s9a, s9b] = relativeScore(da, db, true);
  add('Efficienza di Percorso', 'Distanza complessiva', da, db, s9a, s9b, `${Math.round(da)} mm`, `${Math.round(db)} mm`);

  const [s10a, s10b] = relativeScore(ma.n_ops, mb.n_ops, true);
  add('Complessità del Ciclo', 'N° operazioni totali', ma.n_ops, mb.n_ops, s10a, s10b, String(ma.n_ops), String(mb.n_ops));

  const [s11a, s11b] = relativeScore(ma.ops_per_tool, mb.ops_per_tool, true);
  add('Complessità del Ciclo', 'Rapporto operazioni / utensile', ma.ops_per_tool, mb.ops_per_tool, s11a, s11b, ma.ops_per_tool.toFixed(1), mb.ops_per_tool.toFixed(1));

  const [s12a, s12b] = relativeScore(ma.weighted_feed, mb.weighted_feed, false);
  add('Aggressività di Taglio', 'Feedrate medio ponderato', ma.weighted_feed, mb.weighted_feed, s12a, s12b, `${Math.round(ma.weighted_feed)} mm/min`, `${Math.round(mb.weighted_feed)} mm/min`);

  const [s13a, s13b] = relativeScore(ma.productivity, mb.productivity, false);
  add('Aggressività di Taglio', 'Produttività [mm taglio / min ciclo]', ma.productivity, mb.productivity, s13a, s13b, Math.round(ma.productivity).toString(), Math.round(mb.productivity).toString());

  const catScoresA: Record<string, number> = {};
  const catScoresB: Record<string, number> = {};

  for (const cat in CATEGORY_WEIGHTS) {
    const cd = drivers.filter(d => d.cat === cat);
    if (cd.length) {
      catScoresA[cat] = Math.round((cd.reduce((sum, d) => sum + d.scoreA, 0) / cd.length) * 10) / 10;
      catScoresB[cat] = Math.round((cd.reduce((sum, d) => sum + d.scoreB, 0) / cd.length) * 10) / 10;
    }
  }

  let totalA = 0;
  let totalB = 0;
  for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    totalA += (catScoresA[cat] || 0) * weight;
    totalB += (catScoresB[cat] || 0) * weight;
  }
  totalA = Math.round(totalA * 10) / 10;
  totalB = Math.round(totalB * 10) / 10;

  return { drivers, catScoresA, catScoresB, totalA, totalB };
}
