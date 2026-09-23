import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, UserRound } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

type UnblockOwner = { agentId: string } | { userId: string } | "board";

interface SelfBlockResolutionActionsProps {
  issueId: string;
  companyId: string;
  /** The issue's own statement of what it is waiting for, when it recorded one. */
  unblockAction: string | null;
  /** The owner the issue named for its own unblock, when it named one. */
  unblockOwner?: UnblockOwner | null;
  agentMap?: Map<string, Agent>;
  footerSlot?: ReactNode;
  className?: string;
}

/**
 * The two verbs that clear a *self-block* - a blocked issue that records no
 * blocker edge at all, so the liveness pass points its terminal blocker back at
 * the issue itself. There is nothing to wait on and nothing to chase, which is
 * why these actuate in-row instead of deep-linking.
 *
 * Both verbs are an ordinary issue update to an active status; the issue-update
 * path owns the resume wake. `Unblock` clears the block for the current owner.
 * `Reassign` picks a new owner first, which is the only way to clear a self-block
 * that has no assignee - the shape that used to sit invisible.
 */
export function SelfBlockResolutionActions({
  issueId,
  companyId,
  unblockAction,
  unblockOwner,
  agentMap,
  footerSlot,
  className,
}: SelfBlockResolutionActionsProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [ownerId, setOwnerId] = useState("");

  const resolve = useMutation({
    mutationFn: (assigneeAgentId?: string) =>
      issuesApi.update(issueId, {
        status: "todo",
        ...(assigneeAgentId ? { assigneeAgentId } : {}),
      }),
    onSuccess: (_result, assigneeAgentId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.attention(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId) });
      setOwnerId("");
      pushToast({
        title: assigneeAgentId ? "Reassigned and resumed" : "Unblocked",
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Could not clear the block",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "error",
      });
    },
  });

  const pending = resolve.isPending;
  const namedOwner =
    unblockOwner && typeof unblockOwner === "object" && "agentId" in unblockOwner
      ? agentMap?.get(unblockOwner.agentId)?.name ?? "another agent"
      : unblockOwner === "board"
        ? "you (the board)"
        : unblockOwner
          ? "you"
          : null;
  const owners = agentMap
    ? [...agentMap.values()].sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="text-xs text-muted-foreground">
        Blocked with no recorded blocker, so nothing is going to resolve this on its own.
      </p>
      {unblockAction ? (
        <p className="text-sm text-foreground" data-testid="self-block-action">
          It says it needs: {unblockAction}
        </p>
      ) : null}
      {namedOwner ? (
        <p className="text-xs text-muted-foreground" data-testid="self-block-owner">
          Owner it named: {namedOwner}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {footerSlot ?? <span className="hidden sm:block" />}
        <div className="flex flex-col gap-2 sm:flex-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {owners.length > 0 ? (
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm sm:w-auto"
              value={ownerId}
              disabled={pending}
              onChange={(event) => setOwnerId(event.target.value)}
              data-testid="self-block-owner-select"
              aria-label="Reassign to"
            >
              <option value="">Reassign to…</option>
              {owners.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={pending || ownerId.length === 0}
            onClick={() => resolve.mutate(ownerId || undefined)}
            data-testid="self-block-reassign"
          >
            {pending && resolve.variables ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <UserRound className="h-3.5 w-3.5" aria-hidden />
            )}
            Reassign
          </Button>
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() => resolve.mutate(undefined)}
            data-testid="self-block-unblock"
          >
            {pending && !resolve.variables ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            Unblock
          </Button>
        </div>
      </div>
    </div>
  );
}
