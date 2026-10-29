// clerks.ts — the clerks and the auditor as in-process Runners (ref: stubRunner in
// ~/git/gold/dungeon/harness.ts). Each is a leaf: its answer function plays the part a
// subprocess or language model would, producing a RAW reply that the decoder validates
// into a typed position (leafLocal). The reasoning is scripted/deterministic, so the
// demo replays identically; swapping in a real model later means replacing only the
// answer function.
//
// Every clerk touches ONLY the led surface — reads via ledRead, writes via runMutation
// — and only the commands in its registry (the allowlist IS the permission grant),
// fenced further by account CLASS (the argument-scope). Nothing here reads the ledger
// object directly, so led's ledger file is the single source of truth.

import { leafLocal, type Runner } from "../lib/algebra.ts";
import type { AccountType } from "../ledger/types.ts";
import type { Journal } from "../log/journal.ts";
import { reconcile } from "../log/reconcile.ts";
import type {
  AuditorC,
  AuditVerdict,
  ClerkResult,
  PayablesC,
  PostLeg,
  ReceivablesC,
} from "./containers.ts";
import {
  type HarnessCtx,
  ledRead,
  type MutationOutcome,
  type Registry,
  runMutation,
} from "./harness.ts";

// A map from account id to its class — the chart, as the clerks see it, so a clerk can
// classify the legs of a posting and so its argScope can fence them. Built once from
// the seed and handed in, so the clerks never read the ledger object directly.
export type Chart = Record<string, AccountType>;

/** Integer cents -> the "dollars.cents" string led's parser expects. */
function centsToArg(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// ── decoders ──────────────────────────────────────────────────────────
function decodeClerkResult(u: unknown): ClerkResult | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  if (r.tag === "done" && typeof r.correlationId === "string") {
    return { tag: "done", correlationId: r.correlationId, result: r.result };
  }
  if (r.tag === "refused" && typeof r.reason === "string") {
    return { tag: "refused", reason: r.reason };
  }
  return null;
}

function decodeVerdict(u: unknown): AuditVerdict | null {
  if (!u || typeof u !== "object") return null;
  const v = u as Record<string, unknown>;
  return typeof v.entity === "string" && typeof v.balanced === "boolean" &&
      typeof v.totalDebit === "number" && typeof v.totalCredit === "number" &&
      typeof v.reconciliationOk === "boolean" && typeof v.alarms === "number" &&
      typeof v.blocked === "number"
    ? {
      entity: v.entity,
      balanced: v.balanced,
      totalDebit: v.totalDebit,
      totalCredit: v.totalCredit,
      reconciliationOk: v.reconciliationOk,
      alarms: v.alarms,
      blocked: v.blocked,
    }
    : null;
}

/** Turn a harness MutationOutcome into the raw ClerkResult the leaf will decode. */
function asResult(o: MutationOutcome): ClerkResult {
  return o.ok
    ? { tag: "done", correlationId: o.correlationId, result: o.result }
    : { tag: "refused", reason: o.reason };
}

// ── a posting clerk, scoped to a set of account classes ───────────────
/** Payables and Receivables are the same machine fenced to different classes: this
 *  factory builds either. The argScope reads the classes of the two legs from the chart
 *  and refuses if EITHER is outside the clerk's permitted set — the argument-scoped
 *  permission that is the sharp illustration of PLAN §3. */
function postingClerk<C extends PayablesC | ReceivablesC>(
  ctx: HarnessCtx,
  chart: Chart,
  agentId: string,
  classes: ReadonlySet<AccountType>,
): Runner<C> {
  const reg: Registry = {
    agentId,
    allowed: new Set(["post"]),
    argScope: (_tool, args) => {
      const accounts = (args.accounts as string[]) ?? [];
      for (const acct of accounts) {
        const cls = chart[acct];
        if (cls === undefined) continue; // led's own gate will refuse an unknown account
        if (!classes.has(cls)) {
          const article = /^[aeiou]/.test(cls) ? "an" : "a";
          return `${agentId} may not post to ${acct} (${article} ${cls} account); ` +
            `permitted: ${[...classes].join("/")}`;
        }
      }
      return null;
    },
  };
  return leafLocal<C>(
    agentId,
    (shape) => {
      const s = shape as { entity: string; debit: PostLeg; credit: PostLeg; reason: string };
      return asResult(runMutation(
        ctx,
        reg,
        "post",
        [
          "post",
          "--debit",
          `${s.debit.account}:${centsToArg(s.debit.amount)}`,
          "--credit",
          `${s.credit.account}:${centsToArg(s.credit.amount)}`,
          "--entity",
          s.entity,
        ],
        { accounts: [s.debit.account, s.credit.account], debit: s.debit, credit: s.credit },
        s.reason,
      ));
    },
    { post: decodeClerkResult } as never,
  );
}

/** Payables: the money-going-out side — may post only to liability/expense accounts. */
export function payablesClerk(ctx: HarnessCtx, chart: Chart): Runner<PayablesC> {
  return postingClerk<PayablesC>(
    ctx,
    chart,
    "clerk:payables",
    new Set<AccountType>(["liability", "expense"]),
  );
}

/** Receivables: the money-coming-in side — may post only to asset/income accounts. */
export function receivablesClerk(ctx: HarnessCtx, chart: Chart): Runner<ReceivablesC> {
  return postingClerk<ReceivablesC>(
    ctx,
    chart,
    "clerk:receivables",
    new Set<AccountType>(["asset", "income"]),
  );
}

// ── Auditor (read-only): the books-balance verdict ────────────────────
/** The auditor reads the trial balance through led (a logged read) and cross-checks
 *  the two logs by reconciliation — this is literally an audit (PLAN §5). It can never
 *  post: its registry has no mutating command, and its container has no posting shape.
 *  The journal is handed in so the auditor can reconcile it against the intent-log. */
export function auditorClerk(ctx: HarnessCtx, journal: Journal): Runner<AuditorC> {
  const reg: Registry = {
    agentId: "clerk:auditor",
    allowed: new Set(["trial-balance", "balance", "statement", "journal recent", "journal trace"]),
  };
  return leafLocal<AuditorC>(
    "clerk:auditor",
    (shape) => {
      const tb = ledRead(
        ctx,
        reg,
        "trial-balance",
        ["trial-balance", "--entity", shape.entity],
        { entity: shape.entity },
      ) as { totalDebit: number; totalCredit: number; balanced: boolean };
      const rec = reconcile(journal, ctx.intentLog);
      return {
        entity: shape.entity,
        balanced: tb.balanced,
        totalDebit: tb.totalDebit,
        totalCredit: tb.totalCredit,
        reconciliationOk: rec.ok,
        alarms: rec.alarms.length,
        blocked: rec.blocked.length,
      };
    },
    { audit: decodeVerdict },
  );
}

/** The chart (account id -> class) the clerks need, built from a ledger's accounts. */
export function chartOf(accounts: Record<string, { type: AccountType }>): Chart {
  const chart: Chart = {};
  for (const [id, a] of Object.entries(accounts)) chart[id] = a.type;
  return chart;
}
