# treasury — PLAN

**Version 0.1 — 2026-10-29**

A portfolio showpiece for **typed agents with custom harnesses, operating a clean
CLI surface with logged reasoned actions, orchestrated by delegation and
amalgamation.** The rigorous-and-pure pole. A double-entry ledger where
amalgamation is real algebra.

> Orientation for a future instance — study the sibling showpiece
> [**starship**](https://github.com/RaggedR/starship), which is **already built**:
> it is the working reference for the shared spine (the CLI surface, the two-layer
> log, the typed-agent registries, and the container plug). Lift its design here
> and change only the domain. This rests on the harness theory in `~/git/harness/`
> and the container framework in `~/git/gold/`.

---

## 1. Why this domain

- **Amalgamation is genuine algebra, not a gather.** Sub-account balances *sum* up
  the chart of accounts. The roll-up is a fold with real structure — debits and
  credits form a group, balances add — so this is the most honest demonstration
  of the "data flows up and composes" half of the framework. Compare the
  starship, where amalgamation is gathering reports into a list.
- **The gate is the hardest invariant of the set.** Double-entry — every posting's
  debits must equal its credits. A posting that does not balance is refused by
  construction, the purest smart constructor available.
- **Reconciliation is the whole point, not a bonus.** Accounting *is* the practice
  of cross-checking an independent record against reality. The two-layer log maps
  onto it with no stretching.
- **Deterministic and finishable.** A toy chart of accounts and a transaction
  journal are small, closed, and replay to the same balances every time.
- **Audience fit.** For Ghani and the `gold` authors, amalgamation-as-fold over a
  tree is more resonant than genre charm.

## 2. The CLI surface

One executable, working name `led`. A single-command CLI surface, exactly like
starship's `con` ([`src/cli/con.ts`](https://github.com/RaggedR/starship/blob/main/src/cli/con.ts)).

- Global flags — `--format json|table`, `--reason TEXT` (a memo) on every posting.
- Exit codes — `0` success, `1` refusal/failure to stderr.
- An append-only **journal** (the audit). Every committed posting is one JSONL
  line with a correlation id. The journal is immutable — corrections are new
  reversing entries, never edits. This is the accounting analogue of starship's
  append-only ship's log ([`src/log/shiplog.ts`](https://github.com/RaggedR/starship/blob/main/src/log/shiplog.ts)).

**Read (free, no reason):**

| Command | Returns |
|---|---|
| `balance --account A` | balance of one account, with its sub-accounts rolled up |
| `trial-balance` | every account, debits and credits, proving the books balance |
| `statement --account A [--from --to]` | the postings touching one account |
| `journal recent [--n N]` | recent journal entries |
| `journal trace <corr-id>` | one posting by correlation id |

**Mutate (audited, reason required):**

| Command | Effect | Gate (smart constructor) |
|---|---|---|
| `post --debit A:amt --credit B:amt --reason` | a balanced posting | debits must equal credits, accounts must exist, no overdraw past a floor |
| `open --account A --under PARENT` | add an account to the chart | name unique, parent exists |
| `reverse --entry <corr-id> --reason` | post the reversing entry | the target must exist and be un-reversed |
| `close --period P --reason` | roll income/expense into equity | only when the period balances |

The balance invariant is the demonstration. A `post` whose debits and credits
differ never commits — it is refused as a genuine position, exactly as
`check_permission` refuses in the toy harness (MacBeth's Note 5, *The toy harness
is a worker* — `~/git/harness/toy-harness-is-a-worker.pdf`, §5; sent in
`~/git/harness/2026-10-11-macbeth-reply-toy-harness-is-a-worker.txt`) and as
starship's gates refuse ([`src/world/gates.ts`](https://github.com/RaggedR/starship/blob/main/src/world/gates.ts)).

## 3. The agents — typed, with disjoint sub-surfaces

Each clerk is a custom harness whose **registry is a different sub-container of
the CLI** — the permission-as-allowlist model, as in starship's
[`src/bridge/harness.ts`](https://github.com/RaggedR/starship/blob/main/src/bridge/harness.ts).

| Agent | Allowed commands | Role |
|---|---|---|
| **Auditor** | `balance`, `trial-balance`, `statement`, `journal *` | read-only. Verifies the books balance and reconciles. A pure answerer — a thin leaf. |
| **Payables clerk** | `post` (restricted to liability/expense accounts) | records what the firm owes and spends. |
| **Receivables clerk** | `post` (restricted to asset/income accounts) | records what the firm is owed and earns. |
| **Controller** | `open`, `reverse`, `close`, holds period authority | delegates to the clerks, amalgamates sub-ledger balances, closes the period. |

The clerks' *restricted* `post` is the sharp illustration — the same command,
scoped to different account classes per agent, so the allowlist is not just "which
commands" but "which arguments."

## 4. The orchestration — gold delegation and amalgamation

This is the layer that plugs into `~/git/gold/dungeon/lib/algebra.ts`, and it is
the one where the `gold` framework shines hardest, because the domain's own
structure is a tree with an algebraic roll-up.

- **Control flows down.** The controller delegates "record this batch of invoices"
  to Receivables and "record this batch of bills" to Payables. Each clerk is a
  worker `∆S ⊗ X → Y`.
- **Data flows up and amalgamates — as a fold.** Sub-account balances compose into
  parent balances by addition, up the chart of accounts. This is the container /
  comonad aggregation `~/git/gold/org-chart/` already demonstrates as roll-up
  (`semilattice.py`, `orchestrate.py`), made exact by double-entry.
- **It nests.** A parent entity consolidates subsidiary ledgers — each subsidiary
  is a controller delegating to its own clerks, and its internal accounts are
  existentially hidden from the parent, which sees only the consolidated balance
  one position up. Consolidation is `~/git/gold/dungeon/harness.ts`'s descend, in
  accounting dress.
- **The gate is a smart constructor.** The balance invariant restricts which
  postings are legal positions at all.

## 5. The two-layer log — reuse starship's design

Built and working in starship — see
[`src/log/`](https://github.com/RaggedR/starship/tree/main/src/log) (`shiplog.ts`, `intentlog.ts`,
`reconcile.ts`). Re-theme it: "ship's log" → "journal", "officer" → "clerk".

- **Layer 1 — the journal (the CLI's audit).** Append-only, written by `led` when
  a posting commits. Records *what happened* with a correlation id. Note the
  domain already insists on append-only and reason-per-entry, which is why the fit
  is exact.
- **Layer 2 — the harness intent-log.** Written by each clerk's harness,
  write-ahead, before the posting runs. Records *why* beyond the memo — the
  clerk's reasoning for the posting, required on every mutation. Joined to the
  journal by the correlation id.
- **Reconciliation.** The auditor agent cross-checks the two, and this is
  literally an audit. A journal posting with no matching intent record is the
  alarm condition — a change to the books with no logged reasoning. A
  proposed-but-refused posting appears only in the intent-log.

## 6. Language plan

Follow starship's choice — it is already proven there (all TypeScript on Deno).

- **The orchestration and the leaf plugs — TypeScript.** The `Runner<C>` and its
  decoder carry the dependent typing `~/git/gold/dungeon/lib/algebra.ts` needs.
- **`led` and each clerk's harness — either.** A thin TypeScript leaf is the
  simplest first build. A thick Go leaf suits a clerk you want as a sealed binary.
- **Recommended first cut — all TypeScript**, with the ledger engine as a pure
  TypeScript module so the balance invariant is a plain total function the decoder
  can trust. Consider a Haskell or Lean core for the ledger algebra later if the
  showpiece is aimed at the formal-methods audience.

## 7. Milestones

1. **`led` with an in-memory ledger.** The chart of accounts, `post` with the
   balance invariant, the append-only journal, `balance` and `trial-balance`,
   `--format json`, exit codes. No agents. Driven by a scripted posting list.
2. **The rest of the surface and its gates.** `open`, `reverse`, `close`, and
   their invariants. Every refusal a logged position.
3. **The auditor as a leaf.** Read-only `Runner` behind a decoder, returning a
   typed "books balance / do not balance" verdict. Proves the plug against `gold`.
4. **The clerks.** Payables and Receivables with argument-scoped `post`
   registries, the controller amalgamating sub-ledger balances by fold, the
   reason-gate on every posting.
5. **Nesting — consolidation.** A parent entity consolidating subsidiary ledgers,
   with each subsidiary's accounts existentially hidden.
6. **Reconciliation + a printed trial balance.** The two-log cross-check run by
   the auditor, and a trial balance a stranger can read to see the books close.

## 8. Definition of done (as a showpiece)

A stranger runs one command, watches the controller delegate batches to the
clerks, sees each posting with its reason land in the journal, sees an
unbalanced posting refused, watches sub-ledger balances fold up into a trial
balance that closes, and reads the auditor's reconciliation — replaying to the
same balances twice.

---

## Cross-references

- Theory and SDK — `~/git/harness/` (start at `harness-engineering/start-here.tex`;
  the worker note is MacBeth's Note 5, *The toy harness is a worker* —
  `toy-harness-is-a-worker.pdf`, sent in
  `2026-10-11-macbeth-reply-toy-harness-is-a-worker.txt`).
- Container framework — `~/git/gold/` (plug-in contract in
  `dungeon/lib/algebra.ts`, the roll-up precedent in `org-chart/`, the boundary
  claim in `dungeon/harness.ts`).
- The built reference to lift from — the sibling [starship](https://github.com/RaggedR/starship):
  the shared spine implemented and tested. Reuse its `src/log/` (two-layer log),
  `src/bridge/harness.ts` (registry + reason-gate), and `src/lib/algebra.ts`
  (container combinators).
- The sibling showpiece's plan — [starship's PLAN.md](https://github.com/RaggedR/starship/blob/main/PLAN.md).
