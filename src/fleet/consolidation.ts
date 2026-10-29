// consolidation.ts — nesting: a group's books are just ledgers nested inside a ledger
// (english.txt).
//
// A parent entity consolidates the ledgers of its subsidiaries. It delegates not to
// clerks but to the CONTROLLER of each subsidiary, who runs their own desk below over
// their own books. The parent never sees inside a subsidiary — it only receives one
// consolidated balance from each, rolled up and handed upward. This is MacBeth Note 5
// §4 exactly: spawn is worker composition, the child's store is existentially hidden,
// the parent amalgamates only the child's single returned position.
//
// The hiding is enforced by the TYPE: a subsidiary controller is a Runner<ControllerC>
// whose position is EntityReport. The subsidiary's chart of accounts, its clerks, its
// journal, the folded category breakdown — none of them appear in the parent's type.
// The parent literally cannot reach them; it sees one consolidated figure.

import { leafLocal, type Runner } from "../lib/algebra.ts";
import type { Money } from "../ledger/types.ts";
import type { ControllerC, EntityReport } from "../bridge/containers.ts";
import { type Chart } from "../bridge/clerks.ts";
import { closePeriod, type Entry, handleBatches } from "../bridge/controller.ts";
import type { HarnessCtx } from "../bridge/harness.ts";

function decodeEntityReport(u: unknown): EntityReport | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  return typeof r.entity === "string" && typeof r.posted === "number" &&
      typeof r.refused === "number" && typeof r.balanced === "boolean" &&
      typeof r.netAssets === "number"
    ? {
      entity: r.entity,
      posted: r.posted,
      refused: r.refused,
      balanced: r.balanced,
      netAssets: r.netAssets as Money,
    }
    : null;
}

/** The batches a subsidiary's controller is to process this period. */
export type SubsidiaryWork = {
  readonly ctx: HarnessCtx; // the subsidiary's OWN harness over its OWN books
  readonly chart: Chart;
  readonly invoices: readonly Entry[];
  readonly bills: readonly Entry[];
  readonly period?: string; // if set, the controller closes the period after posting
};

/** One subsidiary's controller, as a Runner the parent can delegate to. It processes
 *  its OWN batches over its OWN books (ctx), optionally closes the period, and condenses
 *  everything to a single EntityReport. Everything richer than that report — the chart,
 *  the per-category fold, the journal — stays hidden on this level. */
export function subsidiaryController(work: SubsidiaryWork): Runner<ControllerC> {
  return leafLocal<ControllerC>(
    "controller:subsidiary",
    async (shape) => {
      const report = await handleBatches(
        work.ctx,
        work.chart,
        shape.entity,
        work.invoices,
        work.bills,
      );
      if (work.period) {
        closePeriod(work.ctx, shape.entity, work.period, `period close for ${shape.entity}`);
      }
      // Only this crosses back up — the folded categories and the journal do not.
      return {
        entity: shape.entity,
        posted: report.posted,
        refused: report.refused,
        balanced: report.trialBalanced,
        netAssets: report.netAssets,
      };
    },
    { consolidate: decodeEntityReport },
  );
}

export type GroupReport = {
  readonly entities: readonly EntityReport[];
  readonly groupNetAssets: Money; // the sum of the subsidiaries' net assets — the fold, one level up
  readonly allBalanced: boolean;
  readonly summary: string;
};

/** The parent: delegate the period to each subsidiary's controller, amalgamate the
 *  one consolidated balance that comes back from each. Sequential, so each subsidiary's
 *  books and logs are written in a deterministic order (the DoD wants byte-identical
 *  replays). The amalgamation here is again a FOLD — the group's net assets are the sum
 *  of its subsidiaries', one level up the nesting. */
export async function consolidate(
  subsidiaries: readonly { readonly entity: string; readonly controller: Runner<ControllerC> }[],
): Promise<GroupReport> {
  const entities: EntityReport[] = [];
  for (const s of subsidiaries) {
    entities.push(await s.controller.run({ tag: "consolidate", entity: s.entity }, 1));
  }
  const groupNetAssets = entities.reduce((sum, e) => sum + e.netAssets, 0);
  const allBalanced = entities.every((e) => e.balanced);
  return {
    entities,
    groupNetAssets,
    allBalanced,
    summary: `${entities.length} subsidiaries consolidated, ` +
      `${allBalanced ? "all balanced" : "A SUBSIDIARY IS OUT OF BALANCE"}`,
  };
}
