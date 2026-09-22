import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  agents, companies, companyMemberships, connectionGrants, createDb, heartbeatRuns,
  issues, toolApplications, toolCatalogEntries, toolConnections, toolProfiles, toolProfileBindings,
} from "@paperclipai/db";
import { connectionIntentService } from "../services/connection-intents.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();

it.skipIf(!support.supported)("completes an agent GitHub request using the company PAT and reports ready", async () => {
  const temp = await startEmbeddedPostgresTestDatabase("paperclip-github-shared-pat-");
  try {
    const db = createDb(temp.connectionString);
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const userId = "company-admin";
    await db.insert(companies).values({ id: companyId, name: "Shared GitHub", issuePrefix: "PAT" });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "admin" });
    await db.insert(agents).values({ id: agentId, companyId, name: "Agent", role: "engineer", adapterType: "codex_local", status: "active" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Use GitHub", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, status: "running", responsibleUserId: userId, contextSnapshot: { issueId } });
    const claims = { sub: agentId, company_id: companyId, run_id: runId, responsible_user_id: userId, scope: "connection_intents" as const, iat: 1, exp: 2, instance_id: "test" };
    const service = connectionIntentService(db);
    const request = await service.request(claims, "github");
    expect(request.interactionId).toBeTruthy();
    const [application] = await db.insert(toolApplications).values({ companyId, applicationKey: "github", name: "GitHub", type: "mcp_http", status: "active", metadata: { sourceTemplateKey: "github" } }).returning();
    const [connection] = await db.insert(toolConnections).values({
      companyId, applicationId: application!.id, name: "Company GitHub", uid: "github/company",
      transport: "mcp_remote", authKind: "api_key", credentialPolicy: "shared", status: "active", enabled: true,
      healthStatus: "ok", config: { sourceTemplateKey: "github", connectionMethodKey: "mcp-key" },
    }).returning();
    await db.insert(connectionGrants).values({ companyId, connectionId: connection!.id, kind: "organization", isDefault: true, status: "active" });
    const [profile] = await db.insert(toolProfiles).values({ companyId, name: "GitHub reads", profileKey: "github-reads", defaultAction: "allow", status: "active" }).returning();
    await db.insert(toolProfileBindings).values({ companyId, profileId: profile!.id, targetType: "agent", targetId: agentId });
    await db.insert(toolCatalogEntries).values({ companyId, connectionId: connection!.id, toolName: "get_me", name: "get_me", versionHash: "fixture-v1", status: "active", entryKind: "tool" });
    await expect(service.complete(request.interactionId!, connection!.id, userId, { canManageOrganizationGrant: true }))
      .resolves.toMatchObject({ status: "accepted", result: { outcome: "connected", connectionId: connection!.id } });
    const result = await service.search(claims, "github");
    expect(result.results).toEqual([expect.objectContaining({ service: "github", state: "ready", connectionId: connection!.id })]);
  } finally {
    await temp.cleanup();
  }
}, 90_000);
