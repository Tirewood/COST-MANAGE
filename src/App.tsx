/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  BarElement, 
  PointElement, 
  LineElement, 
  ArcElement,
  Title, 
  Tooltip, 
  Legend, 
  ChartData
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { FileUp, FileText, Plus, Database, Download, RotateCcw, Search, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { OrderRecord, ViewType, MONTHS, CO_LIST, Language } from "./types";
import { readPdf, normalizeCopiedText, parseAllLines, readInputFile, isImageFile } from "./lib/pdfAnalyzer";
import { cn, money, fmt, pct, buyerNorm } from "./lib/utils";
import { KPICard } from "./components/KPICard";
import { DataTable } from "./components/DataTable";
import { i18n } from "./i18n";
import { Languages, FileJson, Upload, ImageIcon, Printer } from "lucide-react";
import { GoogleGenAI } from "@google/genai";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  ChartDataLabels
);

export default function App() {
  const [records, setRecords] = useState<OrderRecord[]>([]);
  const [view, setView] = useState<ViewType>("overview");
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem("sae-a-lang");
    return (saved as Language) || "ko";
  });
  const t = i18n[lang];

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("대기 중");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisLog, setAnalysisLog] = useState<string[]>([]);
  const [pasteValue, setPasteValue] = useState("");
  
  // Filters
  const [yearFilter, setYearFilter] = useState("2026");
  const [monthFilter, setMonthFilter] = useState("");
  const [buyerFilter, setBuyerFilter] = useState("");
  const [coFilter, setCoFilter] = useState("");
  const [metricFilter, setMetricFilter] = useState<"amount" | "quantity">("amount");
  const [search, setSearch] = useState("");

  const [editRecord, setEditRecord] = useState<Partial<OrderRecord> | null>(null);
  const [groupModal, setGroupModal] = useState<{ field: string; label: string; year?: string } | null>(null);

  // Group Editing Helpers
  const groupMatch = (field: string, label: string, year?: string) => (r: OrderRecord) => {
    if (field === "year") return r.year === label;
    if (field === "month") return r.year === year && r.month === label.padStart(2, "0");
    if (field === "buyer") return r.buyer === label;
    if (field === "co") return r.co === label;
    return false;
  };

  const currentGroupRecords = useMemo(() => {
    if (!groupModal) return [];
    return records.filter(groupMatch(groupModal.field, groupModal.label, groupModal.year));
  }, [records, groupModal]);

  const handleApplyGroupAdjustment = (newValue: number) => {
    if (!groupModal || currentGroupRecords.length === 0) return;
    const metric = metricFilter;
    const sameMetricRows = currentGroupRecords.filter(r => r.metric === metric);
    if (!sameMetricRows.length) {
      alert("보정할 원본 데이터가 없습니다. 수동 추가를 이용하세요.");
      return;
    }
    const oldTotal = sameMetricRows.reduce((s, c) => s + c.value, 0);
    const diff = newValue - oldTotal;
    if (diff === 0) return;

    const firstId = sameMetricRows[0].id;
    const newRecords = records.map(r => {
      if (r.id === firstId) {
        return { 
          ...r, 
          value: Math.max(0, r.value + diff), 
          updatedAt: new Date().toISOString(),
          file: r.file + " / chart-adjust"
        };
      }
      return r;
    });
    saveToStorage(newRecords);
  };

  const handleDeleteGroup = (field: string, label: string, year?: string) => {
    if (confirm(t.confirmAllDelete)) {
      const idsToDelete = new Set(records.filter(groupMatch(field, label, year)).map(r => r.id));
      saveToStorage(records.filter(r => !idsToDelete.has(r.id)));
      setGroupModal(null);
    }
  };

  useEffect(() => {
    fetch("/api/records")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setRecords(data);
      })
      .catch(err => {
        console.error("Failed to load records from server", err);
        // Fallback to localStorage if server fails
        const saved = localStorage.getItem("orderStatusTableManaged.v1");
        if (saved) setRecords(JSON.parse(saved));
      });
  }, []);

  useEffect(() => {
    localStorage.setItem("sae-a-lang", lang);
  }, [lang]);

  const saveToStorage = async (newRecords: OrderRecord[]) => {
    setRecords(newRecords);
    // Browser persistence
    localStorage.setItem("orderStatusTableManaged.v1", JSON.stringify(newRecords));
    // Server persistence
    try {
      await fetch("/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRecords)
      });
    } catch (err) {
      console.error("Failed to save to server", err);
    }
  };

  const years = useMemo(() => {
    const ys = [...new Set(records.map(r => r.year))].sort();
    return ys.length ? ys : ["2024", "2025", "2026"];
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const matchYear = !yearFilter || r.year === yearFilter;
      const matchMonth = !monthFilter || r.month === monthFilter;
      const matchBuyer = !buyerFilter || r.buyer === buyerFilter;
      const matchCo = !coFilter || r.co === coFilter;
      const matchSearch = !search || 
        `${r.buyer} ${r.co} ${r.report}`.toLowerCase().includes(search.toLowerCase());
      return matchYear && matchMonth && matchBuyer && matchCo && matchSearch;
    });
  }, [records, yearFilter, monthFilter, buyerFilter, coFilter, search]);

  const upsertRows = (rows: Partial<OrderRecord>[], sourceLabel: string) => {
    const map = new Map<string, OrderRecord>();
    // Existing records into map
    records.forEach(r => {
      const k = `${r.report}|${r.year}|${r.month}|${r.buyer}|${r.co}|${r.metric}`.toUpperCase();
      map.set(k, r);
    });

    let added = 0, updated = 0, same = 0, skipped = 0;

    rows.forEach(raw => {
      const r: OrderRecord = {
        id: crypto.randomUUID(),
        report: raw.report || "manual",
        year: String(raw.year || "").trim(),
        month: String(raw.month || "").trim().padStart(2, '0').replace(/^00$/, ""),
        buyer: buyerNorm(raw.buyer || ""),
        co: (raw.co || "").trim().toUpperCase(),
        metric: (raw.metric || "amount") as any,
        value: Number(raw.value) || 0,
        file: raw.file || sourceLabel,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Aggregation row filter (TOTAL, etc.)
      const isAgg = /TOTAL|G\.TOTAL|GRAND|SUBTOTAL|TOTALS/i.test(r.buyer) || /TOTAL|G\.TOTAL|GRAND|SUBTOTAL|TOTALS/i.test(r.co);
      if (isAgg || r.value === 0) {
        skipped++;
        return;
      }

      const k = `${r.report}|${r.year}|${r.month}|${r.buyer}|${r.co}|${r.metric}`.toUpperCase();
      const old = map.get(k);

      if (!old) {
        map.set(k, r);
        added++;
      } else if (Number(old.value) !== Number(r.value)) {
        map.set(k, {
          ...old,
          ...r,
          id: old.id,
          createdAt: old.createdAt,
          file: old.file.includes(r.file) ? old.file : `${old.file}; ${r.file}`,
          updatedAt: new Date().toISOString()
        });
        updated++;
      } else {
        same++;
      }
    });

    const newRecords = Array.from(map.values()).sort((a, b) => 
      a.year.localeCompare(b.year) || a.month.localeCompare(b.month) || a.buyer.localeCompare(b.buyer)
    );
    
    saveToStorage(newRecords);
    return { added, updated, same, skipped, total: rows.length };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisLog([]);
    setProgress(0);
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setAnalysisStatus(lang === 'ko' ? `${file.name} 분석 중...` : `Analyzing ${file.name}...`);
      try {
        if (isImageFile(file)) {
          const rows = await analyzeImageWithGemini(file);
          const res = upsertRows(rows, file.name);
          setAnalysisLog(prev => [...prev, 
            lang === 'ko' 
              ? `[IMAGE] ${file.name}: ${res.total}건 분석 (신규 ${res.added}, 수정 ${res.updated})`
              : `[IMAGE] ${file.name}: ${res.total} records (New ${res.added}, Updated ${res.updated})`
          ]);
        } else {
          const parsed = await readInputFile(file, (p) => setProgress(((i + p) / files.length) * 100));
          const lines = (parsed as any).lines || [];
          const rows = parseAllLines(lines, file.name);
          if (rows.length === 0) throw new Error("No data found in file");
          const res = upsertRows(rows, file.name);
          
          setAnalysisLog(prev => [...prev, 
            lang === 'ko' 
              ? `${file.name}: ${res.total}건 분석 (신규 ${res.added}, 수정 ${res.updated}, 중복제외 ${res.same})`
              : `${file.name}: ${res.total} records (New ${res.added}, Updated ${res.updated}, Deduped ${res.same})`
          ]);
        }
      } catch (err) {
        console.error(err);
        setAnalysisLog(prev => [...prev, `Error: ${file.name} - ${err instanceof Error ? err.message : 'Unknown error'}`]);
      }
    }
    
    setIsAnalyzing(false);
    setAnalysisStatus(lang === 'ko' ? "분석 완료" : "Analysis Complete");
    setProgress(100);
    // Refresh files input
    e.target.value = '';
  };

  const analyzeImageWithGemini = async (file: File): Promise<Partial<OrderRecord>[]> => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });

      const promptString = `Extract order status data from this image. 
      The output must be a valid JSON array of objects.
      Each object must have: year (string, 4 digits), month (string, 2 digits), buyer (string), co (string, 3 characters), metric (either 'amount' or 'quantity'), value (number).
      Ignore 'TOTAL' rows. Translate Season data (SPR, SUM, FALL, HOL) into empty month if needed or map to standard months if appropriate.
      Only return the JSON array, no markdown or explanation.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: file.type } },
            { text: promptString }
          ]
        },
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = response.text || "[]";
      return JSON.parse(text);
    } catch (err) {
      console.error("Gemini analysis failed", err);
      return [];
    }
  };

  const handlePasteAnalyze = () => {
    if (!pasteValue.trim()) return;
    const lines = normalizeCopiedText(pasteValue);
    const rows = parseAllLines(lines, "Clipboard Paste");
    const { added, updated } = upsertRows(rows, "Clipboard Paste");
    setStatus(lang === 'ko' ? `붙여넣기 완료: 신규 ${added}, 업데이트 ${updated}` : `Paste Done: New ${added}, Update ${updated}`);
    setPasteValue("");
  };

  const handleDeleteRecord = (id: string) => {
    if (confirm(t.confirmDelete)) {
      saveToStorage(records.filter(r => r.id !== id));
    }
  };

  const handleSaveEdit = () => {
    if (!editRecord) return;
    const r = {
      ...editRecord,
      id: editRecord.id || crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      createdAt: editRecord.createdAt || new Date().toISOString()
    } as OrderRecord;

    // Check for logical duplicates (same identity but different ID)
    const duplicate = records.find(x => 
      x.id !== r.id &&
      x.report === r.report &&
      x.year === r.year &&
      x.month === r.month &&
      x.buyer === r.buyer &&
      x.co === r.co &&
      x.metric === r.metric
    );

    if (duplicate) {
      if (confirm(lang === 'ko' ? "동일한 조건의 데이터가 이미 존재합니다. 덮어쓸까요?" : "Duplicate record found. Overwrite?")) {
        const filtered = records.filter(x => x.id !== duplicate.id);
        saveToStorage(filtered.map(x => x.id === r.id ? r : x).concat(records.some(x => x.id === r.id) ? [] : [r]));
      }
      return;
    }

    if (records.some(x => x.id === r.id)) {
      saveToStorage(records.map(x => x.id === r.id ? r : x));
    } else {
      saveToStorage([...records, r]);
    }
    setEditRecord(null);
  };

  const exportToExcel = () => {
    const wb = XLSX.utils.book_new();
    
    // Detailed Data
    const sheetData = records.map(r => ({
      Report: r.report,
      Year: r.year,
      Month: r.month,
      Buyer: r.buyer,
      CO: r.co,
      Metric: r.metric,
      Value: r.value,
      Source: r.file
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetData), "Raw Data");

    // Monthly Summary
    const monthlySummary: any[] = [];
    years.forEach(y => {
      MONTHS.forEach(m => {
        const mr = records.filter(r => r.year === y && r.month === m);
        monthlySummary.push({
          Year: y,
          Month: m,
          Amount: mr.filter(r => r.metric === "amount").reduce((s, c) => s + c.value, 0),
          Quantity: mr.filter(r => r.metric === "quantity").reduce((s, c) => s + c.value, 0)
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlySummary), "Monthly Summary");

    // Buyer Summary
    const buyers = [...new Set(records.map(r => r.buyer))].sort();
    const buyerSummary = buyers.map(b => {
      const br = records.filter(r => r.buyer === b);
      return {
        Buyer: b || "(Unknown)",
        Amount: br.filter(r => r.metric === "amount").reduce((s, c) => s + c.value, 0),
        Quantity: br.filter(r => r.metric === "quantity").reduce((s, c) => s + c.value, 0)
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buyerSummary), "Buyer Summary");

    XLSX.writeFile(wb, `sae-a-trading-records-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const exportToJson = () => {
    const dataStr = JSON.stringify(records, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', `sae-a-records-${new Date().getTime()}.json`);
    linkElement.click();
  };

  const handleJsonImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json)) {
          if (confirm(lang === 'ko' ? "데이터를 가져와서 합치시겠습니까? (중복 제외)" : "Merge records from JSON? (Deduplicated)")) {
            upsertRows(json, file.name || "JSON Import");
          }
        }
      } catch (err) {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };

  const handleExcelImport = handleFileUpload; // Unified

  // Determine which report type is most authoritative for the current view
  const canonicalReport = useMemo(() => {
    const priorityOrder = ["monthlyBuyer", "monthlyCO", "annualCOBuyer", "season", "manual", "Excel Import", "JSON Import", "Clipboard Paste"];
    const presentReports = new Set(records.filter(r => !yearFilter || r.year === yearFilter).map(r => r.report));
    for (const p of priorityOrder) {
      if (presentReports.has(p)) return p;
    }
    return null;
  }, [records, yearFilter]);

  const filteredKPI = useMemo(() => {
    return records.filter(r => {
      const matchYear = !yearFilter || r.year === yearFilter;
      const matchMonth = !monthFilter || r.month === monthFilter;
      const matchBuyer = !buyerFilter || r.buyer === buyerFilter;
      const matchCo = !coFilter || r.co === coFilter;
      
      // If we have a canonical report, only use that for aggregate KPIs and Charts
      // unless the user is explicitly searching or filtering in a way that implies a broad view.
      const matchReport = !canonicalReport || r.report === canonicalReport;
      
      const matchSearch = !search || 
        `${r.buyer} ${r.co} ${r.report}`.toLowerCase().includes(search.toLowerCase());
        
      return matchYear && matchMonth && matchBuyer && matchCo && matchSearch && matchReport;
    });
  }, [records, canonicalReport, yearFilter, monthFilter, buyerFilter, coFilter, search]);

  const currentTotal = useMemo(() => {
    const amount = filteredKPI.filter(r => r.metric === "amount").reduce((acc, curr) => acc + curr.value, 0);
    const qty = filteredKPI.filter(r => r.metric === "quantity").reduce((acc, curr) => acc + curr.value, 0);
    return { amount, qty };
  }, [filteredKPI]);

  const prevYear = String(Number(yearFilter) - 1);
  const prevTotal = useMemo(() => {
    const prevYearRows = records.filter(r => r.year === prevYear && (!canonicalReport || r.report === canonicalReport));
    const amount = prevYearRows.filter(r => r.metric === "amount").reduce((acc, curr) => acc + curr.value, 0);
    const qty = prevYearRows.filter(r => r.metric === "quantity").reduce((acc, curr) => acc + curr.value, 0);
    return { amount, qty };
  }, [records, prevYear, canonicalReport]);

  const topBuyer = useMemo(() => {
    const bMap: any = {};
    filteredKPI.filter(r => r.metric === "amount").forEach(r => {
      const b = r.buyer || "(Unknown)";
      bMap[b] = (bMap[b] || 0) + r.value;
    });
    const sorted = Object.entries(bMap).sort((a: any, b: any) => b[1] - a[1]);
    return sorted.length ? { name: sorted[0][0], value: Number(sorted[0][1]) } : { name: "-", value: 0 };
  }, [filteredKPI]);

  // Chart Data
  const monthlyChartData: ChartData<"bar"> = useMemo(() => ({
    labels: MONTHS,
    datasets: [
      {
        type: "bar" as const,
        label: "Amount",
        data: MONTHS.map(m => {
          return filteredKPI.filter(r => r.month === m && r.metric === "amount").reduce((s, c) => s + c.value, 0);
        }),
        backgroundColor: "#1e40af",
        borderRadius: 4,
        yAxisID: "y",
      },
      {
        type: "line" as any,
        label: "Quantity",
        data: MONTHS.map(m => {
          return filteredKPI.filter(r => r.month === m && r.metric === "quantity").reduce((s, c) => s + c.value, 0);
        }),
        borderColor: "#dc2626",
        backgroundColor: "rgba(220, 38, 38, 0.1)",
        tension: 0.3,
        yAxisID: "y1",
      },
    ] as any,
  }), [filteredKPI]);

  const buyerData = useMemo(() => {
    const map: any = {};
    filteredKPI.filter(r => r.metric === metricFilter).forEach(r => {
      const b = r.buyer || "(Unknown)";
      map[b] = (map[b] || 0) + r.value;
    });
    const sorted = Object.entries(map).sort((a: any, b: any) => b[1] - a[1]).slice(0, 15);
    return {
      labels: sorted.map(x => x[0]),
      data: sorted.map(x => Number(x[1]))
    };
  }, [filteredKPI, metricFilter]);

  const coData = useMemo(() => {
    const map: any = {};
    filteredKPI.filter(r => r.metric === metricFilter).forEach(r => {
      const c = r.co?.toUpperCase().trim();
      if (c && CO_LIST.includes(c)) {
        map[c] = (map[c] || 0) + r.value;
      }
    });
    return {
      labels: Object.keys(map).sort((a,b) => map[b] - map[a]),
      data: Object.keys(map).sort((a,b) => map[b] - map[a]).map(k => map[k]) as number[]
    };
  }, [filteredKPI, metricFilter]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20 overflow-x-hidden">
      <header className="bg-gradient-to-r from-blue-900 to-indigo-700 text-white p-6 md:p-8 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">{t.title}</h1>
            <p className="text-blue-100 text-sm mt-1 font-medium opacity-90">{t.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1 bg-white/10 rounded-xl px-2 py-1">
              <Languages size={18} className="text-blue-200" />
              {(["ko", "en", "vi"] as Language[]).map(l => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={cn(
                    "px-2 py-1 text-xs font-black rounded-lg transition-all",
                    lang === l ? "bg-white text-blue-900" : "text-white hover:bg-white/10"
                  )}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <button 
              onClick={exportToExcel}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-4 py-2 text-sm font-bold transition-all"
            >
              <Download size={18} /> {t.exportExcel}
            </button>
            <div className="flex gap-1">
              <button 
                onClick={() => window.print()}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-3 py-2 text-sm font-bold transition-all"
                title={lang === 'ko' ? "PDF 출력" : "Print PDF"}
              >
                <Printer size={18} />
              </button>
              <button 
                onClick={exportToJson}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-3 py-2 text-sm font-bold transition-all"
                title={t.exportJson}
              >
                <FileJson size={18} />
              </button>
              <div className="relative">
                <input 
                  type="file" 
                  accept=".json" 
                  onChange={handleJsonImport} 
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                />
                <button className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-3 py-2 text-sm font-bold transition-all" title={t.importJson}>
                  <Upload size={18} />
                </button>
              </div>
              <div className="relative">
                <input 
                  type="file" 
                  accept=".xlsx, .xls" 
                  onChange={handleExcelImport} 
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                />
                <button className="flex items-center gap-2 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-100 rounded-xl px-3 py-2 text-sm font-bold transition-all" title={t.importExcel}>
                  <Database size={18} />
                </button>
              </div>
            </div>
            <button 
              onClick={() => { if(confirm(t.confirmReset)) saveToStorage([]); }}
              className="flex items-center gap-2 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-100 rounded-xl px-4 py-2 text-sm font-bold transition-all"
            >
              <RotateCcw size={18} /> {t.reset}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        {/* Unified Upload Section */}
        <section className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 px-2">
            <div className="space-y-4">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <FileUp size={24} />
                </div>
                {lang === 'ko' ? '기타/PDF/Excel 자동 분석 등록' : 'Auto Analysis Registration'}
              </h3>
              <p className="text-slate-400 text-xs font-medium leading-relaxed">
                {lang === 'ko' 
                  ? 'PDF 파일(Season, C/O, Buyer 월별)과 Excel 파일을 드래그하여 등록하거나 버튼을 눌러 선택하세요. 텍스트가 깨진 파일도 자동 보정하여 완벽하게 분석합니다.'
                  : 'Drag & drop PDF or Excel files, or click to select. Even files with broken text are automatically corrected and analyzed perfectly.'}
              </p>
              
              <div 
                className={cn(
                  "relative h-48 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all group overflow-hidden",
                  isAnalyzing ? "border-indigo-400 bg-indigo-50/30" : "border-slate-200 hover:border-indigo-400 bg-slate-50/30 hover:bg-white"
                )}
              >
                <input 
                  type="file" 
                  multiple 
                  accept=".pdf, .xlsx, .xls, .png, .jpg, .jpeg, .webp"
                  onChange={handleFileUpload} 
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                  disabled={isAnalyzing}
                />
                
                {isAnalyzing ? (
                  <div className="flex flex-col items-center gap-4 w-full px-12">
                    <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    <div className="text-sm font-bold text-indigo-700 animate-pulse">{analysisStatus}</div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className="h-full bg-indigo-600"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-14 h-14 bg-white shadow-sm border border-slate-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      <Upload size={28} />
                    </div>
                    <div className="text-sm font-black text-slate-800 group-hover:text-indigo-600 transition-colors text-center px-4">
                      {lang === 'ko' ? 'PDF/Excel/이미지를 드래그하거나 클릭' : 'Drag & drop PDF/Excel/Images or Click'}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">
                      PDF, XLSX, XLS, JPG, PNG
                    </div>
                  </>
                )}
              </div>
              
              {analysisLog.length > 0 && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  className="bg-slate-900 rounded-2xl p-4 max-h-40 overflow-y-auto custom-scrollbar"
                >
                  <div className="flex items-center gap-2 mb-2 text-indigo-400 font-mono text-[10px] font-bold uppercase tracking-widest">
                    <Database size={12} /> Analysis Logs
                  </div>
                  {analysisLog.map((log, i) => (
                    <div key={i} className="text-white font-mono text-[11px] py-1 border-b border-white/5 opacity-80 last:border-0 uppercase leading-snug">
                      {log}
                    </div>
                  ))}
                </motion.div>
              )}
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <FileText size={24} />
                </div>
                {t.pasteTitle}
              </h3>
              <p className="text-slate-400 text-xs font-medium leading-relaxed">
                {t.pasteHint}
              </p>
              
              <div className="relative group">
                <textarea 
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  placeholder="Ctrl+A → Ctrl+V"
                  className="w-full h-48 p-4 text-xs font-mono border-2 border-slate-200 rounded-2xl bg-slate-50 focus:border-emerald-500 focus:bg-white focus:outline-none resize-none transition-all"
                />
                <div className="absolute top-4 right-4 pointer-events-none opacity-20 group-focus-within:opacity-0 transition-opacity">
                   <div className="bg-slate-300 text-white text-[10px] font-bold px-2 py-1 rounded">PASTE HERE</div>
                </div>
              </div>
              
              <button 
                onClick={handlePasteAnalyze}
                disabled={!pasteValue.trim() || isAnalyzing}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                 <RotateCcw size={18} />
                 {t.analyze}
              </button>
            </div>
          </div>
        </section>

        {/* Toolbar & KPI */}
        <section className="space-y-4">
          <div className="bg-indigo-900/5 border border-indigo-100 rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <select 
              value={yearFilter} 
              onChange={e => setYearFilter(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t.allYears}</option>
              {years.map(y => <option key={y} value={y}>{y}{lang==='ko'?'년':''}</option>)}
            </select>
            <select 
              value={monthFilter} 
              onChange={e => setMonthFilter(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-sm bg-white"
            >
              <option value="">{t.allMonths}</option>
              {MONTHS.map(m => <option key={m} value={m}>{m}{lang==='ko'?'월':''}</option>)}
            </select>
            <select 
              value={metricFilter} 
              onChange={e => setMetricFilter(e.target.value as any)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-sm bg-white font-bold text-indigo-700"
            >
              <option value="amount">{t.amount}</option>
              <option value="quantity">{t.quantity}</option>
            </select>
            <button 
              onClick={() => setEditRecord({ id: crypto.randomUUID(), report: "manual", year: yearFilter || "2026", month: monthFilter || "", buyer: "", co: "", metric: "amount", value: 0, file: "manual" })}
              className="p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"
              title={t.manualAdd}
            >
              <Plus size={24} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard 
              title={t.totalAmount} 
              value={money(currentTotal.amount)} 
              delta={{ current: currentTotal.amount, previous: prevTotal.amount, isMoney: true, label: t.prevYearComp }}
              className="border-blue-100 bg-blue-50/30"
            />
            <KPICard 
              title={t.totalQty} 
              value={fmt(currentTotal.qty)} 
              delta={{ current: currentTotal.qty, previous: prevTotal.qty, label: t.prevYearComp }}
              className="border-emerald-100 bg-emerald-50/30"
            />
            <KPICard 
              title={t.topBuyer} 
              value={topBuyer.name} 
              subtitle={money(topBuyer.value)}
              className="border-amber-100 bg-amber-50/30"
            />
            <KPICard 
              title={t.dataCount} 
              value={filteredRecords.length.toLocaleString()} 
              subtitle={lang === 'ko' ? "검색 필터 결과" : "Filtered result"}
              className="border-slate-100"
            />
          </div>
        </section>

        {/* View Selection & Charts */}
        <section className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="flex border-b border-slate-100 overflow-x-auto no-scrollbar">
            {(["overview", "yearly", "monthly", "buyer", "co", "manage"] as ViewType[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-6 py-4 text-sm font-extrabold whitespace-nowrap transition-all border-b-2",
                  view === v 
                    ? "text-indigo-600 border-indigo-600 bg-indigo-50/50" 
                    : "text-slate-400 border-transparent hover:text-slate-600 hover:bg-slate-50"
                )}
              >
                {v === "overview" && t.viewOverview}
                {v === "yearly" && t.viewYearly}
                {v === "monthly" && t.viewMonthly}
                {v === "buyer" && t.viewBuyer}
                {v === "co" && t.viewCo}
                {v === "manage" && t.viewManage}
              </button>
            ))}
          </div>

          <div className="p-6 min-h-[500px]">
             {view === "overview" && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="h-[400px]">
                      <h4 className="text-sm font-extrabold text-slate-500 mb-4 px-2">연도별 / 월별 실적 추이 ({yearFilter})</h4>
                      <Bar 
                        data={monthlyChartData} 
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          onClick: (event, elements) => {
                            if (elements.length > 0) {
                              const index = elements[0].index;
                              const label = MONTHS[index];
                              setGroupModal({ field: "month", label, year: yearFilter });
                            }
                          },
                          scales: {
                            y: { title: { display: true, text: 'Amount ($)' } },
                            y1: { 
                              position: 'right' as const, 
                              grid: { drawOnChartArea: false },
                              title: { display: true, text: 'Quantity (EA)' }
                            }
                          },
                          plugins: {
                            datalabels: { display: false },
                            tooltip: {
                              callbacks: {
                                label: (item) => `${item.dataset.label}: ${item.datasetIndex === 0 ? money(item.parsed.y) : fmt(item.parsed.y)}`
                              }
                            }
                          }
                        }} 
                      />
                    </div>
                    <div className="h-[400px]">
                      <h4 className="text-sm font-extrabold text-slate-500 mb-4 px-2">C/O별 비중 ({metricFilter})</h4>
                      <div className="h-[350px] relative">
                         <Doughnut 
                          data={{
                            labels: coData.labels,
                            datasets: [{
                              data: coData.data,
                              backgroundColor: ["#1e3a8a", "#1d4ed8", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe"],
                              borderWidth: 2,
                              borderColor: '#fff'
                            }]
                          }}
                          options={{
                            onClick: (event, elements) => {
                              if (elements.length > 0) {
                                const index = elements[0].index;
                                const label = coData.labels[index];
                                setGroupModal({ field: "co", label });
                              }
                            },
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: { position: 'right' as const },
                              datalabels: {
                                color: '#fff',
                                font: { weight: 'bold', size: 10 },
                                formatter: (v, ctx) => {
                                  const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
                                  const p = (v / total * 100).toFixed(1);
                                  return Number(p) > 5 ? `${p}%` : "";
                                }
                              }
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-[400px]">
                    <h4 className="text-sm font-extrabold text-slate-500 mb-4 px-2">TOP 10 BUYER ({metricFilter})</h4>
                    <Bar 
                      data={{
                        labels: buyerData.labels,
                        datasets: [{
                          label: metricFilter,
                          data: buyerData.data,
                          backgroundColor: "#1e40af",
                          borderRadius: 8
                        }]
                      }}
                      options={{
                        onClick: (event, elements) => {
                          if (elements.length > 0) {
                            const index = elements[0].index;
                            const label = buyerData.labels[index];
                            setGroupModal({ field: "buyer", label });
                          }
                        },
                        indexAxis: 'y' as const,
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: false },
                          datalabels: { 
                            anchor: 'end' as const, 
                            align: 'right' as const,
                            formatter: (v) => metricFilter === "amount" ? money(v) : fmt(v),
                            font: { size: 10, weight: 'bold' }
                          }
                        }
                      }}
                    />
                  </div>
                </div>
             )}

             {view === "manage" && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center px-1">
                    <h4 className="font-bold text-slate-700">{lang === 'ko' ? `전체 데이터 목록 (${filteredRecords.length}건)` : `All Data List (${filteredRecords.length})`}</h4>
                    <button 
                      onClick={() => { if(confirm(t.confirmAllDelete)) saveToStorage(records.filter(r => !filteredRecords.includes(r))) }}
                      className="text-xs font-bold text-rose-600 flex items-center gap-1 hover:underline"
                    >
                      <Trash2 size={14} /> {lang === 'ko' ? '필터 결과 전체 삭제' : 'Delete filtered results'}
                    </button>
                  </div>
                  <DataTable 
                    records={filteredRecords} 
                    onEdit={(r) => setEditRecord(r)}
                    onDelete={handleDeleteRecord}
                    lang={lang}
                  />
                </div>
             )}

             {view === "yearly" && (
               <div className="space-y-6">
                 <h4 className="font-bold text-slate-700">연도별 실적 요약</h4>
                 <div className="overflow-auto max-h-[600px] rounded-xl border border-slate-200">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-50 font-bold sticky top-0 z-10 shadow-sm border-b border-slate-200">
                        <tr>
                          <th className="p-3">연도</th>
                          <th className="p-3 text-right">Quantity EA</th>
                          <th className="p-3 text-right">Amount $</th>
                          <th className="p-3 text-right">상세/삭제</th>
                        </tr>
                      </thead>
              <tbody className="divide-y divide-slate-100">
                {years.map(y => {
                  const yr = records.filter(r => r.year === y);
                  const aq = yr.filter(r => r.metric === "quantity").reduce((s, c) => s + c.value, 0);
                  const am = yr.filter(r => r.metric === "amount").reduce((s, c) => s + c.value, 0);
                  return (
                    <tr key={y}>
                      <td className="p-3 font-bold">{y}</td>
                      <td className="p-3 text-right font-mono">{fmt(aq)}</td>
                      <td className="p-3 text-right font-mono font-bold text-indigo-700">{money(am)}</td>
                      <td className="p-3 text-right space-x-2">
                        <button onClick={() => setGroupModal({ field: "year", label: y })} className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-bold">{t.edit}</button>
                        <button onClick={() => handleDeleteGroup("year", y)} className="bg-rose-50 text-rose-600 px-2 py-1 rounded font-bold">{t.delete}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
                    </table>
                 </div>
               </div>
             )}

             {view === "monthly" && (
                <div className="space-y-6">
                  <h4 className="font-bold text-slate-700">{yearFilter}년 월별 실적 추이</h4>
                  <div className="overflow-auto max-h-[600px] rounded-xl border border-slate-200">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-50 font-bold sticky top-0 z-10 shadow-sm border-b border-slate-200">
                        <tr>
                          <th className="p-3">월</th>
                          <th className="p-3 text-right">Quantity EA</th>
                          <th className="p-3 text-right">Amount $</th>
                          <th className="p-3 text-right">상세/삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {MONTHS.map(m => {
                          const mr = records.filter(r => r.year === yearFilter && r.month === m);
                          const aq = mr.filter(r => r.metric === "quantity").reduce((s, c) => s + c.value, 0);
                          const am = mr.filter(r => r.metric === "amount").reduce((s, c) => s + c.value, 0);
                          return (
                            <tr key={m}>
                              <td className="p-3 font-bold">{yearFilter}-{m}</td>
                              <td className="p-3 text-right font-mono">{fmt(aq)}</td>
                              <td className="p-3 text-right font-mono font-bold text-indigo-700">{money(am)}</td>
                              <td className="p-3 text-right space-x-2">
                                <button onClick={() => setGroupModal({ field: "month", label: m, year: yearFilter })} className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-bold">{t.edit}</button>
                                <button onClick={() => handleDeleteGroup("month", m, yearFilter)} className="bg-rose-50 text-rose-600 px-2 py-1 rounded font-bold">{t.delete}</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                 </div>
                </div>
             )}

             {view === "buyer" && (
                <div className="space-y-6">
                  <h4 className="font-bold text-slate-700">Buyer별 실적 집계 ({yearFilter})</h4>
                  <div className="overflow-auto max-h-[600px] rounded-xl border border-slate-200">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-50 font-bold sticky top-0 z-10 shadow-sm border-b border-slate-200">
                        <tr>
                          <th className="p-3">Buyer</th>
                          <th className="p-3 text-right">Quantity EA</th>
                          <th className="p-3 text-right">Amount $</th>
                          <th className="p-3 text-right">상세/삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[...new Set(filteredRecords.map(r => r.buyer))].sort().map((b: string) => {
                          const br = filteredRecords.filter(r => r.buyer === b);
                          const aq = br.filter(r => r.metric === "quantity").reduce((s, c) => s + c.value, 0);
                          const am = br.filter(r => r.metric === "amount").reduce((s, c) => s + c.value, 0);
                          return (
                            <tr key={b}>
                              <td className="p-3 font-bold">{b || "(미지정)"}</td>
                              <td className="p-3 text-right font-mono">{fmt(aq)}</td>
                              <td className="p-3 text-right font-mono font-bold text-indigo-700">{money(am)}</td>
                              <td className="p-3 text-right space-x-2">
                                <button onClick={() => setGroupModal({ field: "buyer", label: b })} className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-bold">{t.edit}</button>
                                <button onClick={() => handleDeleteGroup("buyer", b)} className="bg-rose-50 text-rose-600 px-2 py-1 rounded font-bold">{t.delete}</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                 </div>
                </div>
             )}

             {view === "co" && (
                <div className="space-y-6">
                  <h4 className="font-bold text-slate-700">C/O별 실적 집계 ({yearFilter})</h4>
                  <div className="overflow-auto max-h-[600px] rounded-xl border border-slate-200">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-slate-50 font-bold sticky top-0 z-10 shadow-sm border-b border-slate-200">
                        <tr>
                          <th className="p-3">C/O</th>
                          <th className="p-3 text-right">Quantity EA</th>
                          <th className="p-3 text-right">Amount $</th>
                          <th className="p-3 text-right">상세/삭제</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {CO_LIST.map(c => {
                          const cr = filteredRecords.filter(r => r.co === c);
                          const aq = cr.filter(r => r.metric === "quantity").reduce((s, c) => s + c.value, 0);
                          const am = cr.filter(r => r.metric === "amount").reduce((s, c) => s + c.value, 0);
                          if (!aq && !am) return null;
                          return (
                            <tr key={c}>
                              <td className="p-3 font-bold">{c}</td>
                              <td className="p-3 text-right font-mono">{fmt(aq)}</td>
                              <td className="p-3 text-right font-mono font-bold text-indigo-700">{money(am)}</td>
                              <td className="p-3 text-right space-x-2">
                                <button onClick={() => setGroupModal({ field: "co", label: c })} className="bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-bold">{t.edit}</button>
                                <button onClick={() => handleDeleteGroup("co", c)} className="bg-rose-50 text-rose-600 px-2 py-1 rounded font-bold">{t.delete}</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                 </div>
                </div>
             )}
          </div>
        </section>
      </main>

      {/* Edit Modal */}
      <AnimatePresence>
        {editRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden"
            >
              <div className="bg-slate-50 p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-black text-slate-800">데이터 편집</h3>
                <button onClick={() => setEditRecord(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X />
                </button>
              </div>
              <div className="p-8 grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Year</label>
                  <input 
                    type="text" 
                    value={editRecord.year || ""}
                    onChange={e => setEditRecord({...editRecord, year: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Month</label>
                  <select 
                    value={editRecord.month || ""}
                    onChange={e => setEditRecord({...editRecord, month: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">N/A</option>
                    {MONTHS.map(m => <option key={m} value={m}>{m}월</option>)}
                  </select>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Buyer</label>
                  <input 
                    type="text" 
                    value={editRecord.buyer || ""}
                    onChange={e => setEditRecord({...editRecord, buyer: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">C/O</label>
                  <select 
                    value={editRecord.co || ""}
                    onChange={e => setEditRecord({...editRecord, co: e.target.value})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="">N/A</option>
                    {CO_LIST.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Metric</label>
                  <select 
                    value={editRecord.metric || "amount"}
                    onChange={e => setEditRecord({...editRecord, metric: e.target.value as any})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <option value="amount">Amount ($)</option>
                    <option value="quantity">Quantity (EA)</option>
                  </select>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Value</label>
                  <input 
                    type="number" 
                    value={editRecord.value || 0}
                    onChange={e => setEditRecord({...editRecord, value: Number(e.target.value)})}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-mono font-bold text-indigo-700"
                  />
                </div>
              </div>
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setEditRecord(null)}
                  className="flex-1 bg-white border border-slate-200 text-slate-600 font-bold py-3 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  취소
                </button>
                <button 
                  onClick={handleSaveEdit}
                  className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                >
                  저장하기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {groupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="bg-slate-50 p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-black text-slate-800">
                  집계 데이터 상세 편집 · {groupModal.label}
                </h3>
                <button onClick={() => setGroupModal(null)} className="text-slate-400 hover:text-slate-600">
                  <X />
                </button>
              </div>
              
              <div className="p-6 bg-amber-50 border-b border-amber-100">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex-1">
                    <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest">집계값 보정 ({metricFilter})</div>
                    <div className="flex gap-2 mt-1">
                      <input 
                        type="number" 
                        defaultValue={currentGroupRecords.filter(r => r.metric === metricFilter).reduce((s, c) => s + c.value, 0)}
                        id="adjustGroupInput"
                        className="p-2 border border-amber-200 rounded-lg bg-white font-mono font-bold w-40"
                      />
                      <button 
                        onClick={() => {
                          const input = document.getElementById("adjustGroupInput") as HTMLInputElement;
                          handleApplyGroupAdjustment(Number(input.value));
                        }}
                        className="bg-amber-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-amber-700"
                      >
                        집계값 적용
                      </button>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDeleteGroup(groupModal.field, groupModal.label, groupModal.year)}
                    className="bg-rose-50 text-rose-600 px-4 py-2 rounded-lg font-bold text-sm border border-rose-100 hover:bg-rose-100"
                  >
                    이 실적 데이터 전체 삭제
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 min-h-0">
                <DataTable 
                  records={currentGroupRecords} 
                  onEdit={(r) => { setEditRecord(r); }}
                  onDelete={(id) => handleDeleteRecord(id)}
                  lang={lang}
                />
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                <button 
                  onClick={() => setGroupModal(null)}
                  className="bg-slate-800 text-white px-8 py-2 rounded-xl font-bold shadow-lg active:scale-95 transition-transform"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-slate-200 p-3 z-40">
        <div className="max-w-7xl mx-auto flex justify-between items-center px-4">
           <div className="text-[10px] font-bold text-slate-400">© 2026 SAE-A TRADING Co., Ltd. Order Status Integrated Dashboard Final</div>
           <div className="hidden md:block text-[10px] font-bold text-slate-300 tracking-widest uppercase">Precision Analysis Engine v2.0</div>
        </div>
      </footer>
    </div>
  );
}
