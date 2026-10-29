// reconcile.ts — the two logs audit each other.
//
// Reconciliation is not a bonus feature; in accounting it is the whole practice —
// cross-checking an independent record against reality. Joined by correlation_id, the
// journal (WHAT committed) and the intent-log (WHY, plus what was only attempted)
// cross-check into three findings:
//
//   matched   — a committed posting WITH a logged reason. The healthy case.
//   alarm     — a journal entry with NO matching `ok` intent: a change to the books
//               with no logged reasoning. This must never exist; it is exactly the
//               condition the whole design exists to surface.
//               (Also: an `ok` intent with no journal entry — a posting the harness
//               believed landed but did not.)
//   blocked   — an intent `refused`: a posting proposed and stopped (by the balance
//               gate, the reason-gate, or the registry). It never reached the journal,
//               so it is visible ONLY here. Expected, and valuable — the asymmetry
//               that a single merged log could never show.

import type { Journal, JournalEntry } from "./journal.ts";
import type { IntentLog, IntentRecord } from "./intentlog.ts";

export type Matched = {
  readonly correlationId: string;
  readonly posting: string;
  readonly agentId: string;
};

export type Alarm =
  | { readonly kind: "write-without-reason"; readonly entry: JournalEntry }
  | { readonly kind: "reason-without-write"; readonly intent: IntentRecord };

export type ReconReport = {
  readonly ok: boolean; // true iff there are no alarms
  readonly matched: readonly Matched[];
  readonly blocked: readonly IntentRecord[];
  readonly alarms: readonly Alarm[];
};

export function reconcile(journal: Journal, intentLog: IntentLog): ReconReport {
  // The final record per call; then index the mutating ones by correlation id.
  const latest = [...intentLog.latestByCall().values()];
  const okByCorr = new Map<string, IntentRecord>();
  for (const r of latest) {
    if (r.mutates && r.status === "ok" && r.correlation_id) {
      okByCorr.set(r.correlation_id, r);
    }
  }

  const matched: Matched[] = [];
  const alarms: Alarm[] = [];

  const journalEntries = journal.all();
  const journalCorrs = new Set(journalEntries.map((e) => e.correlation_id));

  // Every committed posting must have a matching `ok` intent (a logged reason).
  for (const e of journalEntries) {
    const intent = okByCorr.get(e.correlation_id);
    if (intent) {
      matched.push({ correlationId: e.correlation_id, posting: e.posting, agentId: intent.agent_id });
    } else {
      alarms.push({ kind: "write-without-reason", entry: e });
    }
  }

  // Every `ok` intent must have landed in the journal.
  for (const [corr, intent] of okByCorr) {
    if (!journalCorrs.has(corr)) alarms.push({ kind: "reason-without-write", intent });
  }

  // Refusals: proposed-but-blocked, visible only in Layer 2.
  const blocked = latest.filter((r) => r.mutates && r.status === "refused");

  return { ok: alarms.length === 0, matched, blocked, alarms };
}

/** A short human summary line for the demo. */
export function reconSummary(r: ReconReport): string {
  const head = r.ok ? "OK" : `${r.alarms.length} ALARM(S)`;
  return `reconciliation: ${head} — ${r.matched.length} matched, ` +
    `${r.blocked.length} blocked (refused, visible only in the intent-log), ` +
    `${r.alarms.length} alarm(s)`;
}
