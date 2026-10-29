// demo.ts — the whole showpiece in one run (PLAN §8 "Definition of done").
//
// A stranger runs `deno task demo` and, in well under a minute, watches a controller
// delegate batches to the clerks, sees each posting with its reason land in the
// journal, sees an unbalanced posting refused and a clerk reaching outside its accounts
// refused, watches sub-ledger balances FOLD into a trial balance that closes, reads the
// auditor's reconciliation — then sees what reconciliation catches, and finally a parent
// consolidating two subsidiaries. Everything is driven by seeded ids and a fixed clock,
// so two runs produce byte-identical books and logs (verify.sh checks exactly that).

import { run } from "./cli/led.ts";
import { money, trialBalanceView } from "./cli/format.ts";
import { loadLedger, saveLedger } from "./ledger/store.ts";
import { seedLedger } from "./ledger/seed.ts";
import { trialBalance } from "./ledger/ledger.ts";
import { fixedClock, seededIds } from "./log/ids.ts";
import { fileIntentLog } from "./log/intentlog.ts";
import { fileJournal } from "./log/journal.ts";
import { reconcile, reconSummary } from "./log/reconcile.ts";
import { type HarnessCtx } from "./bridge/harness.ts";
import { auditorClerk, chartOf, payablesClerk } from "./bridge/clerks.ts";
import { closePeriod, type Entry, handleBatches } from "./bridge/controller.ts";
import { consolidate, subsidiaryController } from "./fleet/consolidation.ts";

const p = (s = "") => console.log(s);
const rule = (t: string) => p(`\n${"─".repeat(68)}\n${t}\n${"─".repeat(68)}`);

function freshDir(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch { /* first run */ }
  Deno.mkdirSync(path, { recursive: true });
}

/** A rig: led over files in `dir`, a harness over it, all seams seeded. */
function rig(dir: string, idSeed = "desk") {
  freshDir(dir);
  const lp = `${dir}/ledger.json`;
  const jp = `${dir}/journal.jsonl`;
  const ip = `${dir}/intent-log.jsonl`;
  saveLedger(lp, seedLedger());
  const ledIds = seededIds("led");
  const ledClock = fixedClock();
  const ledRun = (argv: string[]) =>
    run([...argv, "--ledger", lp, "--journal-file", jp], ledIds, ledClock);
  const ctx: HarnessCtx = {
    ids: seededIds(idSeed),
    clock: fixedClock(),
    intentLog: fileIntentLog(ip),
    sessionId: "DEMO",
    ledRun,
  };
  return { ctx, lp, jp, ip, ledRun };
}

// The chart (account -> class) the clerks are fenced by.
const chart = chartOf(seedLedger().accounts);

// ── the batches of the scene (english.txt) ────────────────────────────
// invoices → receivables: debit AR, credit Sales (the money-coming-in side).
const invoices: Entry[] = [
  { debit: { account: "ar", amount: 50000 }, credit: { account: "sales", amount: 50000 }, reason: "invoice 1182, services to Acme in October" },
  { debit: { account: "ar", amount: 30000 }, credit: { account: "sales", amount: 30000 }, reason: "invoice 1183, services to Globex" },
];
// bills → payables: debit Expense, credit Accounts Payable (what the firm owes).
const bills: Entry[] = [
  { debit: { account: "wages", amount: 20000 }, credit: { account: "ap", amount: 20000 }, reason: "October wages owed to staff" },
];

// ══ 1. The situation ══════════════════════════════════════════════════
rule("TREASURY — one company's books: a chart of accounts, four roles, one iron rule");
const main = rig("demo-out/books");
{
  const led = loadLedger(main.lp);
  p("  Chart of accounts (a tree; category balances are pure roll-ups of the leaves):");
  for (const top of Object.values(led.accounts).filter((a) => a.parent === null)) {
    p(`    ${top.name} (${top.type})`);
    for (const c of Object.values(led.accounts).filter((a) => a.parent === top.id)) {
      p(`      └ ${c.name}`);
    }
  }
  p(`\n  Opening balance: cash ${money(100000)} against retained earnings ${money(100000)}.`);
}

// ══ 2. The controller delegates to the clerks, amalgamates by fold ════
rule("The controller delegates batches → clerks post → balances FOLD up the chart");
const report = await handleBatches(main.ctx, chart, "ACME", invoices, bills);
p(`  → Receivables booked ${invoices.length} invoices (debit AR, credit Sales).`);
p(`  → Payables booked ${bills.length} bill (debit Wages, credit Accounts Payable).`);
p(`  Controller amalgamates the category balances by fold (each a roll-up of its subtree):`);
p(`      Assets      ${money(report.folded.assets)}`);
p(`      Liabilities ${money(-report.folded.liabilities)}   (credit-normal)`);
p(`      Income      ${money(-report.folded.income)}   (credit-normal)`);
p(`      Expenses    ${money(report.folded.expenses)}`);
p(`  Net assets ${money(report.netAssets)}, profit ${money(report.profit)}; ` +
  `posted ${report.posted}, refused ${report.refused}; trial balance ${report.trialBalanced ? "CLOSES" : "OUT"}.`);

// ══ 3. Two refusals — each indistinguishable from a broken tool ═══════
rule("Two illegal postings — from the controller, each looks like a broken tool (§5)");
// (a) unbalanced: the iron rule
const unbalanced = await (async () => {
  const { receivablesClerk } = await import("./bridge/clerks.ts");
  const rec = receivablesClerk(main.ctx, chart);
  return rec.run(
    { tag: "post", entity: "ACME", debit: { account: "ar", amount: 10000 }, credit: { account: "sales", amount: 9000 }, reason: "miskeyed invoice" },
    0,
  );
})();
p(`  (a) receivables posts debit ${money(10000)} ≠ credit ${money(9000)}:`);
p(`        ${unbalanced.tag === "refused" ? `refused — ${unbalanced.reason}` : "committed (!)"}`);
// (b) out of scope: the argument-scoped permission
const pay = payablesClerk(main.ctx, chart);
const outOfScope = await pay.run(
  { tag: "post", entity: "ACME", debit: { account: "ar", amount: 100 }, credit: { account: "sales", amount: 100 }, reason: "payables reaching into income" },
  0,
);
p(`  (b) payables (liability/expense only) posts to AR + Sales:`);
p(`        ${outOfScope.tag === "refused" ? `refused — ${outOfScope.reason}` : "committed (!)"}`);
p(`  Neither reached the journal; both are visible only in the intent-log (Layer 2).`);

// ══ 4. Close the period, then show the trial balance that closes ══════
rule("The controller closes the period — income/expense roll into equity");
const closed = closePeriod(main.ctx, "ACME", "2026-Q4", "year-end close");
p(`  close 2026-Q4: ${closed.tag === "done" ? `committed (corr ${closed.correlationId})` : closed.tag}`);
p("");
p(trialBalanceView(trialBalance(loadLedger(main.lp))).split("\n").map((l) => "  " + l).join("\n"));

// ══ 5. The two logs ═══════════════════════════════════════════════════
rule("Layer 1 — the journal (WHAT committed, append-only)");
for (const e of fileJournal(main.jp).all()) {
  p(`  ${e.ts}  ${e.posting.padEnd(8)}  corr ${e.correlation_id}`);
}
rule("Layer 2 — the intent-log (WHY, and what was only attempted)");
for (const r of main.ctx.intentLog.all()) {
  const why = r.mutates ? `"${r.reason}"` : "(read)";
  p(`  ${r.ts}  ${r.agent_id.padEnd(22)} ${r.tool.padEnd(13)} ${r.status.padEnd(9)} ${why}`);
}

// ══ 6. Reconciliation — the auditor cross-checks the two logs ═════════
rule("Reconciliation — the auditor audits the two logs against each other");
const auditor = auditorClerk(main.ctx, fileJournal(main.jp));
const verdict = await auditor.run({ tag: "audit", entity: "ACME" }, 0);
const rec = reconcile(fileJournal(main.jp), main.ctx.intentLog);
p(`  auditor verdict: books ${verdict.balanced ? "BALANCE" : "DO NOT BALANCE"} ` +
  `(${money(verdict.totalDebit)} = ${money(verdict.totalCredit)}), ` +
  `reconciliation ${verdict.reconciliationOk ? "OK" : "ALARM"}.`);
p(`  ${reconSummary(rec)}`);
for (const b of rec.blocked) p(`    blocked:  ${b.tool} — "${b.reason}" (refused; visible only here)`);

// ══ 7. What reconciliation CATCHES: a posting made outside the harness ═
rule("What reconciliation catches — a posting made OUTSIDE the harness");
const rogue = rig("demo-out/alarm", "rogue");
// one proper, harnessed posting (reasoned, logged in both layers)
const { receivablesClerk: recFactory } = await import("./bridge/clerks.ts");
await recFactory(rogue.ctx, chart).run(
  { tag: "post", entity: "ACME", debit: { account: "ar", amount: 10000 }, credit: { account: "sales", amount: 10000 }, reason: "proper invoice" },
  0,
);
// one rogue posting straight at led, bypassing the harness — no intent record
rogue.ledRun(["post", "--debit", "cash:100.00", "--credit", "sales:100.00", "--reason", "(bypassed the controller)", "--corr", "ROGUE00000000000000000000000"]);
const rogueRec = reconcile(fileJournal(rogue.jp), rogue.ctx.intentLog);
p(`  ${reconSummary(rogueRec)}`);
for (const a of rogueRec.alarms) {
  if (a.kind === "write-without-reason") {
    p(`    ALARM: ${a.entry.posting} committed (corr ${a.entry.correlation_id}) with NO logged reason`);
  }
}
p(`  The journal alone could never show this; the two-log cross-check does.`);

// ══ 8. Nesting — a parent consolidates two subsidiaries ═══════════════
rule("Consolidation — a group's books are ledgers nested inside a ledger (§4)");
const subA = rig("demo-out/sub-a", "sub-a");
const subB = rig("demo-out/sub-b", "sub-b");
const ctrlA = subsidiaryController({ ctx: subA.ctx, chart, invoices, bills, period: "2026-Q4" });
const ctrlB = subsidiaryController({
  ctx: subB.ctx,
  chart,
  invoices: [{ debit: { account: "ar", amount: 120000 }, credit: { account: "sales", amount: 120000 }, reason: "invoice 2001, subsidiary B" }],
  bills: [{ debit: { account: "wages", amount: 40000 }, credit: { account: "ap", amount: 40000 }, reason: "subsidiary B wages" }],
  period: "2026-Q4",
});
const group = await consolidate([
  { entity: "SUB-A", controller: ctrlA },
  { entity: "SUB-B", controller: ctrlB },
]);
for (const e of group.entities) {
  p(`  ${e.entity}: net assets ${money(e.netAssets)}, posted ${e.posted}, books ${e.balanced ? "balance" : "OUT"}` +
    ` — the parent sees ONLY this line, never SUB's accounts or journal.`);
}
p(`  Group net assets (the fold, one level up): ${money(group.groupNetAssets)} — ${group.summary}.`);
p("");
