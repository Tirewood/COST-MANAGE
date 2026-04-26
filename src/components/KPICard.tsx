import React from "react";
import { cn, money, fmt, pct } from "../lib/utils";

interface KPICardProps {
  title: string;
  value: string | number;
  delta?: {
    current: number;
    previous: number;
    isMoney?: boolean;
    label?: string;
  };
  subtitle?: string;
  className?: string;
}

export function KPICard({ title, value, delta, subtitle, className }: KPICardProps) {
  let deltaValue = 0;
  let deltaPct = 0;
  if (delta) {
    deltaValue = delta.current - delta.previous;
    deltaPct = pct(delta.current, delta.previous);
  }

  return (
    <div className={cn("bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow", className)}>
      <div className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">{title}</div>
      <div className="text-2xl font-black mt-2 text-slate-900">{value}</div>
      {delta && (
        <div className="mt-2 text-xs flex items-center gap-1">
          <span className="text-slate-400 font-medium">{delta.label}:</span>
          <span className={cn("font-bold", deltaValue >= 0 ? "text-emerald-600" : "text-rose-600")}>
            {delta.isMoney ? money(deltaValue) : fmt(deltaValue)} / {deltaPct.toFixed(1)}%
          </span>
        </div>
      )}
      {subtitle && <div className="mt-2 text-xs text-slate-400 font-medium">{subtitle}</div>}
    </div>
  );
}
