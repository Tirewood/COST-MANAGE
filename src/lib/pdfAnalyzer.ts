import * as pdfjs from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import { MONTHS, SEASONS, CO_LIST, BUYER_HINTS, OrderRecord } from '../types';
import { clean, toNum, isPct, buyerNorm } from './utils';

// Set up worker using Vite-compatible URL pattern
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
}

interface TextItem {
  str: string;
  transform: number[];
}

export async function readPdf(file: File, onProg: (prog: number) => void) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let lines: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items as TextItem[];
    
    // Build table based on coordinates
    const cells = items.map(it => ({
      text: clean(it.str),
      x: it.transform[4],
      y: it.transform[5]
    })).filter(c => c.text);

    cells.sort((a, b) => b.y - a.y || a.x - b.x);
    
    const rows: { y: number; cells: typeof cells }[] = [];
    for (const c of cells) {
      let row = rows.find(r => Math.abs(r.y - c.y) < 3.2);
      if (!row) {
        row = { y: c.y, cells: [] };
        rows.push(row);
      }
      row.cells.push(c);
    }
    
    rows.forEach(r => r.cells.sort((a, b) => a.x - b.x));
    rows.sort((a, b) => b.y - a.y);
    
    lines.push(...rows.map(r => clean(r.cells.map(c => c.text).join(" "))));
    onProg(p / pdf.numPages);
  }
  
  return { lines };
}

export async function readExcel(file: File, onProg: (prog: number) => void) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const lines: string[] = [];
  
  wb.SheetNames.forEach((name, idx) => {
    const ws = wb.Sheets[name];
    const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
    
    lines.push(`__SHEET__ ${name}`);
    for (const row of arr) {
      const cells = row.map(v => {
        if (v == null) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return clean(String(v));
      }).filter(v => v !== "");
      
      if (cells.length) {
        lines.push(clean(cells.join(" ")));
      }
    }
    onProg((idx + 1) / wb.SheetNames.length);
  });
  
  return { lines, sheets: wb.SheetNames };
}

export function isExcelFile(file: File) {
  return /\.(xls|xlsx|xlsm|xlm)$/i.test(file.name) || /excel|spreadsheet/i.test(file.type || "");
}

export function isPdfFile(file: File) {
  return /\.pdf$/i.test(file.name) || /pdf/i.test(file.type || "");
}

export function isImageFile(file: File) {
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name) || /image/i.test(file.type || "");
}

export async function readInputFile(file: File, onProg: (prog: number) => void) {
  if (isExcelFile(file)) return await readExcel(file, onProg);
  if (isPdfFile(file)) return await readPdf(file, onProg);
  if (isImageFile(file)) return { lines: [], isImage: true };
  throw new Error("Unsupported file format: " + file.name);
}

function escRe(s: string) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function looseRe(s: string) { return String(s).split("").map(ch => ch === " " ? "\\s+" : escRe(ch) + "\\s*").join(""); }

export function normalizeCopiedText(text: string) {
  let t = String(text || "").replace(/\r/g, "\n").replace(/\u00a0/g, " ").replace(/\t/g, " ");
  const rawLines = t.split(/\n+/).map(x => x.trim()).filter(Boolean);
  
  const singleCharRatio = rawLines.length ? rawLines.filter(x => x.length <= 2).length / rawLines.length : 0;
  if (singleCharRatio > 0.35) { t = rawLines.join(" "); }
  
  t = t.replace(/(?<=[\d,\.])\s+(?=[\d,\.])/g, "").replace(/(?<=[+-])\s+(?=\d)/g, "");

  const phraseMap = ["Order Status", "Quantity/Amount", "C/O /Team /Buyer /Division", "C/O / Team / Buyer / Division", "Biz.Div.", "Fab.Info.", "Printed by", "Delivery", "Season", "Buyer", "TOTAL", "G.Total"];
  for (const ph of phraseMap) {
    t = t.replace(new RegExp(looseRe(ph), "gi"), ph);
  }

  for (const c of CO_LIST) {
    t = t.replace(new RegExp("(?:^|\\s)(" + looseRe(c) + ")(?=\\s|$)", "gi"), "\n" + c + " ");
  }

  const divisions = ["Infant/Toddler", "Toddler Boys", "Toddler Girls", "Womens Plus", "Juniors", "Mens", "Missy", "Womens", "Boys", "Girls", "Kids", "Toddler", "Infant", "4-16", "4-18", "4-6X"];
  for (const b of BUYER_HINTS) {
    const normB = buyerNorm(b);
    t = t.replace(new RegExp("(?:^|\\s)(" + looseRe(b) + ")(?=\\s|$)", "gi"), "\n" + normB + " ");
  }
  
  for (const d of divisions) {
    t = t.replace(new RegExp("(?:^|\\s)(" + looseRe(d) + ")(?=\\s*[-+]?\\d|\\s*$)", "gi"), "\n" + d + " ");
  }

  t = t.replace(/\b(\d)\s+(\d)\s+(\d)\b/g, "\n$1 $2 $3 ");
  t = t.replace(/\b(20\d{2}-\d{2})/g, "\n$1").replace(/\b(20\d{2})\s+(20\d{2})/g, "\n$1 $2");
  
  for (const b of BUYER_HINTS.map(buyerNorm)) {
    t = t.replace(new RegExp("\\s+(" + escRe(b) + ")\\s+(?= [-+]?\\d|[-+]?\\d)", "g"), "\n$1 ");
  }
  for (const c of CO_LIST) {
    t = t.replace(new RegExp("\\s+(" + c + ")\\s+(?= [-+]?\\d|[-+]?\\d)", "g"), "\n$1 ");
  }

  const lines = t.split(/\n+/).map(clean).filter(Boolean).filter(x => !/^TOTAL$/i.test(x) && !/^(G\.?\s*TOTAL)$/i.test(x));
  return lines;
}

function numsFrom(s: string) {
  return (String(s || "").match(/[-+]?[\d,]+(?:\.\d+)?/g) || []).filter(x => !isPct(x) && !/^20\d{2}$/.test(clean(x))).map(toNum);
}

function totalLike(s: string) {
  return /^(TOTAL|G\.?\s*TOTAL|GRAND\s*TOTAL|SUB\s*TOTAL)$/i.test(clean(s)) || /^\(?\s*TOTAL\s*\)?$/i.test(clean(s));
}

function isMeta(s: string) {
  const v = clean(s);
  return /^(Biz\.Div|Depart|Team|Buyer|C\/O|Fab\.Info|Delivery|Order Status|Printed by|Agent|Quantity\/Amount|C\/O \/Team|C\/O \/ Team)$/i.test(v) || /^20\d{2}-\d{2}/.test(v) || totalLike(v);
}

function hasHeader(t: string, kind: string) {
  if (kind === "buyer") return /Order Status\s*\(Buyer\)|Biz\.Div\.\s*:\s*\(Buyer\)|Buyer\s+20\d{2}-01/i.test(t);
  if (kind === "coMonthly") return /Order Status\s*\(C\/O\)/i.test(t) && /20\d{2}-01/i.test(t) && !/C\/O\s*\/\s*Team/i.test(t);
  if (kind === "coAnnual") return /C\/O\s*\/\s*Team\s*\/\s*Buyer\s*\/\s*Division/i.test(t);
  if (kind === "season") return /Order Status\s*\(Season\)|Season\s+20\d{2}/i.test(t);
  return false;
}

function matchBuyer(line: string) {
  const s = clean(line);
  if (!s || totalLike(s) || s === "(" || s === ")") return null;
  
  for (const b of BUYER_HINTS) {
    if (s === b || s.startsWith(b + " ")) return { name: buyerNorm(b), rest: clean(s.slice(b.length)) };
  }

  if (!/^[+-]?[\d,]+(\.\d+)?$/.test(clean(s)) && !s.includes(":") && !s.match(/^[-+]?\d/) && !CO_LIST.includes(s) && !isMeta(s)) {
    const name = buyerNorm(s.replace(/[-+]?[\d,]+(?:\.\d+)?/g, "").replace(/[()]/g, "").trim());
    if (name && name.length > 1 && !/^\d+\s+\d+\s+\d+$/.test(name) && !/^(SPR|SUM|FALL|HOL)$/i.test(name)) return { name, rest: clean(s.replace(name, "")) };
  }
  return null;
}

function stripTrailingTotal(arr: number[]) {
  if (arr.length >= 2) {
    const body = arr.slice(0, -1);
    const sumv = body.reduce((a, b) => a + b, 0);
    const last = arr[arr.length - 1];
    if (Math.abs(sumv - last) <= Math.max(5, Math.abs(sumv) * 0.004)) return body;
  }
  return arr;
}

function splitQtyAmount(nums: number[]) {
  nums = (nums || []).filter(n => Number.isFinite(n));
  if (nums.length >= 26) return { q: nums.slice(0, 12), a: nums.slice(13, 25) };
  let best: any = null;
  for (let i = 2; i < nums.length - 1; i++) {
    const l = nums.slice(0, i), r = nums.slice(i), ls = stripTrailingTotal(l), rs = stripTrailingTotal(r);
    const score = (l.length - ls.length) + (r.length - rs.length) + (Math.min(ls.length, 12) + Math.min(rs.length, 12)) / 100;
    if ((l.length - ls.length || r.length - rs.length) && (!best || score > best.score)) best = { q: ls, a: rs, score };
  }
  if (best) return { q: best.q.slice(0, 12), a: best.a.slice(0, 12) };
  if (nums.length >= 24) return { q: nums.slice(0, 12), a: nums.slice(12, 24) };
  const half = Math.floor(nums.length / 2);
  return { q: stripTrailingTotal(nums.slice(0, half)).slice(0, 12), a: stripTrailingTotal(nums.slice(half)).slice(0, 12) };
}

function monthlyRows(label: string, q: number[], a: number[], report: string, year: string, file: string): Partial<OrderRecord>[] {
  const rows: Partial<OrderRecord>[] = [];
  if (!label || totalLike(label)) return rows;
  const qt = q.slice(0, 12);
  const am = a.slice(0, 12);
  
  MONTHS.forEach((m, i) => {
    if (qt[i]) rows.push({ report: report as any, year, month: m, buyer: report === "monthlyBuyer" ? label : "", co: report === "monthlyCO" ? label : "", metric: "quantity", value: qt[i], file });
    if (am[i]) rows.push({ report: report as any, year, month: m, buyer: report === "monthlyBuyer" ? label : "", co: report === "monthlyCO" ? label : "", metric: "amount", value: am[i], file });
  });
  return rows;
}

function parseMonthlyFlat(text: string, report: string, year: string, file: string) {
  const rows: Partial<OrderRecord>[] = [];
  const labels = report === "monthlyCO" ? CO_LIST : [...new Set(BUYER_HINTS.map(buyerNorm))];
  const hits: { label: string; start: number; end: number }[] = [];
  
  for (const lab of labels) {
    let re = new RegExp("(?:^|\\s)(" + escRe(lab) + ")(?=\\s+[-+]?\\d|\\s*$)", "g"), m;
    while ((m = re.exec(text))) {
      hits.push({ label: lab, start: m.index + (m[0].startsWith(" ") ? 1 : 0), end: re.lastIndex });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i], seg = text.slice(h.end, hits[i + 1]?.start || text.length), nums = numsFrom(seg);
    if (nums.length >= 4) {
      const sp = splitQtyAmount(nums);
      rows.push(...monthlyRows(h.label, sp.q, sp.a, report, year, file));
    }
  }
  return rows;
}

function parseMonthly(lines: string[], report: string, file: string) {
  const t = lines.join(" ");
  const year = (t.match(/20\d{2}-01/) || [String(new Date().getFullYear()) + "-01"])[0].slice(0, 4);
  const rows: Partial<OrderRecord>[] = [];
  let label = "";
  let numRows: number[][] = [];
  
  function flush() {
    if (label && numRows.length >= 2) {
      const r1 = stripTrailingTotal(numRows[0]);
      const r2 = stripTrailingTotal(numRows[1]);
      rows.push(...monthlyRows(label, r1, r2, report, year, file));
    }
    label = "";
    numRows = [];
  }
  
  for (let s of lines) {
    s = clean(s);
    if (!s || isMeta(s) || /^\(?\s*\)?$/.test(s)) continue;
    const first = s.split(/\s+/)[0];
    
    if (report === "monthlyCO" && CO_LIST.includes(first)) {
      flush();
      label = first;
      const ns = numsFrom(s.replace(first, ""));
      if (ns.length) numRows.push(ns);
      continue;
    }
    
    if (report === "monthlyBuyer") {
      const b = matchBuyer(s);
      if (b) {
        flush();
        label = b.name;
        const ns = numsFrom(b.rest);
        if (ns.length) numRows.push(ns);
        continue;
      }
    }
    
    const ns = numsFrom(s);
    if (label && ns.length && numRows.length < 2) {
      numRows.push(ns);
      if (numRows.length === 2) flush();
    }
  }
  flush();

  const flat = parseMonthlyFlat(t, report, year, file);
  return [...rows, ...flat];
}

function parseAnnual(lines: string[], file: string) {
  const all = lines.join(" ");
  const years = [...new Set([...all.matchAll(/\b(20\d{2})\b/g)].map(m => m[1]))].filter(y => +y >= 2020 && +y <= 2035).slice(0, 3);
  const rows: Partial<OrderRecord>[] = [];
  let co = "";
  let buyer = "";
  const divs = new Set(["4-16", "4-18", "4-6X", "4-6x", "Boys", "Girls", "Infant", "Infant/Toddler", "Juniors", "Kids", "Mens", "Missy", "Toddler", "Toddler Boys", "Toddler Girls", "Womens", "Womens Plus"]);
  const isTeam = (s: string) => /^\d+\s+\d+\s+\d+$/.test(s) || /^\d+\s*담당\d+\s*본부\d+\s*팀$/.test(s);
  
  function collect(startIdx: number) {
    const data: number[] = [];
    let j = startIdx;
    while (j < lines.length && data.length < years.length * 2) {
      const sj = clean(lines[j]);
      if (j > startIdx && (CO_LIST.includes(sj) || isTeam(sj) || divs.has(sj) || matchBuyer(sj) || totalLike(sj) || sj === "(" || sj === ")")) break;
      numsFrom(sj).forEach(n => data.push(n));
      j++;
    }
    return { data, nextIdx: j };
  }

  for (let i = 0; i < lines.length; i++) {
    const s = clean(lines[i]);
    if (!s || isMeta(s) || s === "(" || s === ")" || totalLike(s)) continue;
    if (CO_LIST.includes(s)) {
      co = s;
      buyer = "";
      continue;
    }
    if (isTeam(s)) continue;
    if (divs.has(s)) {
      const { data, nextIdx } = collect(i + 1);
      if (co && buyer && data.length >= years.length * 2) {
        years.forEach((y, idx) => {
          const q = data[idx] || 0;
          const a = data[idx + years.length] || 0;
          if (q) rows.push({ report: "annualCOBuyer", year: y, month: "", buyer, co, metric: "quantity", value: q, file });
          if (a) rows.push({ report: "annualCOBuyer", year: y, month: "", buyer, co, metric: "amount", value: a, file });
        });
        i = nextIdx - 1;
      }
      continue;
    }
    const b = matchBuyer(s);
    if (b) buyer = b.name;
  }
  return rows.filter(r => r.value && r.value > 0);
}

function parseSeason(lines: string[], file: string) {
  const all = lines.join(" ");
  const years = [...new Set([...all.matchAll(/\b(20\d{2})\b/g)].map(m => m[1]))].filter(y => +y >= 2020 && +y <= 2035).slice(0, 2);
  const rows: Partial<OrderRecord>[] = [];
  const isTeam = (s: string) => /^\d+\s+\d+\s+\d+$/.test(s) || /^\d+\s*담당\d+\s*본부\d+\s*팀$/.test(s);
  
  function collect(startIdx: number) {
    const data: number[] = [];
    let j = startIdx;
    while (j < lines.length && data.length < years.length * 10) {
      const sj = clean(lines[j]);
      if (j > startIdx && !/^[+-]?[\d,]+(\.\d+)?$/.test(sj) && !sj.match(/^[\d,]+(\s+[\d,]+)+$/)) break;
      numsFrom(sj).forEach(n => data.push(n));
      j++;
    }
    return { data, nextIdx: j };
  }

  for (let i = 0; i < lines.length; i++) {
    const s = clean(lines[i]);
    if (!s || isMeta(s) || totalLike(s) || isTeam(s) || /^[+-]?[\d,]+(\.\d+)?$/.test(s) || /^20\d/.test(s)) continue;
    const b = matchBuyer(s);
    if (!b) continue;
    
    const { data, nextIdx } = collect(i + 1);
    if (data.length >= 4) {
      years.forEach((y, yi) => SEASONS.forEach((season, si) => {
        const qi = yi * 5 + si;
        const ai = years.length * 5 + yi * 5 + si;
        if (data[qi]) rows.push({ report: "season", year: y, month: "", buyer: b.name, co: "", metric: "quantity", value: data[qi], file });
        if (data[ai]) rows.push({ report: "season", year: y, month: "", buyer: b.name, co: "", metric: "amount", value: data[ai], file });
      }));
      i = nextIdx - 1;
    }
  }
  return rows.filter(r => r.value && r.value > 0);
}

export function parseAllLines(lines: string[], file: string) {
  const t = lines.join("\n");
  if (hasHeader(t, "coAnnual")) return parseAnnual(lines, file);
  if (hasHeader(t, "coMonthly")) return parseMonthly(lines, "monthlyCO", file);
  if (hasHeader(t, "buyer")) return parseMonthly(lines, "monthlyBuyer", file);
  if (hasHeader(t, "season")) return parseSeason(lines, file);
  
  return [
    ...parseMonthly(lines, "monthlyBuyer", file),
    ...parseMonthly(lines, "monthlyCO", file),
    ...parseAnnual(lines, file),
    ...parseSeason(lines, file)
  ];
}
