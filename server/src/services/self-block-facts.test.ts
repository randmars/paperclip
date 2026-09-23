import { describe, expect, it } from "vitest";
import type { IssueBlockerAttention } from "@paperclipai/shared";
import { readSelfBlockFacts } from "./self-block-facts.js";

function attention(overrides: Partial<IssueBlockerAttention> = {}): IssueBlockerAttention {
  return {
    state: "covered",
    reason: null,
    unresolvedBlockerCount: 0,
    coveredBlockerCount: 0,
    stalledBlockerCount: 0,
    attentionBlockerCount: 0,
    sampleBlockerIdentifier: null,
    sampleStalledBlockerIdentifier: null,
    ...overrides,
  };
}

describe("readSelfBlockFacts", () => {
  it("flags the zero-edge self-block (the shape that used to park silently)", () => {
    const facts = readSelfBlockFacts({
      blockerAttention: attention({ state: "needs_attention", reason: "attention_required" }),
      unblockDescriptor: { owner: { agentId: "agent-1" }, action: "Need Dify console access." },
    });
    expect(facts.selfBlocked).toBe(true);
    expect(facts.unresolvedBlockerCount).toBe(0);
    expect(facts.unblockDescriptor?.action).toBe("Need Dify console access.");
  });

  it("does NOT flag a real blocker edge, even when it also needs attention", () => {
    const facts = readSelfBlockFacts({
      blockerAttention: attention({
        state: "needs_attention",
        reason: "attention_required",
        unresolvedBlockerCount: 1,
        attentionBlockerCount: 1,
        sampleBlockerIdentifier: "RAN-70",
      }),
      unblockDescriptor: { owner: { agentId: "agent-1" }, action: "Wait on RAN-70." },
    });
    expect(facts.selfBlocked).toBe(false);
    expect(facts.unresolvedBlockerCount).toBe(1);
    expect(facts.unblockDescriptor?.action).toBe("Wait on RAN-70.");
  });

  it("does not flag a covered or stalled blocker tree", () => {
    expect(
      readSelfBlockFacts({
        blockerAttention: attention({ state: "covered", reason: "active_dependency" }),
      }).selfBlocked,
    ).toBe(false);
    expect(
      readSelfBlockFacts({
        blockerAttention: attention({ state: "stalled", reason: "stalled_review" }),
      }).selfBlocked,
    ).toBe(false);
  });

  it("treats a missing blockerAttention as not self-blocked", () => {
    const facts = readSelfBlockFacts({ unblockDescriptor: null });
    expect(facts.selfBlocked).toBe(false);
    expect(facts.unresolvedBlockerCount).toBe(0);
    expect(facts.unblockDescriptor).toBeNull();
  });
});
