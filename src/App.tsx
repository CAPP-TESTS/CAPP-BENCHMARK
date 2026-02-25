import React, { useState, useRef } from 'react';
import { Upload, FileText, Activity, Clock, Wrench, Settings, Zap, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function fmtTime(s: number): string {
  s = Math.floor(s);
  const sec = s % 60;
  const mTotal = Math.floor(s / 60);
  const m = mTotal % 60;
  const h = Math.floor(mTotal / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  return `${m}m ${pad(sec)}s`;
}

const CATEGORY_WEIGHTS: Record<string, number> = {
  'Efficienza Temporale': 0.30,
  'Utilizzo Utensili': 0.20,
  'Vita Utile': 0.20,
  'Efficienza di Percorso': 0.15,
  'Complessità del Ciclo': 0.10,
  'Aggressività di Taglio': 0.05,
};

export default function App() {
  const [pdfA, setPdfA] = useState<File | null>(null);
  const [pdfB, setPdfB] = useState<File | null>(null);
  const [toolLife, setToolLife] = useState<number>(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  const fileInputARef = useRef<HTMLInputElement>(null);
  const fileInputBRef = useRef<HTMLInputElement>(null);

  const [debugLog, setDebugLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setDebugLog(prev => [...prev, `${new Date().toISOString().split('T')[1].split('.')[0]} ${msg}`]);
  };

  const handleRunBenchmark = async () => {
    if (!pdfA || !pdfB) {
      setError('Please upload both PDF files.');
      return;
    }

    setLoading(true);
    setError(null);
    setDebugLog([]);
    addLog('Starting benchmark...');

    const formData = new FormData();
    formData.append('pdfA', pdfA);
    formData.append('pdfB', pdfB);
    formData.append('toolLife', toolLife.toString());

    try {
      addLog('Sending request...');
      const response = await fetch('/api/benchmark', {
        method: 'POST',
        body: formData,
      });
      addLog(`Response: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errData = await response.json();
        addLog(`Error data: ${JSON.stringify(errData)}`);
        throw new Error(errData.error || 'Failed to process PDFs');
      }

      const data = await response.json();
      addLog('Data received, processing...');
      setResults(data);
      addLog('Results set.');
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setError(err.message);
    } finally {
      setLoading(false);
      addLog('Done.');
    }
  };

  const renderFileUploader = (
    file: File | null,
    setFile: (f: File | null) => void,
    inputRef: React.RefObject<HTMLInputElement | null>,
    label: string
  ) => (
    <div
      className={cn(
        "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors",
        file ? "border-indigo-500 bg-indigo-50/50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
      )}
      onClick={() => inputRef.current?.click()}
    >
      <input
        type="file"
        accept="application/pdf"
        className="hidden"
        ref={inputRef}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
          }
        }}
      />
      {file ? (
        <>
          <FileText className="w-10 h-10 text-indigo-600 mb-3" />
          <p className="text-sm font-medium text-slate-900">{file.name}</p>
          <p className="text-xs text-slate-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
        </>
      ) : (
        <>
          <Upload className="w-10 h-10 text-slate-400 mb-3" />
          <p className="text-sm font-medium text-slate-900">Upload {label}</p>
          <p className="text-xs text-slate-500 mt-1">Click or drag PDF file</p>
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <header className="mb-12 text-center">
          <div className="inline-flex items-center justify-center p-3 bg-indigo-100 rounded-2xl mb-4">
            <Activity className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-3">
            CNC Vendor Rating Benchmark
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Compare two Fusion 360 / HSMWorks Setup Sheet PDFs to generate a comprehensive scorecard.
          </p>
        </header>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 mb-8">
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {renderFileUploader(pdfA, setPdfA, fileInputARef, "Group A PDF")}
            {renderFileUploader(pdfB, setPdfB, fileInputBRef, "Group B PDF")}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-100 pt-6">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <label htmlFor="toolLife" className="text-sm font-medium text-slate-700 whitespace-nowrap">
                Tool Life Threshold (min):
              </label>
              <input
                id="toolLife"
                type="number"
                min="1"
                value={toolLife}
                onChange={(e) => setToolLife(parseInt(e.target.value) || 20)}
                className="w-24 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              />
            </div>

            <button
              onClick={handleRunBenchmark}
              disabled={loading || !pdfA || !pdfB}
              className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Run Benchmark
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-800">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {debugLog.length > 0 && (
            <div className="mt-6 p-4 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono text-slate-600 max-h-40 overflow-y-auto">
              <p className="font-bold mb-2">Debug Log:</p>
              {debugLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
        </div>

        {results && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Scorecard Header */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="bg-slate-900 px-6 py-8 text-center text-white">
                <h2 className="text-2xl font-bold tracking-tight mb-2">Final Score</h2>
                <p className="text-slate-400 text-sm">
                  {results.ma.full_name} vs {results.mb.full_name}
                </p>
              </div>
              
              <div className="grid grid-cols-3 divide-x divide-slate-100">
                <div className={cn("p-8 text-center", results.totalA >= results.totalB ? "bg-emerald-50/50" : "")}>
                  <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">{results.ma.group}</p>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className={cn("text-5xl font-bold tracking-tighter", results.totalA >= results.totalB ? "text-emerald-600" : "text-slate-900")}>
                      {results.totalA.toFixed(1)}
                    </span>
                    <span className="text-lg text-slate-400 font-medium">/100</span>
                  </div>
                </div>
                
                <div className="p-8 flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                    <span className="text-slate-400 font-bold text-lg">VS</span>
                  </div>
                  <p className="text-sm font-medium text-slate-500">
                    Winner: <strong className="text-slate-900">{results.totalA > results.totalB ? results.ma.group : (results.totalB > results.totalA ? results.mb.group : 'Tie')}</strong>
                  </p>
                </div>

                <div className={cn("p-8 text-center", results.totalB >= results.totalA ? "bg-emerald-50/50" : "")}>
                  <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">{results.mb.group}</p>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className={cn("text-5xl font-bold tracking-tighter", results.totalB >= results.totalA ? "text-emerald-600" : "text-slate-900")}>
                      {results.totalB.toFixed(1)}
                    </span>
                    <span className="text-lg text-slate-400 font-medium">/100</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Category Summary */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
                <h3 className="text-lg font-semibold text-slate-900">Category Summary</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-medium">Category</th>
                      <th className="px-6 py-4 font-medium text-center">Weight</th>
                      <th className="px-6 py-4 font-medium text-center">{results.ma.group} Score</th>
                      <th className="px-6 py-4 font-medium text-center">{results.mb.group} Score</th>
                      <th className="px-6 py-4 font-medium text-center">Winner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Object.entries(CATEGORY_WEIGHTS).map(([cat, weight]) => {
                      const sa = results.catScoresA[cat] || 0;
                      const sb = results.catScoresB[cat] || 0;
                      return (
                        <tr key={cat} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-medium text-slate-900">{cat}</td>
                          <td className="px-6 py-4 text-center text-slate-500">{(weight * 100).toFixed(0)}%</td>
                          <td className={cn("px-6 py-4 text-center font-medium", sa > sb ? "text-emerald-600" : "text-slate-700")}>
                            {sa.toFixed(1)}
                          </td>
                          <td className={cn("px-6 py-4 text-center font-medium", sb > sa ? "text-emerald-600" : "text-slate-700")}>
                            {sb.toFixed(1)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {sa > sb ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                {results.ma.group}
                              </span>
                            ) : sb > sa ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                {results.mb.group}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800">
                                Tie
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detailed Drivers */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/50">
                <h3 className="text-lg font-semibold text-slate-900">Detailed Metrics</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-medium">Driver</th>
                      <th className="px-6 py-4 font-medium text-right">{results.ma.group} Value</th>
                      <th className="px-6 py-4 font-medium text-right">{results.mb.group} Value</th>
                      <th className="px-6 py-4 font-medium text-center">{results.ma.group} Score</th>
                      <th className="px-6 py-4 font-medium text-center">{results.mb.group} Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.drivers.map((d: any, i: number) => {
                      const isNewCat = i === 0 || results.drivers[i - 1].cat !== d.cat;
                      return (
                        <React.Fragment key={i}>
                          {isNewCat && (
                            <tr className="bg-slate-50/80 border-y border-slate-200">
                              <td colSpan={5} className="px-6 py-3 text-xs font-bold text-slate-700 uppercase tracking-wider">
                                {d.cat}
                              </td>
                            </tr>
                          )}
                          <tr className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 text-slate-700">{d.name}</td>
                            <td className="px-6 py-4 text-right font-mono text-slate-600">{d.dispA}</td>
                            <td className="px-6 py-4 text-right font-mono text-slate-600">{d.dispB}</td>
                            <td className={cn("px-6 py-4 text-center font-medium", d.scoreA > d.scoreB ? "text-emerald-600 bg-emerald-50/30" : "text-slate-700")}>
                              {d.scoreA.toFixed(1)}
                            </td>
                            <td className={cn("px-6 py-4 text-center font-medium", d.scoreB > d.scoreA ? "text-emerald-600 bg-emerald-50/30" : "text-slate-700")}>
                              {d.scoreB.toFixed(1)}
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tool Life Alarms */}
            {(() => {
              const limit = results.ma.tool_life_s;
              const alarmsA = Object.entries(results.ma.tool_time).filter(([_, t]) => (t as number) > limit);
              const alarmsB = Object.entries(results.mb.tool_time).filter(([_, t]) => (t as number) > limit);
              
              if (alarmsA.length === 0 && alarmsB.length === 0) return null;

              return (
                <div className="bg-red-50 border border-red-200 rounded-2xl overflow-hidden">
                  <div className="px-6 py-5 border-b border-red-200 bg-red-100/50 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                    <h3 className="text-lg font-semibold text-red-900">Tool Life Alarms (Threshold: {limit / 60} min)</h3>
                  </div>
                  <div className="p-6 space-y-4">
                    {alarmsA.map(([p, t]: any) => (
                      <div key={`a-${p}`} className="flex items-center justify-between bg-white p-4 rounded-xl border border-red-100 shadow-sm">
                        <div>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-800 mb-2">
                            {results.ma.group}
                          </span>
                          <p className="font-medium text-slate-900">{p}</p>
                          <p className="text-sm text-slate-500">Refs: {(results.ma.tool_trefs[p] || []).join(', ')}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-red-600 font-medium">{fmtTime(t)}</p>
                          <p className="text-sm text-red-500">{((t / limit) * 100).toFixed(1)}% of life</p>
                        </div>
                      </div>
                    ))}
                    {alarmsB.map(([p, t]: any) => (
                      <div key={`b-${p}`} className="flex items-center justify-between bg-white p-4 rounded-xl border border-red-100 shadow-sm">
                        <div>
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-800 mb-2">
                            {results.mb.group}
                          </span>
                          <p className="font-medium text-slate-900">{p}</p>
                          <p className="text-sm text-slate-500">Refs: {(results.mb.tool_trefs[p] || []).join(', ')}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-red-600 font-medium">{fmtTime(t)}</p>
                          <p className="text-sm text-red-500">{((t / limit) * 100).toFixed(1)}% of life</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

          </div>
        )}
      </div>
    </div>
  );
}

