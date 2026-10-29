// led.ts — "the ledger". The one executable: a single-command CLI surface.
//
// Read commands are free (no reason). Mutating commands require --reason (a memo —
// the ledger will not post an unreasoned entry) and go through a gate in gates.ts
// before anything commits. On commit, led writes ONE line to the journal (Layer 1,
// WHAT happened) with a correlation id — but the clerk's fuller reasoning is Layer 2,
// the harness intent-log. Exit 0 on success, 1 on any refusal/failure. JSON is the
// default output so a clerk's harness can parse it.

import { money, render, trialBalanceView } from "./format.ts";
import type { Format } from "./format.ts";
import { loadLedger, saveLedger } from "../ledger/store.ts";
import {
  applyEffect,
  balance,
  type Effect,
  getAccount,
  RefError,
  trialBalance,
} from "../ledger/ledger.ts";
import type { AccountType, Leg } from "../ledger/types.ts";
import { closeGate, type GateResult, openGate, postGate, reverseGate } from "../ledger/gates.ts";
import { fileJournal, type JournalEntry } from "../log/journal.ts";
import { type Clock, type IdSource, realClock, realIds } from "../log/ids.ts";

// ── tiny arg parser (no deps) ─────────────────────────────────────────
type Parsed = { positional: string[]; flags: Record<string, string | boolean> };

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

class Refusal extends Error {}

function str(flags: Parsed["flags"], key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function reqReason(flags: Parsed["flags"], command: string): string {
  const reason = str(flags, "reason");
  if (!reason || reason.trim() === "") {
    throw new Refusal(`${command} requires a non-empty --reason`);
  }
  return reason;
}

/** Parse "dollars[.cents]" into integer cents. Refuses anything else. */
function parseMoney(s: string): number {
  const m = s.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Refusal(`bad amount ${JSON.stringify(s)} (want e.g. 100 or 100.50)`);
  const cents = m[2] ? (m[2].length === 1 ? Number(m[2]) * 10 : Number(m[2])) : 0;
  return Number(m[1]) * 100 + cents;
}

/** Collect all `--debit acct:amount` (or `--credit ...`) legs from the raw argv,
 *  since a posting may have several of each — more than the flat flag parser keeps. */
function parseLegs(argv: string[], flag: string): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${flag}`) {
      const spec = argv[i + 1];
      if (!spec || spec.startsWith("--")) throw new Refusal(`--${flag} needs account:amount`);
      const colon = spec.lastIndexOf(":");
      if (colon === -1) throw new Refusal(`--${flag} ${spec} must be account:amount`);
      legs.push({ account: spec.slice(0, colon), amount: parseMoney(spec.slice(colon + 1)) });
    }
  }
  return legs;
}

/** Which accounts an effect's legs touch — for `statement`. */
function effectTouches(effect: unknown): string[] {
  const e = effect as Effect;
  if (e.tag === "post" || e.tag === "close") {
    return [...e.debits, ...e.credits].map((l) => l.account);
  }
  if (e.tag === "open") return [e.account.id];
  return [];
}

// ── dispatch ──────────────────────────────────────────────────────────
function run(argv: string[], ids: IdSource, clock: Clock): { value: unknown } {
  const { positional, flags } = parseArgs(argv);
  const ledgerPath = str(flags, "ledger") ?? "treasury-state.json";
  const journalPath = str(flags, "journal-file") ?? "journal.jsonl";
  const entity = str(flags, "entity") ?? "ACME";
  const ledger = loadLedger(ledgerPath);

  // Commit a gate result: refuse (nothing written) or apply + save + journal line.
  // The --reason is required by the caller but is NOT written here — it belongs to
  // Layer 2 (the harness intent-log), joined to this entry by correlation_id.
  const commit = (posting: string, gate: GateResult): unknown => {
    reqReason(flags, posting);
    if (!gate.ok) throw new Refusal(gate.reason);
    const newLedger = applyEffect(ledger, gate.effect);
    saveLedger(ledgerPath, newLedger);
    const correlationId = str(flags, "corr") ?? ids.next();
    const entry: JournalEntry = {
      id: ids.next(),
      ts: clock.now(),
      entity,
      posting,
      effect: gate.effect,
      correlation_id: correlationId,
    };
    fileJournal(journalPath).append(entry);
    return { committed: true, posting, entity, correlation_id: correlationId, effect: gate.effect };
  };

  const [group, sub, ...rest] = positional;

  switch (group) {
    // ── reads (free) ──
    case "balance": {
      const account = str(flags, "account");
      if (!account) throw new Refusal("balance needs --account");
      const a = getAccount(ledger, account);
      const b = balance(ledger, account);
      return {
        value: {
          account: a.id,
          name: a.name,
          type: a.type,
          net: b.net,
          balance: money(b.display),
        },
      };
    }
    case "trial-balance": {
      const tb = trialBalance(ledger);
      const format = (str(flags, "format") ?? "json") as Format;
      // In table mode, the printed trial balance IS the view; json returns the data.
      return { value: format === "table" ? trialBalanceView(tb) : tb };
    }
    case "statement": {
      const account = str(flags, "account");
      if (!account) throw new Refusal("statement needs --account");
      getAccount(ledger, account); // refuse unknown accounts
      const touching = fileJournal(journalPath).all()
        .filter((e) => effectTouches(e.effect).includes(account));
      return { value: { account, postings: touching } };
    }
    case "journal": {
      const jrnl = fileJournal(journalPath);
      if (sub === "recent") return { value: jrnl.recent(Number(str(flags, "n") ?? "10")) };
      if (sub === "trace") {
        const corr = rest[0] ?? str(flags, "corr");
        if (!corr) throw new Refusal("journal trace needs a correlation id");
        const entry = jrnl.trace(corr);
        if (!entry) throw new RefError(`no journal entry for ${corr}`);
        return { value: entry };
      }
      throw new Refusal(`unknown journal command: ${sub ?? "(none)"}`);
    }

    // ── mutations (audited, reason required, gated) ──
    case "post": {
      const debits = parseLegs(argv, "debit");
      const credits = parseLegs(argv, "credit");
      return { value: commit("post", postGate(ledger, debits, credits)) };
    }
    case "open": {
      const account = str(flags, "account");
      const name = str(flags, "name") ?? account;
      const type = str(flags, "type") as AccountType | undefined;
      const parent = str(flags, "under") ?? null;
      if (!account) throw new Refusal("open needs --account");
      if (!type) throw new Refusal("open needs --type asset|liability|equity|income|expense");
      return { value: commit("open", openGate(ledger, account, name ?? account, type, parent)) };
    }
    case "reverse": {
      const target = str(flags, "entry");
      if (!target) throw new Refusal("reverse needs --entry <corr-id>");
      const original = fileJournal(journalPath).trace(target);
      return {
        value: commit("reverse", reverseGate(ledger, target, original?.effect as Effect ?? null)),
      };
    }
    case "close": {
      const period = str(flags, "period");
      if (!period) throw new Refusal("close needs --period");
      return { value: commit("close", closeGate(ledger, period)) };
    }

    default:
      throw new Refusal(
        `unknown command: ${group ?? "(none)"}. ` +
          `try: balance | trial-balance | statement | journal | ` +
          `post | open | reverse | close`,
      );
  }
}

function main() {
  const { flags } = parseArgs(Deno.args);
  const format = (str(flags, "format") ?? "json") as Format;
  try {
    const { value } = run(Deno.args, realIds(), realClock());
    // A string value (the table-mode trial balance) prints as-is; everything else
    // renders through the formatter.
    console.log(typeof value === "string" ? value : render(value, format));
    Deno.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`refused: ${msg}`);
    Deno.exit(1);
  }
}

if (import.meta.main) main();

// Exported for the in-process demo/tests, which supply deterministic seams.
export { run };
