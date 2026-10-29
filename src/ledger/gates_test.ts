// gates_test.ts — the smart constructors refuse exactly what they should. The
// double-entry gate is the headline: an unbalanced posting is never an Effect.

import { assertEquals } from "jsr:@std/assert@1";
import { closeGate, openGate, postGate, reverseGate } from "./gates.ts";
import { applyEffect, type Effect } from "./ledger.ts";
import { seedLedger } from "./seed.ts";

const CENTS = (d: number) => d * 100;

Deno.test("postGate: balanced posting OK, unbalanced refused (the iron rule)", () => {
  const l = seedLedger();
  const legal = postGate(
    l,
    [{ account: "ar", amount: CENTS(500) }],
    [{ account: "sales", amount: CENTS(500) }],
  );
  assertEquals(legal.ok, true);

  const illegal = postGate(
    l,
    [{ account: "ar", amount: CENTS(100) }],
    [{ account: "sales", amount: CENTS(90) }],
  );
  assertEquals(illegal.ok, false);
  if (!illegal.ok) assertEquals(illegal.reason.startsWith("posting does not balance"), true);
});

Deno.test("postGate: unknown account refused", () => {
  const l = seedLedger();
  const r = postGate(l, [{ account: "nope", amount: 100 }], [{ account: "sales", amount: 100 }]);
  assertEquals(r.ok, false);
});

Deno.test("postGate: overdraw an asset below zero refused", () => {
  const l = seedLedger(); // cash opens at $1,000
  const ok = postGate(l, [{ account: "wages", amount: CENTS(500) }], [{ account: "cash", amount: CENTS(500) }]);
  assertEquals(ok.ok, true);
  const over = postGate(l, [{ account: "wages", amount: CENTS(5000) }], [{ account: "cash", amount: CENTS(5000) }]);
  assertEquals(over.ok, false);
  if (!over.ok) assertEquals(over.reason.startsWith("overdraw"), true);
});

Deno.test("openGate: new account OK, duplicate and missing parent refused", () => {
  const l = seedLedger();
  assertEquals(openGate(l, "rent", "Rent", "expense", "expenses").ok, true);
  assertEquals(openGate(l, "cash", "Cash", "asset", "assets").ok, false); // duplicate
  assertEquals(openGate(l, "x", "X", "asset", "no-parent").ok, false); // missing parent
});

Deno.test("reverseGate: swaps the legs; refuses a double reversal and a non-posting", () => {
  const l = seedLedger();
  const original: Effect = {
    tag: "post",
    debits: [{ account: "ar", amount: CENTS(500) }],
    credits: [{ account: "sales", amount: CENTS(500) }],
  };
  const rev = reverseGate(l, "C1", original);
  assertEquals(rev.ok, true);
  if (rev.ok && rev.effect.tag === "post") {
    // debits and credits swapped
    assertEquals(rev.effect.debits, original.credits);
    assertEquals(rev.effect.credits, original.debits);
    assertEquals(rev.effect.reverses, "C1");
  }
  // already reversed
  const l2 = applyEffect(l, rev.ok ? rev.effect : original);
  assertEquals(reverseGate(l2, "C1", original).ok, false);
  // missing target
  assertEquals(reverseGate(l, "C9", null).ok, false);
});

Deno.test("closeGate: rolls income/expense into equity; refuses a second close", () => {
  let l = seedLedger();
  // book $800 income and $200 expense so there is something to close
  l = applyEffect(l, {
    tag: "post",
    debits: [{ account: "ar", amount: CENTS(800) }],
    credits: [{ account: "sales", amount: CENTS(800) }],
  });
  l = applyEffect(l, {
    tag: "post",
    debits: [{ account: "wages", amount: CENTS(200) }],
    credits: [{ account: "ap", amount: CENTS(200) }],
  });
  const close = closeGate(l, "2026-Q4");
  assertEquals(close.ok, true);
  if (close.ok) {
    l = applyEffect(l, close.effect);
    // retained earnings = opening $1,000 credit + $600 profit = $1,600 credit (net -160000)
    assertEquals(l.balances["retained-earnings"].credit - l.balances["retained-earnings"].debit, CENTS(1600));
    // a second close of the same period is refused
    assertEquals(closeGate(l, "2026-Q4").ok, false);
  }
});
