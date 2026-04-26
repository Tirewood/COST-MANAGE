
export interface OrderRecord {
  id: string;
  report: "monthlyBuyer" | "monthlyCO" | "annualCOBuyer" | "season" | "manual";
  year: string;
  month: string; // "01" to "12" or ""
  buyer: string;
  co: string;
  metric: "amount" | "quantity";
  value: number;
  file: string;
  createdAt: string;
  updatedAt: string;
}

export type ViewType = "overview" | "yearly" | "monthly" | "buyer" | "co" | "manage";
export type Language = "ko" | "en" | "vi";

export const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
export const SEASONS = ["SPR", "SUM", "FALL", "HOL"];
export const CO_LIST = ["BGD", "GTM", "HTI", "IDN", "NIC", "SLV", "VTN"];
export const BUYER_HINTS = [
  "Outerstuff(Gap Inc.)", "Polo Ralph Lauren", "Disney Theme Park", "Academy Sports", "Pair of Thieves",
  "Marks&Spencer", "Lucky Opco LLC", "Banana Republic", "Banana Repub", "BEYOND YOGA", "Wal-Mart Mexico",
  "Gear for Sports", "Academy SP.", "Aeropostale", "Ann Taylor", "Brooks Bro.", "Gear for Spo", "KINDTHREAD",
  "PDS(HBI)", "UNTUCKIT", "Carhartt", "Nautica", "Old Navy", "Carters", "JD Link", "Walmart", "Target",
  "Macy's", "Macy`s", "Macys", "Mango", "Kohl's", "Kohls", "Dick's", "Dick`S", "DAISO", "Gap", "HBI", "A&F", "Aeo", "Zara", "Polo",
  "Sam's Club", "Sams Club", "Costco", "Express", "Victoria's Secret", "Pink", "Under Armour", "Nike", "Adidas", "Hanes", "Fruit of the Loom"
].sort((a, b) => b.length - a.length);
