// clerks_test.ts — the typed agents: argument-scoped permission (the new boundary),
// the reason-gate, the controller's fold amalgamation, and the auditor's verdict.

import { assertEquals } from "jsr:@std/assert@1";
import { run } from "../cli/led.ts";
import { seedLedger } from "../ledger/seed.ts";
import { saveLedger } from "../ledger/store.ts";
import { fixedClock, seededIds } from "../log/ids.ts";
import { fileIntentLog } from "../log/intentlog.ts";
import { fileJournal } from "../log/journal.ts";
import { auditorClerk, chartOf, payablesClerk, receivablesClerk } from "./clerks.ts";
import { handleBatches } from "./controller.ts";
import type { HarnessCtx } from "./harness.ts";

const chart = chartOf(seedLedger().accounts);

function rig(tag: string): { ctx: HarnessCtx; jp: string } {
  const dir = Deno.makeTempDirSync({ prefix: `treasury-${tag}-` });
  const lp = `${dir}/ledger.json`;
  const jp = `${dir}/journal.jsonl`;
  const ip = `${dir}/intent.jsonl`;
  saveLedger(lp, seedLedger());
  const ledIds = seededIds("led");
  const ledClock = fixedClock();
  const ledRun = (argv: string[]) =>
    run([...argv, "--ledger", lp, "--journal-file", jp], ledIds, ledClock);
  const ctx: HarnessCtx = {
    ids: seededIds(tag),
    clock: fixedClock(),
    intentLog: fileIntentLog(ip),
    sessionId: "TEST",
    ledRun,
  };
  return { ctx, jp };
}

Deno.test("argument-scope: payables may not post to an asset account", async () => {
  const { ctx } = rig("scope");
  const pay = payablesClerk(ctx, chart);
  const r = await pay.run(
    { tag: "post", entity: "ACME", debit: { account: "ar", amount: 100 }, credit: { account: "sales", amount: 100 }, reason: "reaching into income" },
    0,
  );
  assertEquals(r.tag, "refused");
  // and it never reached the journal — only the intent-log shows it, as refused
  assertEquals(ctx.intentLog.all().some((x) => x.status === "refused"), true);
});

Deno.test("argument-scope: receivables may post to asset/income", async () => {
  const { ctx } = rig("recv");
  const rec = receivablesClerk(ctx, chart);
  const r = await rec.run(
    { tag: "post", entity: "ACME", debit: { account: "ar", amount: 50000 }, credit: { account: "sales", amount: 50000 }, reason: "invoice 1" },
    0,
  );
  assertEquals(r.tag, "done");
});

Deno.test("reason-gate: an empty reason is refused before led runs", async () => {
  const { ctx } = rig("reason");
  const rec = receivablesClerk(ctx, chart);
  const r = await rec.run(
    { tag: "post", entity: "ACME", debit: { account: "ar", amount: 100 }, credit: { account: "sales", amount: 100 }, reason: "" },
    0,
  );
  assertEquals(r.tag, "refused");
});

Deno.test("controller amalgamates the category balances by fold", async () => {
  const { ctx } = rig("fold");
  const report = await handleBatches(
    ctx,
    chart,
    "ACME",
    [{ debit: { account: "ar", amount: 50000 }, credit: { account: "sales", amount: 50000 }, reason: "invoice" }],
    [{ debit: { account: "wages", amount: 20000 }, credit: { account: "ap", amount: 20000 }, reason: "wages" }],
  );
  assertEquals(report.posted, 2);
  assertEquals(report.refused, 0);
  // assets fold = cash $1,000 + AR $500 = $1,500; net assets = assets − liabilities(AP $200)
  assertEquals(report.folded.assets, 150000);
  assertEquals(report.netAssets, 150000 - 20000);
  assertEquals(report.profit, 50000 - 20000);
  assertEquals(report.trialBalanced, true);
});

Deno.test("auditor verdict: books balance and reconciliation is clean", async () => {
  const { ctx, jp } = rig("audit");
  const rec = receivablesClerk(ctx, chart);
  await rec.run(
    { tag: "post", entity: "ACME", debit: { account: "ar", amount: 50000 }, credit: { account: "sales", amount: 50000 }, reason: "invoice" },
    0,
  );
  const auditor = auditorClerk(ctx, fileJournal(jp));
  const v = await auditor.run({ tag: "audit", entity: "ACME" }, 0);
  assertEquals(v.balanced, true);
  assertEquals(v.reconciliationOk, true);
  assertEquals(v.totalDebit, v.totalCredit);
});
