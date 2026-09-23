import type { IssueUnblockDescriptor } from "@paperclipai/shared";

/**
 * Facts about a blocked issue that records no blocker edge at all.
 *
 * The blocker-liveness pass in `services/issues.ts` stamps exactly these rows
 * `needs_attention` / `attention_required` and points `terminalBlockerIssueId`
 * back at the issue itself, because it has no dependency tree to walk. That
 * makes them the one blocker shape an operator can clear directly: there is no
 * trailing blocker to chase, only the issue's own statement of what it needs.
 *
 * They are also the shape that used to park silently. The card said "blocks 0
 * tasks and needs human attention", offered Unblock / Reassign / Nudge, and set
 * `inlineResolvable: false`, so nothing could act on it and nothing could exit
 * on its own - the card's exit rule ("the blocking tree becomes live") can never
 * fire when no tree exists.
 */
export interface SelfBlockFacts {
  /** Blocked with no recorded blocker edge: the terminal blocker is the issue itself. */
  selfBlocked: boolean;
  /** Blocker edges the liveness pass counted. Zero on a self-block. */
  unresolvedBlockerCount: number;
  /** The issue's own statement of what it is waiting for, when it recorded one. */
  unblockDescriptor: IssueUnblockDescriptor | null;
}

export function readSelfBlockFacts(issue: {
  /**
   * Structurally minimal on purpose. The feed's own `BlockedAttentionIssue`
   * carries a loose partial of `blockerAttention`, while callers holding a full
   * row hand over `IssueBlockerAttention`. Only these three facts matter here.
   */
  blockerAttention?: {
    state?: string | null;
    reason?: string | null;
    unresolvedBlockerCount?: number | null;
  } | null;
  unblockDescriptor?: IssueUnblockDescriptor | null;
}): SelfBlockFacts {
  const attention = issue.blockerAttention ?? null;
  const unresolvedBlockerCount = attention?.unresolvedBlockerCount ?? 0;
  return {
    selfBlocked:
      attention?.state === "needs_attention" &&
      attention.reason === "attention_required" &&
      unresolvedBlockerCount === 0,
    unresolvedBlockerCount,
    unblockDescriptor: issue.unblockDescriptor ?? null,
  };
}
