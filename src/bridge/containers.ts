// containers.ts — each clerk's container: the finite set of shapes it answers, and
// the typed position it returns. These are the "disjoint sub-surfaces" of PLAN §3 made
// into types. A clerk's Runner is typed by its container, so the clerk literally cannot
// be ASKED a shape outside its surface — the permission model is the type, enforced by
// the compiler (and, in harness.ts, by the registry at runtime).

import type { Fib } from "../lib/algebra.ts";
import type { Money } from "../ledger/types.ts";

// ── The shared outcome of any posting ─────────────────────────────────
/** Every posting clerk answers with this: a committed posting (carrying the
 *  correlation id that joins its journal entry), or a refusal. A refusal is a
 *  POSITION, not an exception — from the controller it is indistinguishable from a
 *  broken tool (MacBeth §5): an unbalanced posting and a clerk reaching outside its
 *  permitted accounts both come back as `refused`. */
export type ClerkResult =
  | { readonly tag: "done"; readonly correlationId: string; readonly result: unknown }
  | { readonly tag: "refused"; readonly reason: string };

/** One leg of a clerk's posting: an account and an amount in integer cents. */
export type PostLeg = { readonly account: string; readonly amount: Money };

// ── Payables clerk: posts the money-going-out side (liability/expense) ─
/** The shape is a single balanced posting (one debit, one credit) — the common
 *  invoice/bill form. The clerk's REGISTRY (harness.ts) fences which account CLASSES
 *  the legs may touch; the type here is identical to Receivables', so the only thing
 *  separating the two clerks is the argument-scoped permission, which is the point. */
export type PayablesC = Fib<
  {
    readonly tag: "post";
    readonly entity: string;
    readonly debit: PostLeg;
    readonly credit: PostLeg;
    readonly reason: string;
  },
  ClerkResult
>;

// ── Receivables clerk: posts the money-coming-in side (asset/income) ──
export type ReceivablesC = Fib<
  {
    readonly tag: "post";
    readonly entity: string;
    readonly debit: PostLeg;
    readonly credit: PostLeg;
    readonly reason: string;
  },
  ClerkResult
>;

// ── Auditor (read-only): a books-balance verdict ──────────────────────
/** The auditor reads the ledger and both logs and returns a verdict — never a posting.
 *  `balanced` is the trial balance closing; `reconciliationOk` is the two logs agreeing
 *  (no committed posting without a logged reason). */
export type AuditVerdict = {
  readonly entity: string;
  readonly balanced: boolean;
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  readonly reconciliationOk: boolean;
  readonly alarms: number;
  readonly blocked: number;
};

export type AuditorC = Fib<{ readonly tag: "audit"; readonly entity: string }, AuditVerdict>;

// ── Controller / consolidation boundary (M5 nesting) ──────────────────
/** The single position a subsidiary's controller returns up to a parent entity. This
 *  is the existential boundary (MacBeth §4): the parent sees ONLY this consolidated
 *  figure — never the subsidiary's chart of accounts, its clerks, or its journal. The
 *  subsidiary's internal state is hidden behind this one report, exactly as a child
 *  worker's store is invisible to its parent. */
export type EntityReport = {
  readonly entity: string;
  readonly posted: number; // postings the controller's clerks committed
  readonly refused: number; // postings refused (e.g. out of a clerk's class)
  readonly balanced: boolean; // the subsidiary's books close
  readonly netAssets: Money; // the ONE consolidated figure that crosses up (assets − liabilities)
};

export type ControllerC = Fib<
  { readonly tag: "consolidate"; readonly entity: string },
  EntityReport
>;
