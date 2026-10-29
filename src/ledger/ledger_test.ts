// ledger_test.ts — the reducers are pure, the roll-up fold sums the subtree, and the
// trial balance closes. This is the real-algebra heart of the showpiece.

import { assertEquals } from "jsr:@std/assert@1";
import { accountNet, applyEffect, balance, rollup, trialBalance } from "./ledger.ts";
import { seedLedger } from "./seed.ts";

const CENTS = (d: number) => d * 100;

Deno.test("applyEffect is pure: the old ledger is untouched", () => {
  const l0 = seedLedger();
  const before = JSON.stringify(l0);
  applyEffect(l0, {
    tag: "post",
    debits: [{ account: "ar", amount: CENTS(500) }],
    credits: [{ account: "sales", amount: CENTS(500) }],
  });
  assertEquals(JSON.stringify(l0), before); // reducer returned a new ledger, did not mutate
});

Deno.test("rollup folds the subtree: a parent balance is the sum of its leaves", () => {
  let l = seedLedger(); // cash opens at $1,000
  l = applyEffect(l, {
    tag: "post",
    debits: [{ account: "ar", amount: CENTS(500) }],
    credits: [{ account: "sales", amount: CENTS(500) }],
  });
  // assets has no postings of its own — its balance exists ONLY as cash + AR.
  assertEquals(accountNet(l, "assets"), 0); // the category itself holds nothing
  assertEquals(rollup(l, "cash"), CENTS(1000));
  assertEquals(rollup(l, "ar"), CENTS(500));
  assertEquals(rollup(l, "assets"), CENTS(1500)); // the fold
  assertEquals(balance(l, "assets").display, CENTS(1500));
});

Deno.test("credit-normal accounts present a positive balance on their normal side", () => {
  let l = seedLedger();
  l = applyEffect(l, {
    tag: "post",
    debits: [{ account: "ar", amount: CENTS(800) }],
    credits: [{ account: "sales", amount: CENTS(800) }],
  });
  // sales is credit-normal: net is negative, display is positive.
  assertEquals(accountNet(l, "sales"), -CENTS(800));
  assertEquals(balance(l, "sales").display, CENTS(800));
  assertEquals(balance(l, "income").display, CENTS(800)); // folded through the category
});

Deno.test("trialBalance: debits equal credits after any balanced posting", () => {
  let l = seedLedger();
  for (const [d, c, amt] of [["ar", "sales", 500], ["wages", "ap", 200], ["ar", "sales", 300]] as const) {
    l = applyEffect(l, {
      tag: "post",
      debits: [{ account: d, amount: CENTS(amt) }],
      credits: [{ account: c, amount: CENTS(amt) }],
    });
  }
  const tb = trialBalance(l);
  assertEquals(tb.balanced, true);
  assertEquals(tb.totalDebit, tb.totalCredit);
  // only leaf accounts appear — no double-counting of category parents
  assertEquals(tb.rows.every((r) => ["cash", "ar", "ap", "sales", "wages", "retained-earnings"].includes(r.account)), true);
});
