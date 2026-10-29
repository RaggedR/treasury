// types.ts — the whole ledger, as plain data.
//
// The state here is a chart of accounts — a TREE of accounts, each holding a running
// debit and credit total — plus the append-only facts needed to refuse illegal moves
// (which postings have been reversed, whether the period is closed). Nothing here is a
// class with behaviour; the behaviour lives in ledger.ts (the reducers and the roll-up
// fold) and gates.ts (the smart constructors). Keeping the state as data is what lets
// us serialise it to one JSON file and replay it to the same bytes.
//
// Money is INTEGER MINOR UNITS (cents), never a float. Floating point would make sums
// non-associative and break the byte-identical replay the Definition of Done needs —
// and double-entry is exact arithmetic by its nature, so cents are the honest model.

export type Money = number; // integer minor units (cents). Never a float.

/** The five account classes. Each has a NORMAL SIDE: the side on which a positive
 *  balance sits. Assets and expenses are debit-normal (what the firm holds and
 *  spends); liabilities, equity and income are credit-normal (what the firm owes,
 *  owns, and earns). The clerks' permissions are scoped by this class (gates.ts). */
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type NormalSide = "debit" | "credit";

/** The normal side of each class — the side a positive balance of that class sits on. */
export function normalSide(type: AccountType): NormalSide {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

/** One account in the chart. `parent` is the account it rolls up into (null for a
 *  top-level category). The tree is what the roll-up fold in ledger.ts walks — a
 *  parent's balance is the sum of its subtree, which is the point of the showpiece. */
export type Account = {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly parent: string | null;
};

/** An account's accumulated totals. The NET is debit - credit; a positive net is a
 *  debit balance, a negative net a credit balance. The double-entry invariant (over
 *  the whole ledger, Σ net = 0) is NOT encoded in this type — it is enforced by the
 *  gate in gates.ts, which is the point: a type can hold an unbalanced ledger, a
 *  smart constructor cannot build one. */
export type Balance = {
  readonly debit: Money;
  readonly credit: Money;
};

/** The whole set of books. `accounts` is the chart (a tree by `parent`); `balances`
 *  is each account's running totals; `reversed` is the correlation ids of postings
 *  already reversed (so reverseGate refuses a double-reversal); `closed` names the
 *  periods already closed. Ledgers are keyed nowhere special — a GROUP of books
 *  (consolidation, M5) is just several of these, each existentially hidden behind one
 *  consolidated balance one level up. */
export type Ledger = {
  readonly accounts: Record<string, Account>;
  readonly balances: Record<string, Balance>;
  readonly reversed: readonly string[];
  readonly closed: readonly string[];
};

// ── A posting leg, and the trial-balance view ─────────────────────────
/** One leg of a posting: an amount against an account. Amounts are positive; which
 *  side (debit or credit) is decided by which list the leg sits in on the Effect. */
export type Leg = {
  readonly account: string;
  readonly amount: Money;
};

/** One row of a trial balance: an account and its balance on its normal side. */
export type TrialRow = {
  readonly account: string;
  readonly name: string;
  readonly type: AccountType;
  readonly debit: Money; // the balance, shown as a debit if debit-normal and positive
  readonly credit: Money; // ... or as a credit otherwise
};

export type TrialBalance = {
  readonly rows: readonly TrialRow[];
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  readonly balanced: boolean; // totalDebit === totalCredit — the books close
};
