// gates.ts — the smart constructors. This file is the point of the whole showpiece.
//
// MacBeth Note 5 §5: "the gate is a smart constructor ... a denied command and a
// broken tool look the same from inside." Each gate takes the ledger and a raw request
// and returns either an Ok carrying a legal Effect, or a Refused carrying a reason. The
// caller cannot tell a Refused from a broken tool — both are ordinary positions. An
// Effect, once returned, is guaranteed legal: ledger.ts can apply it without
// re-checking. That is the smart-constructor contract — you cannot hold an illegal
// Effect, because the only way to make one is through a gate.
//
// The headline gate is postGate's DOUBLE-ENTRY invariant: debits must equal credits.
// An unbalanced posting is not an error to be corrected later — it is simply not a
// legal thing to do, so it never becomes an Effect at all.

import type { Account, AccountType, Leg, Ledger, Money } from "./types.ts";
import { accountNet, type Effect, getAccount } from "./ledger.ts";

export type GateResult =
  | { readonly ok: true; readonly effect: Effect }
  | { readonly ok: false; readonly reason: string };

const ok = (effect: Effect): GateResult => ({ ok: true, effect });
const refused = (reason: string): GateResult => ({ ok: false, reason });

const sum = (legs: readonly Leg[]): Money => legs.reduce((s, l) => s + l.amount, 0);

/** Render integer cents as dollars for a refusal message. */
function dollars(cents: Money): string {
  const sign = cents < 0 ? "-" : "";
  const n = Math.abs(cents);
  return `${sign}$${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}

// ── post ──────────────────────────────────────────────────────────────
/** The double-entry gate. Refuses unless every account exists, every amount is a
 *  positive integer, and — the iron rule — the debits equal the credits. A posting
 *  that does not balance never commits; from the caller it is indistinguishable from a
 *  broken tool (MacBeth §5). An optional overdraw floor refuses crediting an asset
 *  account below zero (you cannot pay out cash you do not hold). */
export function postGate(
  ledger: Ledger,
  debits: readonly Leg[],
  credits: readonly Leg[],
  reverses?: string,
): GateResult {
  if (debits.length === 0 || credits.length === 0) {
    return refused("a posting needs at least one debit and one credit leg");
  }
  for (const leg of [...debits, ...credits]) {
    if (!ledger.accounts[leg.account]) {
      return refused(`no such account: ${leg.account}`);
    }
    if (!Number.isInteger(leg.amount) || leg.amount <= 0) {
      return refused(`amount on ${leg.account} must be a positive number`);
    }
  }
  const dr = sum(debits);
  const cr = sum(credits);
  if (dr !== cr) {
    // The demonstration refusal: the books do not balance.
    return refused(`posting does not balance: debits ${dollars(dr)} ≠ credits ${dollars(cr)}`);
  }
  // Overdraw floor: no asset account may be credited below a zero balance.
  for (const leg of credits) {
    const acct = ledger.accounts[leg.account];
    if (acct.type === "asset" && accountNet(ledger, leg.account) - leg.amount < 0) {
      return refused(
        `overdraw: ${leg.account} would fall to ${
          dollars(accountNet(ledger, leg.account) - leg.amount)
        } (floor $0.00)`,
      );
    }
  }
  return ok({ tag: "post", debits, credits, ...(reverses ? { reverses } : {}) });
}

// ── open ──────────────────────────────────────────────────────────────
/** Add an account to the chart. Refuses a duplicate id and a missing parent; the
 *  parent, if given, must already exist so the tree stays connected. */
export function openGate(
  ledger: Ledger,
  id: string,
  name: string,
  type: AccountType,
  parent: string | null,
): GateResult {
  if (ledger.accounts[id]) return refused(`account already exists: ${id}`);
  if (!id || !name) return refused("open needs a non-empty id and name");
  if (parent !== null && !ledger.accounts[parent]) {
    return refused(`no such parent account: ${parent}`);
  }
  const account: Account = { id, name, type, parent };
  return ok({ tag: "open", account });
}

// ── reverse ───────────────────────────────────────────────────────────
/** Post the reversing entry for an earlier posting: the same legs with debits and
 *  credits swapped. Refuses if the target does not exist, has already been reversed,
 *  or is not an ordinary posting. The original is NEVER erased — the mistake and its
 *  correction both stay on the record, which is why the journal is append-only. */
export function reverseGate(
  ledger: Ledger,
  targetCorr: string,
  original: Effect | null,
): GateResult {
  if (!original) return refused(`no such journal entry to reverse: ${targetCorr}`);
  if (ledger.reversed.includes(targetCorr)) {
    return refused(`entry ${targetCorr} has already been reversed`);
  }
  if (original.tag !== "post") {
    return refused(`entry ${targetCorr} is a ${original.tag}, not a reversible posting`);
  }
  // Swap the legs: the reversal debits what the original credited, and vice versa.
  return ok({
    tag: "post",
    debits: original.credits,
    credits: original.debits,
    reverses: targetCorr,
  });
}

// ── close ─────────────────────────────────────────────────────────────
/** Close a period: roll every income and expense account into equity and mark the
 *  period closed. Refuses if the period is already closed, if there is no single
 *  equity account to close into, or if the resulting closing posting would not balance
 *  (it always does by construction — the check is the belt-and-braces of the whole
 *  design). Income (credit balance) is debited to zero and credited to equity; expense
 *  (debit balance) is credited to zero and debited from equity; the net is the
 *  period's profit, carried to retained earnings. */
export function closeGate(ledger: Ledger, period: string): GateResult {
  if (ledger.closed.includes(period)) {
    return refused(`period already closed: ${period}`);
  }
  const equityLeaves = Object.values(ledger.accounts).filter(
    (a) => a.type === "equity" && !Object.values(ledger.accounts).some((c) => c.parent === a.id),
  );
  if (equityLeaves.length !== 1) {
    return refused(
      `close needs exactly one equity account to close into, found ${equityLeaves.length}`,
    );
  }
  const retained = equityLeaves[0].id;

  const debits: Leg[] = [];
  const credits: Leg[] = [];
  let incomeTotal = 0; // Σ credit balances of income accounts
  let expenseTotal = 0; // Σ debit balances of expense accounts

  for (const a of Object.values(ledger.accounts)) {
    const net = accountNet(ledger, a.id);
    if (a.type === "income" && net !== 0) {
      // income carries a credit balance (net < 0): debit it to zero.
      debits.push({ account: a.id, amount: -net });
      incomeTotal += -net;
    }
    if (a.type === "expense" && net !== 0) {
      // expense carries a debit balance (net > 0): credit it to zero.
      credits.push({ account: a.id, amount: net });
      expenseTotal += net;
    }
  }

  const profit = incomeTotal - expenseTotal;
  if (profit > 0) credits.push({ account: retained, amount: profit });
  else if (profit < 0) debits.push({ account: retained, amount: -profit });

  const dr = sum(debits);
  const cr = sum(credits);
  if (dr !== cr) {
    return refused(`closing posting does not balance: ${dollars(dr)} ≠ ${dollars(cr)}`);
  }
  if (debits.length === 0 && credits.length === 0) {
    return refused(`nothing to close in ${period}: no income or expense balances`);
  }
  return ok({ tag: "close", period, debits, credits });
}
