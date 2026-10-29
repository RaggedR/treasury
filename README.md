# treasury

**Typed agents with custom harnesses, operating a clean CLI surface with logged
reasoned actions, orchestrated by delegation and amalgamation** — the
rigorous-and-pure pole. A double-entry ledger where **amalgamation is real
algebra**: sub-account balances *sum* up the chart of accounts, the gate is the
hardest invariant of the set (debits must equal credits), and reconciliation is
the whole point of accounting rather than a bonus.

> **Status: design, not yet built.** This repo is the plan
> ([`PLAN.md`](PLAN.md)) and the plain-English picture ([`english.txt`](english.txt)).
> Its sibling, [**starship**](https://github.com/RaggedR/starship), is **built and
> tested** — it is the working reference for the shared spine (CLI surface,
> two-layer log, typed-agent registries, container plug). Treasury lifts that
> design and changes only the domain, from a ship's bridge to a company's books.

The two are siblings: starship makes the *delegation and the who-may-touch-what*
vivid; treasury makes the *adding-up* honest, because here the reports really do
sum. See [`PLAN.md`](PLAN.md) for the full design.

The structural idea — a worker as a container morphism `∆S ⊗ X → Y`, the gate as a
smart constructor, nesting as existential hiding — is MacBeth's Note 5, *The toy
harness is a worker*.
