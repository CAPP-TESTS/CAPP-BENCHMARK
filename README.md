# CAPP Benchmark — CNC Vendor Rating

Compare two **Fusion 360 / HSMWorks Setup Sheet PDFs** and generate a weighted scorecard across 6 categories: cycle time efficiency, tool utilization, tool life, path efficiency, cycle complexity, and cutting aggressiveness.

**Live demo:** https://cappbenchmark.vercel.app/

---

## How to Use

1. Upload **PDF A** (first setup sheet) and **PDF B** (second setup sheet)
2. Set the **Tool Life** threshold in minutes (default: 20 min)
3. Click **Run Benchmark**
4. Review the results:
   - **Final Score** — weighted total for each PDF
   - **Category Scores** — breakdown by the 6 evaluation categories
   - **Detailed Metrics** — per-driver comparison table
   - **Tool Life Alarms** — warnings for tools exceeding life thresholds

### Scoring Categories

| Category | Weight |
|---|---|
| Efficienza Temporale | 30% |
| Utilizzo Utensili | 20% |
| Vita Utile | 20% |
| Efficienza di Percorso | 15% |
| Complessità del Ciclo | 10% |
| Aggressività di Taglio | 5% |

---

## Run Locally

**Prerequisites:** Node.js 18+

```bash
# 1. Clone the repository
git clone https://github.com/CAPP-TESTS/CAPP-BENCHMARK.git
cd CAPP-BENCHMARK

# 2. Install dependencies
npm install

# 3. (Optional) Create .env.local with your Gemini API key
cp .env.example .env.local
# Edit .env.local and set GEMINI_API_KEY

# 4. Start the dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

### Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server (Express + Vite HMR) |
| `npm run build` | Build the frontend for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run TypeScript type checking |

---

## Deploy on Vercel

### 1. Import the repository

- Go to [vercel.com/new](https://vercel.com/new)
- Import the GitHub repository

### 2. Configure settings

Vercel auto-detects the Vite framework. Verify these settings:

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Build Command | `vite build` |
| Output Directory | `dist` |
| Node.js Version | 18.x or 20.x |

### 3. Set environment variables

In **Settings > Environment Variables**, add:

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Optional | Google Gemini API key |

### 4. Deploy

Click **Deploy**. Vercel will:
- Run `vite build` to generate the static frontend in `dist/`
- Deploy `api/benchmark.ts` as a serverless function at `/api/benchmark`
- Route all other requests to the static frontend

### Architecture on Vercel

```
Frontend (static)         Serverless Function
dist/                     api/benchmark.ts
  index.html               POST /api/benchmark
  assets/                    ├─ Parse PDF A & B
                             ├─ Compute metrics
                             └─ Return JSON scorecard
```

---

## Project Structure

```
CAPP-BENCHMARK/
├── api/
│   └── benchmark.ts      # Vercel serverless function (self-contained)
├── src/
│   ├── App.tsx            # React frontend
│   ├── main.tsx           # React entry point
│   └── index.css          # Styles (Tailwind CSS)
├── server.ts              # Express dev server (local only)
├── index.html             # HTML entry point
├── vite.config.ts         # Vite build configuration
├── vercel.json            # Vercel deployment config
└── package.json
```
