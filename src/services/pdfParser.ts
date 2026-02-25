import pdfParse from 'pdf-parse';

// ═══════════════════════════════════════════════════════════════
// Interfaces
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
//
// The default pdf-parse renderer concatenates text items without
// spaces and uses strict Y equality for line breaks, producing
// garbled output for structured PDFs.
//
// This renderer reconstructs text layout using x/y coordinates,
// similar to pdfplumber/pdfminer:
//   1. Collect all text items with their positions
//   2. Group items into lines by Y proximity
//   3. Sort lines top-to-bottom, items left-to-right
//   4. Insert spaces based on X gaps between items
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

    // Collect items with position info from the transform matrix
    // transform = [scaleX, shearX, shearY, scaleY, translateX, translateY]
    const items: TextItem[] = [];
    for (const raw of textContent.items) {
      if (raw.str === undefined || raw.str === '') continue;
      const tx = raw.transform;
      const fontSize = Math.abs(tx[0]) || Math.abs(tx[3]) || 12;
      items.push({
        str: raw.str,
        x: tx[4],
        y: tx[5],  // PDF Y axis: increases upward
        width: raw.width != null && raw.width > 0
          ? raw.width
          : raw.str.length * fontSize * 0.5,  // estimate if missing
        height: fontSize,
      });
    }

    if (items.length === 0) return '';

    // Calculate thresholds based on average font size
    const avgHeight = items.reduce((s, i) => s + i.height, 0) / items.length;
    const yTolerance = avgHeight * 0.35;

    // Sort by Y descending (top of page first), then X ascending
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Group into lines by Y proximity
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

    // Reconstruct each line with proper spacing
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
            lineText += '  ';  // Large gap → multi-space (column separator)
          } else if (gap > charWidth * 0.15) {
            lineText += ' ';   // Normal word space
          }
          // else: items touching/overlapping → no space
        }
        lineText += line[k].str;
      }

      textLines.push(lineText);
    }

    return textLines.join('\n');
  });
}

// ═══════════════════════════════════════════════════════════════
// Parsing helpers — aligned with benchmark_cnc.py
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
    return raw.split(/\s+/)[0]; // fallback: first word
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
// Main parser — regex patterns aligned with benchmark_cnc.py
// ═══════════════════════════════════════════════════════════════

export async function parsePdfBuffer(buffer: Buffer, originalName: string): Promise<ParsedPDF> {
  // Use layout-aware renderer instead of pdf-parse's default
  const data = await pdfParse(buffer, { pagerender: layoutAwareRender });
  const fullText = data.text;

  const result: ParsedPDF = { name: '', setups: [] };

  // Document name (same as Python)
  const docMatch = fullText.match(/Document Path:\s*(.+)/);
  if (docMatch) {
    result.name = docMatch[1].trim();
  } else {
    result.name = originalName.replace(/\.pdf$/i, '');
  }

  // Split by "Setup Sheet for Program <N>" — same regex as Python
  let setupBlocks = fullText.split(/(?=Setup Sheet for Program \d+)/)
    .filter(b => b.trim() && /Setup Sheet for Program/.test(b));

  if (setupBlocks.length === 0) {
    // Fallback: try looser split
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

    // Program number — same as Python: "Setup Sheet for Program (\d+)"
    const progMatch = block.match(/Setup Sheet for Program (\d+)/);
    if (progMatch) setup.program = progMatch[1];

    // Number of operations / tools
    const nopsMatch = block.match(/Number Of Operations:\s*(\d+)/);
    if (nopsMatch) setup.n_operations = parseInt(nopsMatch[1], 10);

    const ntoolsMatch = block.match(/Number Of Tools:\s*(\d+)/);
    if (ntoolsMatch) setup.n_tools = parseInt(ntoolsMatch[1], 10);

    // Setup cycle time — REQUIRE "Estimated" like Python
    const ctMatch = block.match(/Estimated Cycle Time:\s*([\dhms:]+)/);
    if (ctMatch) setup.cycle_time_s = parseCycleTime(ctMatch[1]);

    // Extract operations — same regex as Python:
    // Operation X/Y T<n> D<n> L<n> ... until next Operation or end
    const opPattern = /Operation\s+(\d+)\/(\d+)\s+(T\d+)\s+D\d+\s+L\d+(.*?)(?=Operation\s+\d+\/\d+|$)/gs;
    let match;

    while ((match = opPattern.exec(block)) !== null) {
      const opNum = match[1];
      const opTotal = match[2];
      const toolT = match[3];
      const opText = match[0]; // full operation text including header

      const cutting = extractField(opText, 'Cutting Distance', true) || 0.0;
      const rapid = extractField(opText, 'Rapid Distance', true) || 0.0;
      const feedrate = extractField(opText, 'Maximum Feedrate', true) || 0.0;

      // Operation cycle time — simple first match like Python
      // (no filtering, no "last match" logic)
      const opCtMatch = opText.match(/Estimated Cycle Time:\s*([\dhms:]+(?:\s*\([^)]*\))?)/);
      const opCt = opCtMatch ? parseCycleTime(opCtMatch[1]) : 0;

      // Description
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

  // Validate
  const totalOps = result.setups.reduce((acc, s) => acc + s.operations.length, 0);
  if (totalOps === 0) {
    const snippet = fullText.substring(0, 500).replace(/\n/g, ' ');
    throw new Error(
      `No operations found in '${result.name}'. Text snippet: ${snippet}...`
    );
  }

  return result;
}
