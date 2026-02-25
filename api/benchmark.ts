import multer from 'multer';
import pdfParse from 'pdf-parse';

// ═══════════════════════════════════════════════════════════════
// PDF Parser — interfaces
// ═══════════════════════════════════════════════════════════════

export interface Operation {
  op_num: number;
  op_total: number;
  description: string;
  strategy: string;
  tool_t: string;
  product: string;
  cutting_dist: number;
  rapid_dist: number;
  max_feedrate: number;
  cycle_time_s: number;
}

export interface Setup {
  program: string;
  cycle_time_s: number;
  n_operations: number;
  n_tools: number;
  operations: Operation[];
}

export interface ParsedPDF {
  name: string;
  setups: Setup[];
}

// ═══════════════════════════════════════════════════════════════
// Layout-aware PDF text renderer
// ═══════════════════════════════════════════════════════════════

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function layoutAwareRender(pageData: any): Promise<string> {
  return pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  }).then((textContent: any) => {
    if (!textContent.items || textContent.items.length === 0) return '';

    const items: TextItem[] = [];
    for (const raw of textContent.items) {
      if (raw.str === undefined || raw.str === '') continue;
      const tx = raw.transform;
      const fontSize = Math.abs(tx[0]) || Math.abs(tx[3]) || 12;
      items.push({
        str: raw.str,
        x: tx[4],
        y: tx[5],
        width: raw.width != null && raw.width > 0
          ? raw.width
          : raw.str.length * fontSize * 0.5,
        height: fontSize,
      });
    }

    if (items.length === 0) return '';

    const avgHeight = items.reduce((s, i) => s + i.height, 0) / items.length;
    const yTolerance = avgHeight * 0.35;

    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const lines: TextItem[][] = [];
    let currentLine: TextItem[] = [items[0]];
    let lineY = items[0].y;

    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].y - lineY) <= yTolerance) {
        currentLine.push(items[i]);
      } else {
        lines.push(currentLine);
        currentLine = [items[i]];
        lineY = items[i].y;
      }
    }
    if (currentLine.length > 0) lines.push(currentLine);

    const textLines: string[] = [];
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);

      let lineText = '';
      for (let k = 0; k < line.length; k++) {
        if (k > 0) {
          const prevEnd = line[k - 1].x + line[k - 1].width;
          const gap = line[k].x - prevEnd;
          const charWidth = avgHeight * 0.5;

          if (gap > charWidth * 3) {
            lineText += '  ';
          } else if (gap > charWidth * 0.15) {
            lineText += ' ';
          }
        }
        lineText += line[k].str;
      }

      textLines.push(lineText);
    }

    return textLines.join('\n');
  });
}

// ═══════════════════════════════════════════════════════════════
// PDF Parser — helpers
// ═══════════════════════════════════════════════════════════════

function parseCycleTime(text: string): number {
  text = text.trim().split('(')[0].trim();
  let h = 0, m = 0, s = 0;
  const hm = text.match(/(\d+)h/);
  const mm = text.match(/(\d+)m/);
  const sm = text.match(/(\d+)s/);
  if (hm) h = parseInt(hm[1], 10);
  if (mm) m = parseInt(mm[1], 10);
  if (sm) s = parseInt(sm[1], 10);
  return h * 3600 + m * 60 + s;
}

function extractField(text: string, field: string, asFloat: boolean = false): any {
  const pattern = new RegExp(`${field}:\\s*([\\d.,]+)`);
  const match = text.match(pattern);
  if (match) {
    const val = match[1].replace(/,/g, '');
    return asFloat ? parseFloat(val) : val;
  }
  return null;
}

function detectStrategy(opText: string): string {
  const stratMatch = opText.match(/Strategy:\s*([A-Za-z]+(?:\s+[A-Za-z0-9]+)?)/);
  if (stratMatch) {
    const raw = stratMatch[1].trim();
    const known = [
      "Adaptive", "Facing", "Contour 2D", "Contour", "Drilling",
      "Scallop", "Bore", "Pocket", "Slot", "Trace", "Radial",
      "Spiral", "Morphed Spiral", "Parallel", "Pencil", "Steep and Shallow",
    ];
    for (const k of known) {
      if (raw.startsWith(k)) return k;
    }
    return raw.split(/\s+/)[0];
  }

  const descMatch = opText.match(/Description:\s*(?:\d+\s+)?(\w+)/);
  if (descMatch) {
    if (descMatch[1].toLowerCase().startsWith("flat")) return "Flat";
  }

  return "Unknown";
}

function extractProductCode(opText: string): string {
  const match = opText.match(/Product:\s*(.+?)(?:\n|$)/);
  if (match) {
    let product = match[1].trim();
    product = product.split(/\s{2,}/)[0].trim();
    product = product.replace(/^fresa a punta tonda\s*/i, '');
    product = product.split(/\s+con\s+inserto/i)[0].trim();
    return product;
  }
  return "N/A";
}

// ═══════════════════════════════════════════════════════════════
// PDF Parser — main
// ═══════════════════════════════════════════════════════════════

export async function parsePdfBuffer(buffer: Buffer, originalName: string): Promise<ParsedPDF> {
  const data = await pdfParse(buffer, { pagerender: layoutAwareRender });
  const fullText = data.text;

  const result: ParsedPDF = { name: '', setups: [] };

  const docMatch = fullText.match(/Document Path:\s*(.+)/);
  if (docMatch) {
    result.name = docMatch[1].trim();
  } else {
    result.name = originalName.replace(/\.pdf$/i, '');
  }

  let setupBlocks = fullText.split(/(?=Setup Sheet for Program \d+)/)
    .filter(b => b.trim() && /Setup Sheet for Program/.test(b));

  if (setupBlocks.length === 0) {
    setupBlocks = fullText.split(/(?=Setup Sheet)/i)
      .filter(b => b.trim() && /Setup Sheet/i.test(b));
  }

  if (setupBlocks.length === 0) {
    setupBlocks = [fullText];
  }

  for (const block of setupBlocks) {
    const setup: Setup = {
      program: '',
      cycle_time_s: 0,
      n_operations: 0,
      n_tools: 0,
      operations: [],
    };

    const progMatch = block.match(/Setup Sheet for Program (\d+)/);
    if (progMatch) setup.program = progMatch[1];

    const nopsMatch = block.match(/Number Of Operations:\s*(\d+)/);
    if (nopsMatch) setup.n_operations = parseInt(nopsMatch[1], 10);

    const ntoolsMatch = block.match(/Number Of Tools:\s*(\d+)/);
    if (ntoolsMatch) setup.n_tools = parseInt(ntoolsMatch[1], 10);

    const ctMatch = block.match(/Estimated Cycle Time:\s*([\dhms:]+)/);
    if (ctMatch) setup.cycle_time_s = parseCycleTime(ctMatch[1]);

    const opPattern = /Operation\s+(\d+)\/(\d+)\s+(T\d+)\s+D\d+\s+L\d+(.*?)(?=Operation\s+\d+\/\d+|$)/gs;
    let match;

    while ((match = opPattern.exec(block)) !== null) {
      const opNum = match[1];
      const opTotal = match[2];
      const toolT = match[3];
      const opText = match[0];

      const cutting = extractField(opText, 'Cutting Distance', true) || 0.0;
      const rapid = extractField(opText, 'Rapid Distance', true) || 0.0;
      const feedrate = extractField(opText, 'Maximum Feedrate', true) || 0.0;

      const opCtMatch = opText.match(/Estimated Cycle Time:\s*([\dhms:]+(?:\s*\([^)]*\))?)/);
      const opCt = opCtMatch ? parseCycleTime(opCtMatch[1]) : 0;

      const descMatch = opText.match(/Description:\s*(.+?)(?:\s{2,}|Maximum|Minimum|$)/);
      const description = descMatch ? descMatch[1].trim() : "";

      const strategy = detectStrategy(opText);
      const product = extractProductCode(opText);

      setup.operations.push({
        op_num: parseInt(opNum, 10),
        op_total: parseInt(opTotal, 10),
        description,
        strategy,
        tool_t: toolT,
        product,
        cutting_dist: cutting,
        rapid_dist: rapid,
        max_feedrate: feedrate,
        cycle_time_s: opCt,
      });
    }

    result.setups.push(setup);
  }

  const totalOps = result.setups.reduce((acc, s) => acc + s.operations.length, 0);
  if (totalOps === 0) {
    const snippet = fullText.substring(0, 500).replace(/\n/g, ' ');
    throw new Error(
      `No operations found in '${result.name}'. Text snippet: ${snippet}...`
    );
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// Vercel Serverless Handler
// ═══════════════════════════════════════════════════════════════

export const config = {
  api: {
    bodyParser: false,
  },
};

const upload = multer({ storage: multer.memoryStorage() });

function runMiddleware(req: any, res: any, fn: any): Promise<void> {
  return new Promise((resolve, reject) => {
    fn(req, res, (result: any) => {
      if (result instanceof Error) return reject(result);
      resolve();
    });
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await runMiddleware(
      req,
      res,
      upload.fields([
        { name: 'pdfA', maxCount: 1 },
        { name: 'pdfB', maxCount: 1 },
      ]),
    );

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const pdfA = files['pdfA']?.[0];
    const pdfB = files['pdfB']?.[0];

    if (!pdfA || !pdfB) {
      return res.status(400).json({ error: 'Both pdfA and pdfB are required.' });
    }

    const toolLifeMin = parseInt(req.body?.toolLife || '20', 10);
    const toolLifeS = toolLifeMin * 60;

    const parsedA = await parsePdfBuffer(pdfA.buffer, pdfA.originalname);
    const parsedB = await parsePdfBuffer(pdfB.buffer, pdfB.originalname);

    const ma = computeMetrics(parsedA, toolLifeS);
    const mb = computeMetrics(parsedB, toolLifeS);

    const { drivers, catScoresA, catScoresB, totalA, totalB } = computeScores(ma, mb);

    return res.status(200).json({
      ma,
      mb,
      drivers,
      catScoresA,
      catScoresB,
      totalA,
      totalB,
    });
  } catch (error: any) {
    console.error('Error processing PDFs:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
