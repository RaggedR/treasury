// seed.ts — the starting books for the demo, straight from english.txt.
//
// A toy chart of accounts as a TREE: five top-level category accounts (assets,
// liabilities, equity, income, expenses) each with leaf accounts underneath. The
// categories hold no postings of their own — their balances exist only as the roll-up
// of their children, which is exactly what makes the fold (ledger.ts `rollup`) do real
// work rather than read a stored number.
//
// One opening entry seeds capital so the books are non-empty and already balance:
// $1,000 of cash against $1,000 of retained earnings. Everything is integer cents.

import type { Account, Balance, Ledger } from "./types.ts";

const CENTS = (dollars: number): number => Math.round(dollars * 100);

/** The chart of accounts: categories first, then the leaves that roll up into them. */
function chart(): Record<string, Account> {
  const accounts: Account[] = [
    // top-level categories (parents) — balances are pure roll-ups of their subtrees
    { id: "assets", name: "Assets", type: "asset", parent: null },
    { id: "liabilities", name: "Liabilities", type: "liability", parent: null },
    { id: "equity", name: "Equity", type: "equity", parent: null },
    { id: "income", name: "Income", type: "income", parent: null },
    { id: "expenses", name: "Expenses", type: "expense", parent: null },
    // leaves — where the postings actually land
    { id: "cash", name: "Cash", type: "asset", parent: "assets" },
    { id: "ar", name: "Accounts Receivable", type: "asset", parent: "assets" },
    { id: "ap", name: "Accounts Payable", type: "liability", parent: "liabilities" },
    { id: "retained-earnings", name: "Retained Earnings", type: "equity", parent: "equity" },
    { id: "sales", name: "Sales", type: "income", parent: "income" },
    { id: "wages", name: "Wages", type: "expense", parent: "expenses" },
  ];
  return Object.fromEntries(accounts.map((a) => [a.id, a]));
}

/** The seeded ledger: the chart, with one opening capital entry already posted. */
export function seedLedger(): Ledger {
  const accounts = chart();
  const balances: Record<string, Balance> = {};
  for (const id of Object.keys(accounts)) balances[id] = { debit: 0, credit: 0 };
  // Opening capital: debit cash, credit retained earnings — a balanced entry.
  balances["cash"] = { debit: CENTS(1000), credit: 0 };
  balances["retained-earnings"] = { debit: 0, credit: CENTS(1000) };
  return { accounts, balances, reversed: [], closed: [] };
}

/** A group of two entities, for the consolidation (M5) demo: a parent and a
 *  subsidiary, each a full ledger. The parent sees only the subsidiary's ONE
 *  consolidated balance come back up, never its individual accounts. */
export function seedGroup(): Record<string, Ledger> {
  const parent = seedLedger();
  const sub = seedLedger();
  return { PARENT: parent, SUB: sub };
}
