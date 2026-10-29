// harness.ts — the clerk's custom harness: the layer that logs WHY and enforces the
// hard boundaries (the registry, the argument-scope, and the reason-gate).
//
//   Registry = permission. Each clerk carries an allowlist of led commands. A command
//     not in the allowlist cannot be invoked — refused before led, with no generic
//     "bash" escape hatch. (The container TYPE already prevents asking a clerk an
//     out-of-surface shape; this is the same gate at runtime, for defence in depth and
//     so the permission is visible in the log.)
//
//   Argument-scope = permission on the ARGUMENTS, not just the command. The two clerks
//     share one command, `post`, but it is fenced to different account CLASSES: the
//     payables clerk may touch only liability/expense accounts, the receivables clerk
//     only asset/income. "The permission is not only which command but which accounts
//     it may touch" (english.txt). A posting that reaches outside a clerk's classes is
//     refused as a logged position — indistinguishable, from the controller, from an
//     unbalanced posting the ledger gate rejected.
//
//   Reason required. A mutating call with an empty reason is refused BEFORE led runs,
//     and the refusal is recorded in the intent-log.
//
// Write-ahead: append `attempted` before led runs, an outcome record after, both
// sharing one call_id. The correlation id is minted here and handed to led via --corr.

import type { Clock, IdSource } from "../log/ids.ts";
import type { IntentLog, IntentRecord } from "../log/intentlog.ts";

/** What a clerk's harness can do with the led surface, injected so the demo and tests
 *  can point it at in-memory or file-backed led without the clerk knowing. */
export type ConRun = (argv: string[]) => { value: unknown };

export type HarnessCtx = {
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly intentLog: IntentLog;
  readonly sessionId: string;
  readonly ledRun: ConRun;
};

/** A clerk's identity and registry. The allowlist IS the permission grant; the
 *  optional `argScope` fences the ARGUMENTS of a command (see file header). */
export type Registry = {
  readonly agentId: string; // e.g. "clerk:payables"
  readonly allowed: ReadonlySet<string>; // led commands this clerk may invoke
  /** Returns a refusal reason if the args are out of this clerk's scope, else null. */
  readonly argScope?: (tool: string, args: Record<string, unknown>) => string | null;
};

export type MutationOutcome =
  | { readonly ok: true; readonly correlationId: string; readonly result: unknown }
  | { readonly ok: false; readonly reason: string };

/** Log a read: one combined record, mutates:false, no reason, no correlation. */
export function logRead(
  ctx: HarnessCtx,
  agentId: string,
  tool: string,
  args: Record<string, unknown>,
): void {
  ctx.intentLog.append({
    call_id: ctx.ids.next(),
    ts: ctx.clock.now(),
    agent_id: agentId,
    session_id: ctx.sessionId,
    tool,
    args,
    reason: "",
    mutates: false,
    status: "ok",
    correlation_id: "",
  });
}

/** Read through led: checks the allowlist, logs a read record, returns led's parsed
 *  result. A read never commits and never writes the journal. */
export function ledRead(
  ctx: HarnessCtx,
  reg: Registry,
  tool: string,
  argv: string[],
  args: Record<string, unknown>,
): unknown {
  if (!reg.allowed.has(tool)) {
    throw new Error(`${tool} is not in ${reg.agentId}'s registry`);
  }
  logRead(ctx, reg.agentId, tool, args);
  return ctx.ledRun(argv).value;
}

/** Run a mutating led command through the full gate: registry check, argument-scope
 *  check, reason gate, write-ahead intent, led invocation with --corr, outcome record.
 *  Returns a typed outcome — never throws for an ordinary refusal (a refusal is a
 *  position). */
export function runMutation(
  ctx: HarnessCtx,
  reg: Registry,
  tool: string,
  argv: string[],
  args: Record<string, unknown>,
  reason: string,
): MutationOutcome {
  const base = (status: IntentRecord["status"], extra: Partial<IntentRecord>): IntentRecord => ({
    call_id: extra.call_id ?? ctx.ids.next(),
    ts: ctx.clock.now(),
    agent_id: reg.agentId,
    session_id: ctx.sessionId,
    tool,
    args,
    reason,
    mutates: true,
    status,
    correlation_id: extra.correlation_id ?? "",
    ...extra,
  });

  // Registry gate — the allowlist, enforced by presence.
  if (!reg.allowed.has(tool)) {
    ctx.intentLog.append(base("refused", {}));
    return { ok: false, reason: `${tool} is not in ${reg.agentId}'s registry` };
  }
  // Argument-scope gate — the allowlist on the ARGUMENTS (which accounts).
  const scopeViolation = reg.argScope?.(tool, args) ?? null;
  if (scopeViolation) {
    ctx.intentLog.append(base("refused", {}));
    return { ok: false, reason: scopeViolation };
  }
  // Reason gate — a mutating order with no reason never reaches led.
  if (!reason || reason.trim() === "") {
    ctx.intentLog.append(base("refused", {}));
    return { ok: false, reason: `${tool} requires a non-empty reason` };
  }

  const callId = ctx.ids.next();
  const correlationId = ctx.ids.next();
  // write-ahead: record the attempt BEFORE anything commits.
  ctx.intentLog.append(base("attempted", { call_id: callId, correlation_id: correlationId }));

  const fullArgv = [...argv, "--reason", reason, "--corr", correlationId];
  try {
    const { value } = ctx.ledRun(fullArgv);
    ctx.intentLog.append(base("ok", { call_id: callId, correlation_id: correlationId, exit_code: 0 }));
    return { ok: true, correlationId, result: value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A gate refusal inside led lands here: logged as refused, NOT ok. No journal entry
    // exists for it — visible only in Layer 2.
    ctx.intentLog.append(base("refused", { call_id: callId, correlation_id: correlationId, exit_code: 1 }));
    return { ok: false, reason: msg };
  }
}
