import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import { parsePdfBuffer } from './src/services/pdfParser';
import { computeMetrics, computeScores } from './src/services/metrics';

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post('/api/benchmark', upload.fields([
    { name: 'pdfA', maxCount: 1 },
    { name: 'pdfB', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const pdfA = files['pdfA']?.[0];
      const pdfB = files['pdfB']?.[0];

      if (!pdfA || !pdfB) {
        return res.status(400).json({ error: 'Both pdfA and pdfB are required.' });
      }

      const toolLifeMin = parseInt(req.body.toolLife || '20', 10);
      const toolLifeS = toolLifeMin * 60;

      const parsedA = await parsePdfBuffer(pdfA.buffer, pdfA.originalname);
      const parsedB = await parsePdfBuffer(pdfB.buffer, pdfB.originalname);

      const ma = computeMetrics(parsedA, toolLifeS);
      const mb = computeMetrics(parsedB, toolLifeS);

      const { drivers, catScoresA, catScoresB, totalA, totalB } = computeScores(ma, mb);

      res.json({
        ma,
        mb,
        drivers,
        catScoresA,
        catScoresB,
        totalA,
        totalB
      });
    } catch (error: any) {
      console.error('Error processing PDFs:', error);
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
