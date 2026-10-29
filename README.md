# treasury

**Typed agents with custom harnesses, operating a clean CLI surface with logged
reasoned actions, orchestrated by delegation and amalgamation** — the
rigorous-and-pure pole. A double-entry ledger where **amalgamation is real algebra**:
sub-account balances *sum* up the chart of accounts, the gate is the hardest invariant
of the set (debits must equal credits), and reconciliation is the whole point of
accounting rather than a bonus.

See [`PLAN.md`](PLAN.md) for the full design and [`english.txt`](english.txt) for the
plain-English picture. The structural idea — a worker as a container morphism
`∆S ⊗ X → Y`, the gate as a smart constructor, nesting as existential hiding — is
MacBeth's Note 5, *The toy harness is a worker*
(`~/git/harness/toy-harness-is-a-worker.pdf`), sent in
`~/git/harness/2026-10-11-macbeth-reply-toy-harness-is-a-worker.txt`.

Its sibling, [**starship**](https://github.com/RaggedR/starship), makes the *delegation
and the who-may-touch-what* vivid; treasury makes the *adding-up* honest, because here
the reports really do sum. The two share a spine (CLI surface + two-layer log +
typed-agent allowlists + container orchestration) and differ only in domain.

## Run it

Requires [Deno](https://deno.com) (2.x).

```bash
deno task demo     # the whole showpiece in one run (~1 min to read)
deno task test     # 23 unit/contract tests
deno task check    # type-check — the typed gold plug compiling is the point
./verify.sh        # check + test + prove the demo replays byte-identically
```

Drive the CLI directly:

```bash
deno task led -- post --debit ar:500 --credit sales:500 --reason "invoice #1182"
deno task led -- trial-balance --format table
deno task led -- balance --account assets          # the fold: cash + AR, rolled up
deno task led -- post --debit ar:100 --credit sales:90 --reason "typo"  # refused: debits ≠ credits
```

(State persists to `treasury-state.json` and `journal.jsonl` in the working directory;
delete them to reset.)

## What the demo shows

1. A **chart of accounts** as a tree — category balances are pure roll-ups of the leaves.
2. The **controller delegates**: hands a batch of invoices to Receivables and a bill to
   Payables, each clerk posts with a reason, and the controller **amalgamates the
   category balances by fold** (each a roll-up of its subtree — real addition, not a
   gather).
3. **Two illegal postings refused** — one that does not balance (debits ≠ credits) and
   one where a clerk reaches outside its permitted account classes. From the controller,
   each is indistinguishable from a broken tool.
4. The **controller closes the period** — income and expense roll into equity — and the
   **trial balance closes** (debits = credits).
5. The **two logs**: Layer 1 (journal — *what* committed, append-only) and Layer 2
   (intent-log — *why*, and what was only attempted or refused).
6. **Reconciliation** run by the auditor cross-checks them, then catches a posting made
   *outside* the harness — a change to the books with no logged reason — which the
   journal alone could never reveal.
7. **Consolidation**: a parent entity consolidates two subsidiaries, seeing only each
   one's single consolidated balance — never its accounts or journal.

## Layout

| Path | What |
|---|---|
| `src/ledger/` | the deterministic ledger: `types`, `ledger` (reducers + the roll-up **fold**), `gates` (smart constructors), `seed`, `store` |
| `src/log/` | `ids` (seeded/real seams), `journal` (Layer 1), `intentlog` (Layer 2), `reconcile` |
| `src/lib/algebra.ts` | the gold container combinators (`sumC/tensorC/productC/seqC`, `Runner`), vendored in-process |
| `src/cli/` | `led` (the executable) and `format` (json/table + the printed trial balance) |
| `src/bridge/` | `containers` (each clerk's typed surface), `clerks`, `harness` (registry + argument-scope + reason-gate + intent-log), `controller` |
| `src/fleet/consolidation.ts` | nesting — a parent consolidating subsidiary ledgers |
| `src/demo.ts`, `verify.sh` | the end-to-end demo and its determinism check |

## Design anchors

- **Gates in `src/ledger/gates.ts`** — debits = credits, accounts exist, no overdraw past
  a floor, parent exists, un-reversed, period balances. Each returns `Ok(effect) |
  Refused(reason)`; a refusal is a *position*, not an exception.
- **The fold in `src/ledger/ledger.ts`** — `rollup` sums an account's whole subtree, so a
  category balance exists *only* as the sum of its leaves. This is amalgamation as real
  algebra (`~/git/gold/org-chart/`'s roll-up, made exact by double-entry).
- **The registry is the permission grant** (`src/bridge/harness.ts`) — each clerk carries
  an allowlist of `led` commands **and an argument-scope**: the same `post` command is
  fenced to different account classes per clerk (Payables → liability/expense,
  Receivables → asset/income). The permission is not only which command but which
  accounts it may touch.
- **The reason-gate** — a posting with no reason is refused before `led`, and the refusal
  is recorded in Layer 2.
- **Determinism** — ids and the clock are injectable seams (`seededIds`/`fixedClock` for
  the demo, `realIds`/`realClock` for real use), and money is integer cents, so the demo
  replays byte-identically.

## Cross-references

- Theory — MacBeth's Note 5, *The toy harness is a worker*
  (`~/git/harness/toy-harness-is-a-worker.pdf`).
- Container framework — `~/git/gold/` (plug-in contract in `dungeon/lib/algebra.ts`, the
  roll-up precedent in `org-chart/`).
- The sibling showpiece — [starship](https://github.com/RaggedR/starship), the shared
  spine this lifts.
