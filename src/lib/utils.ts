import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const clean = (s: string) => String(s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
export const isNum = (s: string) => /^[-+]?[\d,]+(\.\d+)?$/.test(clean(s));
export const toNum = (s: string) => Number(clean(s).replace(/[,+\s]/g, "")) || 0;
export const isPct = (s: string) => /^[+-]\d+(\.\d+)?$/.test(clean(s));
export const fmt = (n: number) => (Number(n) || 0).toLocaleString();
export const money = (n: number) => "$" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
export const pct = (c: number, p: number) => (p ? ((c - p) / p) * 100 : c ? 100 : 0);

export const buyerNorm = (s: string) =>
  clean(s)
    .replace(/^Academy SP\.?$/i, "Academy Sports")
    .replace(/^Banana Repub$/i, "Banana Republic")
    .replace(/^Kohls$/i, "Kohl's")
    .replace(/^Macys|Macy`s$/i, "Macy's")
    .replace(/^Dick`S$/i, "Dick's")
    .replace(/^Polo$/i, "Polo Ralph Lauren")
    .replace(/\s+\d[\d,.\s+-]*$/, " ")
    .trim();
