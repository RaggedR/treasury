// format.ts — render a command's result as json or a table, and the trial balance.
//
// JSON is the machine-readable default (what the clerks' harnesses parse); table is
// for a human at the terminal. The printed trial balance is treasury's equivalent of
// starship's star map: the one visible artefact a stranger reads to SEE the books
// close (PLAN §8).

import type { TrialBalance } from "../ledger/types.ts";

export type Format = "json" | "table";

export function render(value: unknown, format: Format): string {
  if (format === "json") return JSON.stringify(value, null, 2);
  return asTable(value);
}

/** A deliberately small human renderer: arrays of flat objects become a column
 *  table; a single object becomes aligned key: value lines; primitives print as-is. */
function asTable(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    if (typeof value[0] === "object" && value[0] !== null) {
      const rows = value as Record<string, unknown>[];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const widths = cols.map((c) =>
        Math.max(c.length, ...rows.map((r) => fmtCell(r[c]).length))
      );
      const line = (cells: string[]) =>
        cells.map((c, i) => c.padEnd(widths[i])).join("  ");
      const header = line(cols);
      const sep = widths.map((w) => "-".repeat(w)).join("  ");
      const body = rows.map((r) => line(cols.map((c) => fmtCell(r[c]))));
      return [header, sep, ...body].join("\n");
    }
    return value.map((v) => fmtCell(v)).join("\n");
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const w = Math.max(...keys.map((k) => k.length));
    return keys.map((k) => `${k.padEnd(w)} : ${fmtCell(obj[k])}`).join("\n");
  }
  return fmtCell(value);
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── Money and the trial balance ───────────────────────────────────────
/** Integer cents as a right-aligned dollar string, e.g. 123456 -> "$1,234.56". */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const n = Math.abs(cents);
  const whole = String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(n % 100).padStart(2, "0")}`;
}

/** The trial balance as a printed two-column ledger a stranger can read — account,
 *  debit, credit — with the totals ruled off and a line stating whether the books
 *  close. Deterministic: same ledger => same text. */
export function trialBalanceView(tb: TrialBalance): string {
  const nameW = Math.max(7, ...tb.rows.map((r) => r.name.length));
  const colW = 14;
  const head = "Account".padEnd(nameW) + "  " +
    "Debit".padStart(colW) + "  " + "Credit".padStart(colW);
  const sep = "-".repeat(nameW) + "  " + "-".repeat(colW) + "  " + "-".repeat(colW);
  const body = tb.rows.map((r) =>
    r.name.padEnd(nameW) + "  " +
    (r.debit ? money(r.debit) : "").padStart(colW) + "  " +
    (r.credit ? money(r.credit) : "").padStart(colW)
  );
  const totals = "TOTAL".padEnd(nameW) + "  " +
    money(tb.totalDebit).padStart(colW) + "  " + money(tb.totalCredit).padStart(colW);
  const verdict = tb.balanced
    ? "the books balance (debits = credits)"
    : "OUT OF BALANCE — debits ≠ credits";
  return [head, sep, ...body, sep, totals, "", verdict].join("\n");
}
