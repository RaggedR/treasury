// reconcile_test.ts — the two-log cross-check raises exactly the right findings.

import { assertEquals } from "jsr:@std/assert@1";
import { type JournalEntry, memJournal } from "./journal.ts";
import { type IntentRecord, memIntentLog } from "./intentlog.ts";
import { reconcile } from "./reconcile.ts";

const entry = (correlation_id: string, posting = "post"): JournalEntry => ({
  id: "e-" + correlation_id,
  ts: "t",
  entity: "ACME",
  posting,
  effect: {},
  correlation_id,
});

const intent = (
  correlation_id: string,
  status: IntentRecord["status"],
  reason = "r",
): IntentRecord => ({
  call_id: "c-" + correlation_id + "-" + status,
  ts: "t",
  agent_id: "clerk:receivables",
  session_id: "S",
  tool: "post",
  args: {},
  reason,
  mutates: true,
  status,
  correlation_id,
});

Deno.test("healthy: committed posting with a logged reason => matched, ok", () => {
  const r = reconcile(
    memJournal([entry("C1")]),
    memIntentLog([intent("C1", "attempted"), intent("C1", "ok")]),
  );
  assertEquals(r.ok, true);
  assertEquals(r.matched.length, 1);
  assertEquals(r.alarms.length, 0);
});

Deno.test("alarm: a journal entry with no logged reason (posting outside the harness)", () => {
  const r = reconcile(memJournal([entry("ROGUE")]), memIntentLog([]));
  assertEquals(r.ok, false);
  assertEquals(r.alarms.length, 1);
  assertEquals(r.alarms[0].kind, "write-without-reason");
});

Deno.test("blocked: a refused posting is visible only in the intent-log", () => {
  const r = reconcile(memJournal([]), memIntentLog([intent("C2", "refused")]));
  assertEquals(r.ok, true); // a refusal is not an alarm
  assertEquals(r.blocked.length, 1);
  assertEquals(r.matched.length, 0);
});

Deno.test("alarm: an ok intent that never reached the journal", () => {
  const r = reconcile(memJournal([]), memIntentLog([intent("C3", "ok")]));
  assertEquals(r.ok, false);
  assertEquals(r.alarms[0].kind, "reason-without-write");
});
