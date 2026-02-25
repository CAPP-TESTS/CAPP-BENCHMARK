import { execFile } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

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

// Resolve path to the Python helper script (works in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PYTHON_SCRIPT = join(__dirname, 'parse_pdf.py');

export async function parsePdfBuffer(buffer: Buffer, originalName: string): Promise<ParsedPDF> {
  // Write buffer to a temporary file for pdfplumber
  const tmpPath = join(tmpdir(), `capp_${randomBytes(8).toString('hex')}.pdf`);

  try {
    await writeFile(tmpPath, buffer);

    const result = await new Promise<ParsedPDF>((resolve, reject) => {
      execFile('python3', [PYTHON_SCRIPT, tmpPath], { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`PDF parsing failed: ${stderr || error.message}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as ParsedPDF;

          // If pdfplumber couldn't extract the document name, use filename
          if (!parsed.name) {
            parsed.name = originalName.replace(/\.pdf$/i, '');
          }

          // Validate that operations were found
          const totalOps = parsed.setups.reduce((acc, s) => acc + s.operations.length, 0);
          if (totalOps === 0) {
            reject(new Error(`No operations found in '${parsed.name}'. The PDF may not be a valid Fusion 360 / HSMWorks Setup Sheet.`));
            return;
          }

          resolve(parsed);
        } catch (parseError: any) {
          reject(new Error(`Failed to parse Python output: ${parseError.message}. Stdout: ${stdout.substring(0, 200)}`));
        }
      });
    });

    return result;
  } finally {
    // Clean up temp file
    await unlink(tmpPath).catch(() => {});
  }
}
