import pdfParse from 'pdf-parse';

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
    const known = ["Adaptive", "Facing", "Contour 2D", "Contour", "Drilling",
                   "Scallop", "Bore", "Pocket", "Slot", "Trace", "Radial",
                   "Spiral", "Morphed Spiral", "Parallel", "Pencil", "Steep and Shallow"];
    for (const k of known) {
      if (raw.startsWith(k)) return k;
    }
    return raw.split(/\s+/)[0];
  }

  const descMatch = opText.match(/Description:\s*(?:\d+\s+)?(\w+)/);
  if (descMatch) {
    const descWord = descMatch[1];
    if (descWord.toLowerCase().startsWith("flat")) return "Flat";
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

export async function parsePdfBuffer(buffer: Buffer, originalName: string): Promise<ParsedPDF> {
  const data = await pdfParse(buffer);
  const fullText = data.text;

  const result: ParsedPDF = { name: '', setups: [] };

  const docMatch = fullText.match(/Document Path:\s*(.+)/);
  if (docMatch) {
    result.name = docMatch[1].trim();
  } else {
    result.name = originalName.replace(/\.pdf$/i, '');
  }

  // Fallback: if splitting by "Setup Sheet" fails to find blocks with operations, 
  // we might be dealing with a single page or different format.
  // We will try to parse operations from the whole text if the split method yields no results.
  
  let setupBlocks = fullText.split(/(?=Setup Sheet)/i).filter(b => b.trim() && /Setup Sheet/i.test(b));
  
  if (setupBlocks.length === 0) {
    // If no explicit setup blocks found, treat the entire text as one setup
    setupBlocks = [fullText];
  }

  for (const block of setupBlocks) {
    const setup: Setup = { program: '', cycle_time_s: 0, n_operations: 0, n_tools: 0, operations: [] };

    const progMatch = block.match(/Program\s*(\d+)/i);
    if (progMatch) setup.program = progMatch[1];

    const nopsMatch = block.match(/Number Of Operations:\s*(\d+)/i);
    if (nopsMatch) setup.n_operations = parseInt(nopsMatch[1], 10);

    const ntoolsMatch = block.match(/Number Of Tools:\s*(\d+)/i);
    if (ntoolsMatch) setup.n_tools = parseInt(ntoolsMatch[1], 10);

    const ctMatch = block.match(/(?:Estimated\s+)?Cycle Time:\s*([\dhms:]+)/i);
    if (ctMatch) setup.cycle_time_s = parseCycleTime(ctMatch[1]);

    // Strategy 1: Standard "Operation X/Y T<num>"
    const opPattern = /((?:Operation|Op\.?)\s+(\d+)\s*\/\s*(\d+)\s+(T\d+)[\s\S]*?)(?=(?:Operation|Op\.?)\s+\d+\s*\/\s*\d+|$)/gi;
    let match;
    let opsFound = false;

    while ((match = opPattern.exec(block)) !== null) {
      opsFound = true;
      const opText = match[1];
      const opNum = match[2];
      const opTotal = match[3];
      const toolT = match[4];

      const cutting = extractField(opText, 'Cutting Distance', true) || 0.0;
      const rapid = extractField(opText, 'Rapid Distance', true) || 0.0;
      const feedrate = extractField(opText, 'Maximum Feedrate', true) || 0.0;

      const opCtMatches = [...opText.matchAll(/(?:Estimated\s+)?Cycle Time:\s*([\dhms:]+(?:\s*\([^)]*\))?)/gi)];
      let opCt = 0;
      const validCts = opCtMatches.map(m => parseCycleTime(m[1])).filter(ct => ct !== setup.cycle_time_s);
      
      if (validCts.length > 0) {
        // The operation cycle time is usually the one that differs from the setup cycle time
        // If there are multiple, we take the last one, as it's typically at the end of the operation block
        opCt = validCts[validCts.length - 1];
      } else if (opCtMatches.length > 0) {
        opCt = parseCycleTime(opCtMatches[0][1]);
      }

      const descMatch = opText.match(/Description:\s*(.+?)(?:\s{2,}|Maximum|Minimum|$)/i);
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

    // Strategy 2: Fallback for "T<num> D<num>" if Strategy 1 failed
    if (!opsFound) {
      // Look for blocks starting with T<num> followed by D<num> (common in some compact sheets)
      // We assume the operation starts at T<num> and goes until the next T<num>
      const fallbackPattern = /(T\d+)\s+D\d+[\s\S]*?(?=T\d+\s+D\d+|$)/gi;
      let opCounter = 1;
      while ((match = fallbackPattern.exec(block)) !== null) {
        const opText = match[0];
        const toolT = match[1];

        const cutting = extractField(opText, 'Cutting Distance', true) || 0.0;
        const rapid = extractField(opText, 'Rapid Distance', true) || 0.0;
        const feedrate = extractField(opText, 'Maximum Feedrate', true) || 0.0;

        const opCtMatches = [...opText.matchAll(/(?:Estimated\s+)?Cycle Time:\s*([\dhms:]+(?:\s*\([^)]*\))?)/gi)];
        let opCt = 0;
        const validCts = opCtMatches.map(m => parseCycleTime(m[1])).filter(ct => ct !== setup.cycle_time_s);
        
        if (validCts.length > 0) {
          opCt = validCts[validCts.length - 1];
        } else if (opCtMatches.length > 0) {
          opCt = parseCycleTime(opCtMatches[0][1]);
        }

        const strategy = detectStrategy(opText);
        const product = extractProductCode(opText);

        setup.operations.push({
          op_num: opCounter++,
          op_total: 0, // Unknown total in this format
          description: "Operation " + opCounter,
          strategy,
          tool_t: toolT,
          product,
          cutting_dist: cutting,
          rapid_dist: rapid,
          max_feedrate: feedrate,
          cycle_time_s: opCt,
        });
      }
    }

    result.setups.push(setup);
  }

  // If still no operations, throw an error with a snippet of text to help debug
  const totalOps = result.setups.reduce((acc, s) => acc + s.operations.length, 0);
  if (totalOps === 0) {
    const snippet = fullText.substring(0, 500).replace(/\n/g, ' ');
    throw new Error(`No operations found in '${result.name}'. Text snippet: ${snippet}...`);
  }

  return result;
}
