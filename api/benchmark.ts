import multer from 'multer';
import { parsePdfBuffer } from '../src/services/pdfParser';
import { computeMetrics, computeScores } from '../src/services/metrics';

// Disable Vercel's default body parser so multer can handle multipart
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
