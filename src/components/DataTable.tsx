import React from "react";
import { OrderRecord } from "../types";
import { fmt, money } from "../lib/utils";
import { i18n } from "../i18n";

interface DataTableProps {
  records: OrderRecord[];
  onEdit: (record: OrderRecord) => void;
  onDelete: (id: string) => void;
  lang: string;
}

export function DataTable({ records, onEdit, onDelete, lang }: DataTableProps) {
  const t = (i18n as any)[lang] || i18n.ko;

  return (
    <div className="overflow-x-auto overflow-y-auto max-h-[500px] rounded-xl border border-slate-200 shadow-sm relative">
      <table className="w-full text-left text-xs bg-white border-collapse">
        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
          <tr>
            <th className="p-3 font-bold border-b border-slate-200">{t.year}</th>
            <th className="p-3 font-bold border-b border-slate-200">{t.month}</th>
            <th className="p-3 font-bold border-b border-slate-200">{t.buyer}</th>
            <th className="p-3 font-bold border-b border-slate-200">{t.co}</th>
            <th className="p-3 font-bold border-b border-slate-200">{t.metric}</th>
            <th className="p-3 font-bold border-b border-slate-200 text-right">{t.value}</th>
            <th className="p-3 font-bold border-b border-slate-200 text-right">{t.actions}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {records.length === 0 ? (
            <tr>
              <td colSpan={7} className="p-10 text-center text-slate-400 italic">{t.noData}</td>
            </tr>
          ) : (
            records.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-3 font-medium">{r.year}</td>
                <td className="p-3">{r.month}</td>
                <td className="p-3 font-semibold text-slate-700">{r.buyer || "-"}</td>
                <td className="p-3 uppercase">{r.co || "-"}</td>
                <td className="p-3 uppercase text-slate-500">{r.metric === 'amount' ? t.amount : t.quantity}</td>
                <td className="p-3 text-right font-mono font-bold">
                  {r.metric === "amount" ? money(r.value) : fmt(r.value)}
                </td>
                <td className="p-3 text-right space-x-2">
                  <button 
                    onClick={() => onEdit(r)}
                    className="p-1 px-2 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold transition-colors"
                  >
                    {t.edit}
                  </button>
                  <button 
                    onClick={() => onDelete(r.id)}
                    className="p-1 px-2 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold transition-colors"
                  >
                    {t.delete}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
