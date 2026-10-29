// store.ts — load/save the ledger to one JSON file.
//
// `led` is invoked fresh per command (like a typical CLI), so the ledger must persist
// between invocations. It lives in one file; the first run seeds it. The in-process
// demo (demo.ts) bypasses this and holds the ledger in memory — same reducers, no
// file — which is the boundary claim again: the level cannot tell where state lives.

import type { Ledger } from "./types.ts";
import { seedLedger } from "./seed.ts";

export function loadLedger(path: string): Ledger {
  try {
    return JSON.parse(Deno.readTextFileSync(path)) as Ledger;
  } catch {
    return seedLedger();
  }
}

export function saveLedger(path: string, ledger: Ledger): void {
  Deno.writeTextFileSync(path, JSON.stringify(ledger, null, 2) + "\n");
}
