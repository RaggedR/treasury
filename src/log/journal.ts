// journal.ts — Layer 1 of the two-layer log: the JOURNAL (the CLI's audit).
//
// The journal records WHAT happened, append-only, as the tamper-evident source of
// truth for POSTINGS. Here `led` writes one JSONL line per committed posting. It
// never records WHY beyond the memo — the clerk's reasoning is Layer 2, the
// intent-log (intentlog.ts), joined to this one by correlation_id.
//
// Accounting already insists on this shape: the journal is append-only — you never
// erase an entry, a correction is a new reversing posting — which is exactly why the
// fit is exact. Refusals are NOT written here. A posting the balance gate rejected
// never committed, so from the journal it simply did not happen — which is precisely
// why the second log is needed to see it.

export type JournalEntry = {
  readonly id: string; // this entry's own id
  readonly ts: string;
  readonly entity: string; // which ledger (an entity/company), for consolidation
  readonly posting: string; // the command, e.g. "post" / "reverse" / "close"
  readonly effect: unknown; // the committed effect (the legs), as data
  readonly correlation_id: string; // joins to the intent-log
};

export interface Journal {
  append(entry: JournalEntry): void;
  all(): readonly JournalEntry[];
  recent(n: number): readonly JournalEntry[];
  trace(correlationId: string): JournalEntry | null;
}

/** An in-memory journal — for tests and in-process demos. */
export function memJournal(seed: readonly JournalEntry[] = []): Journal {
  const entries: JournalEntry[] = [...seed];
  return {
    append(e) {
      entries.push(e);
    },
    all() {
      return entries;
    },
    recent(n) {
      return entries.slice(Math.max(0, entries.length - n));
    },
    trace(corr) {
      return entries.find((e) => e.correlation_id === corr) ?? null;
    },
  };
}

/** A file-backed journal — append-only JSONL, one entry per line. This is the shape
 *  `led` persists to between invocations, since the CLI runs fresh per command (like
 *  a typical CLI). Reads parse the whole file; appends add one line — never a
 *  rewrite, because an erasable journal is not a journal. */
export function fileJournal(path: string): Journal {
  const readAll = (): JournalEntry[] => {
    let text: string;
    try {
      text = Deno.readTextFileSync(path);
    } catch {
      return [];
    }
    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as JournalEntry);
  };
  const mem = memJournal(readAll());
  return {
    append(e) {
      mem.append(e);
      // Append-only: one line, never a rewrite. A rewrite would defeat the point.
      Deno.writeTextFileSync(path, JSON.stringify(e) + "\n", { append: true });
    },
    all: () => mem.all(),
    recent: (n) => mem.recent(n),
    trace: (c) => mem.trace(c),
  };
}
