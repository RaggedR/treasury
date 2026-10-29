// controller.ts — the controller posts nothing routine. The controller DELEGATES,
// AMALGAMATES, and (at period end) CLOSES (english.txt).
//
//   Delegate. A stack of invoices goes to receivables, a stack of bills to payables.
//     Control flows down as a delegated posting shape. The delegation is SEQUENTIAL —
//     each clerk commits to the one shared ledger, and concurrent posts would race on
//     it (lost updates), so order is deterministic, exactly as starship's flagship.ts
//     delegates sequentially for the same reason.
//
//   Amalgamate — as a FOLD. The controller reads each category's balance back through
//     led, and each of those balances is itself the roll-up of a whole subtree
//     (ledger.ts `rollup`). Here amalgamation is genuine addition up the chart of
//     accounts — debits and credits form a group, balances add — NOT the gather into a
//     list that the starship captain does. This is the half of the framework the
//     treasury exists to make honest.
//
//   Close. Only the controller may open accounts, reverse entries, and close the
//     period — the authority the clerks do not have.

import type { Runner } from "../lib/algebra.ts";
import type { Money } from "../ledger/types.ts";
import type { ClerkResult, PayablesC, PostLeg, ReceivablesC } from "./containers.ts";
import {
  type Chart,
  payablesClerk,
  receivablesClerk,
} from "./clerks.ts";
import { type HarnessCtx, ledRead, type Registry, runMutation } from "./harness.ts";

/** One posting the controller hands to a clerk: a balanced debit/credit with a memo. */
export type Entry = {
  readonly debit: PostLeg;
  readonly credit: PostLeg;
  readonly reason: string;
};

/** The five folded category balances, each a roll-up of its subtree (the amalgamation). */
export type FoldedBalances = {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly equity: Money;
  readonly income: Money;
  readonly expenses: Money;
};

export type ControllerReport = {
  readonly entity: string;
  readonly posted: number; // postings the clerks committed
  readonly refused: number; // postings refused (unbalanced, or out of a clerk's class)
  readonly folded: FoldedBalances; // the amalgamation: category balances by fold
  readonly netAssets: Money; // assets − liabilities, the consolidated figure
  readonly profit: Money; // income − expenses
  readonly trialBalanced: boolean;
};

export type Desk = {
  readonly receivables: Runner<ReceivablesC>;
  readonly payables: Runner<PayablesC>;
};

/** Assemble the clerks' desk over one harness context and chart. */
export function mkDesk(ctx: HarnessCtx, chart: Chart): Desk {
  return {
    receivables: receivablesClerk(ctx, chart),
    payables: payablesClerk(ctx, chart),
  };
}

// The controller's own registry — it reads the folded balances and may close the
// period, but routine posting is the clerks' job, not the controller's.
function controllerReg(entity: string): Registry {
  return {
    agentId: `controller:${entity}`,
    allowed: new Set(["balance", "trial-balance", "close", "open", "reverse"]),
  };
}

/** Read one category's folded balance back through led (a logged read). */
function foldedBalance(ctx: HarnessCtx, reg: Registry, entity: string, account: string): Money {
  const b = ledRead(
    ctx,
    reg,
    "balance",
    ["balance", "--account", account, "--entity", entity],
    { account, entity },
  ) as { display: string; net: number };
  // `balance` returns the display string and the net; the net (debit−credit, in cents)
  // is the signed figure we amalgamate with. Present each category on its normal side.
  return b.net;
}

/** Delegate the batches, then amalgamate the sub-ledger balances by fold. */
export async function handleBatches(
  ctx: HarnessCtx,
  chart: Chart,
  entity: string,
  invoices: readonly Entry[],
  bills: readonly Entry[],
): Promise<ControllerReport> {
  const desk = mkDesk(ctx, chart);
  const reg = controllerReg(entity);

  let posted = 0;
  let refused = 0;
  const tally = (r: ClerkResult) => (r.tag === "done" ? posted++ : refused++);

  // Control down — delegate each posting to the right clerk, sequentially.
  for (const inv of invoices) {
    tally(await desk.receivables.run(
      { tag: "post", entity, debit: inv.debit, credit: inv.credit, reason: inv.reason },
      0,
    ));
  }
  for (const bill of bills) {
    tally(await desk.payables.run(
      { tag: "post", entity, debit: bill.debit, credit: bill.credit, reason: bill.reason },
      0,
    ));
  }

  // Data up — amalgamate the category balances by fold. Each read is a roll-up over a
  // subtree; summing them is the real-algebra amalgamation.
  const assets = foldedBalance(ctx, reg, entity, "assets");
  const liabilities = foldedBalance(ctx, reg, entity, "liabilities");
  const equity = foldedBalance(ctx, reg, entity, "equity");
  const income = foldedBalance(ctx, reg, entity, "income");
  const expenses = foldedBalance(ctx, reg, entity, "expenses");

  const tb = ledRead(
    ctx,
    reg,
    "trial-balance",
    ["trial-balance", "--entity", entity],
    { entity },
  ) as { balanced: boolean };

  // Category nets are signed (debit−credit). Assets/expenses are debit-normal (net ≥ 0
  // when healthy); liabilities/equity/income are credit-normal (net ≤ 0). Net assets =
  // assets + liabilities (liabilities' net is already negative), profit = −(income) −
  // expenses ... presented as magnitudes on the normal side.
  const netAssets = assets + liabilities; // assets(+) + liabilities(−) = equity-ish
  const profit = -income - expenses; // income(−) negated, minus expenses(+)

  return {
    entity,
    posted,
    refused,
    folded: { assets, liabilities, equity, income, expenses },
    netAssets,
    profit,
    trialBalanced: tb.balanced,
  };
}

/** Close the period — the controller's authority, through its harness (reason-gated). */
export function closePeriod(
  ctx: HarnessCtx,
  entity: string,
  period: string,
  reason: string,
): ClerkResult {
  const reg = controllerReg(entity);
  const o = runMutation(
    ctx,
    reg,
    "close",
    ["close", "--period", period, "--entity", entity],
    { period },
    reason,
  );
  return o.ok
    ? { tag: "done", correlationId: o.correlationId, result: o.result }
    : { tag: "refused", reason: o.reason };
}
