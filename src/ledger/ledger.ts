// ledger.ts — the deterministic ledger: the reducers, and the roll-up fold.
//
// Everything here is a pure total function of (ledger, args). No randomness, no clock,
// no I/O. That is what "replays to the same balances every time" rests on. In worker
// terms (MacBeth Note 5) applyEffect IS bwdS — the writeback of a new state from a
// committed position. The gates (gates.ts) decide WHICH effects are legal; this file
// only applies ones already found legal.
//
// The fold (rollup) is the half of the framework the treasury exists to make honest:
// a parent account's balance is the SUM of its subtree. Amalgamation here is real
// algebra — debits and credits form a group, balances add — not a gather into a list.

import type {
  Account,
  Balance,
  Leg,
  Ledger,
  Money,
  TrialBalance,
  TrialRow,
} from "./types.ts";
import { normalSide } from "./types.ts";

/** A reference error (bad account id) — distinct from a gate refusal. The CLI maps
 *  both to exit 1, but they are different failures: this is "you named an account
 *  that does not exist", a refusal is "that posting does not balance". */
export class RefError extends Error {}

// ── Committed effects (produced by gates.ts, applied here) ────────────
export type Effect =
  // A balanced posting: debit legs and credit legs whose sums are equal (the gate
  // guarantees it). `reverses` marks this posting as the reversal of another, so the
  // reducer can record that the target may not be reversed again.
  | {
    readonly tag: "post";
    readonly debits: readonly Leg[];
    readonly credits: readonly Leg[];
    readonly reverses?: string;
  }
  // Add an account to the chart.
  | { readonly tag: "open"; readonly account: Account }
  // Close a period: a closing posting (income/expense rolled into equity) plus the
  // period name to mark closed.
  | {
    readonly tag: "close";
    readonly period: string;
    readonly debits: readonly Leg[];
    readonly credits: readonly Leg[];
  };

const ZERO: Balance = { debit: 0, credit: 0 };

function bumpDebit(bal: Balance, amount: Money): Balance {
  return { debit: bal.debit + amount, credit: bal.credit };
}
function bumpCredit(bal: Balance, amount: Money): Balance {
  return { debit: bal.debit, credit: bal.credit + amount };
}

/** Apply committed legs to the running balances. Pure: returns new balances. */
function applyLegs(
  balances: Record<string, Balance>,
  debits: readonly Leg[],
  credits: readonly Leg[],
): Record<string, Balance> {
  const next = { ...balances };
  for (const leg of debits) {
    next[leg.account] = bumpDebit(next[leg.account] ?? ZERO, leg.amount);
  }
  for (const leg of credits) {
    next[leg.account] = bumpCredit(next[leg.account] ?? ZERO, leg.amount);
  }
  return next;
}

/** Apply a committed effect. Pure: returns a new Ledger, never mutates the old. */
export function applyEffect(ledger: Ledger, effect: Effect): Ledger {
  switch (effect.tag) {
    case "post": {
      const balances = applyLegs(ledger.balances, effect.debits, effect.credits);
      const reversed = effect.reverses
        ? [...ledger.reversed, effect.reverses]
        : ledger.reversed;
      return { ...ledger, balances, reversed };
    }
    case "open": {
      const a = effect.account;
      return {
        ...ledger,
        accounts: { ...ledger.accounts, [a.id]: a },
        balances: { ...ledger.balances, [a.id]: ledger.balances[a.id] ?? ZERO },
      };
    }
    case "close": {
      const balances = applyLegs(ledger.balances, effect.debits, effect.credits);
      return { ...ledger, balances, closed: [...ledger.closed, effect.period] };
    }
  }
}

// ── Reads: the net, the roll-up fold, and the trial balance ───────────
export function getAccount(ledger: Ledger, id: string): Account {
  const a = ledger.accounts[id];
  if (!a) throw new RefError(`no such account: ${id}`);
  return a;
}

/** An account's OWN net, ignoring children: debit total minus credit total. A
 *  positive net is a debit balance, a negative net a credit balance. */
export function accountNet(ledger: Ledger, id: string): Money {
  const b = ledger.balances[id] ?? ZERO;
  return b.debit - b.credit;
}

/** The direct children of an account in the chart tree. */
export function childrenOf(ledger: Ledger, id: string): readonly Account[] {
  return Object.values(ledger.accounts).filter((a) => a.parent === id);
}

/** THE FOLD. An account's balance is its own net PLUS the roll-up of every child's
 *  balance, recursively over the chart tree. This is the "data flows up and composes"
 *  half of the framework made exact: a category account like `assets` holds no
 *  postings of its own, so its balance EXISTS ONLY as the sum of `cash`, `ar`, … —
 *  the amalgamation is genuine addition, not a gather. (~/git/gold/org-chart's
 *  semilattice roll-up, made exact by double-entry.) */
export function rollup(ledger: Ledger, id: string): Money {
  const own = accountNet(ledger, id);
  return childrenOf(ledger, id).reduce((sum, c) => sum + rollup(ledger, c.id), own);
}

/** The balance of an account, folded over its subtree and presented on its normal
 *  side: a debit-normal account reports its net directly; a credit-normal account
 *  reports the negated net, so a healthy balance of either class reads as positive. */
export function balance(ledger: Ledger, id: string): { net: Money; display: Money } {
  const net = rollup(ledger, id);
  const side = normalSide(getAccount(ledger, id).type);
  return { net, display: side === "debit" ? net : -net };
}

/** The trial balance: every LEAF account's net, placed on its debit or credit side,
 *  with the two column totals. Because every posting is balanced (Σ of all legs' debit
 *  = Σ credit), the totals must be equal — so `balanced` proving true is the
 *  demonstration that the invariant held across the whole run. Leaf accounts only,
 *  because rolling up parents too would double-count the subtree. */
export function trialBalance(ledger: Ledger): TrialBalance {
  const leaves = Object.values(ledger.accounts)
    .filter((a) => childrenOf(ledger, a.id).length === 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const rows: TrialRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const a of leaves) {
    const net = accountNet(ledger, a.id);
    if (net === 0) continue; // an account with no balance is not a trial-balance row
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    totalDebit += debit;
    totalCredit += credit;
    rows.push({ account: a.id, name: a.name, type: a.type, debit, credit });
  }
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}
