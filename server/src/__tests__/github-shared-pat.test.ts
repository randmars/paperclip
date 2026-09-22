import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionGrants, toolConnectionInstalls, toolConnections, type Db } from "@paperclipai/db";
import { createGitRemoteAuthProvider, filterResolvedGitHubConnectionsForRun, resolveManagedGitHubCredential, resolveManagedGitHubIdentitySelection } from "../services/git-credentials.js";

function fixture() {
  const connection = {
    id: "github", companyId: "company", authKind: "api_key", credentialPolicy: "shared",
    transport: "mcp_remote", enabled: true, status: "active", healthStatus: "ok",
    config: { sourceTemplateKey: "github", connectionMethodKey: "mcp-key" },
  };
  const grant = {
    id: "shared", companyId: "company", connectionId: "github", kind: "organization",
    isDefault: true, status: "active", createdAt: new Date(), providerTenant: null,
    credentialSecretRefs: [{ configPath: "credentials.authorization", secretId: "secret", versionSelector: 2 }],
  };
  const rows: Record<string, unknown>[] = [grant];
  const installs = [{ companyId: "company", connectionId: "github", targetType: "company", targetId: "company" }];
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: async () => {
      if (table === toolConnections) return [connection];
      if (table === toolConnectionInstalls) return installs;
      if (table === connectionGrants) return rows;
      return [];
    } }) }),
  } as unknown as Db;
  const secrets = { getByName: vi.fn(), resolveSecretValue: vi.fn().mockResolvedValue("test-pat") };
  return { db, connection, grant, rows, installs, secrets };
}
afterEach(() => vi.unstubAllGlobals());

describe("explicitly installed organization GitHub PAT", () => {
  it("selects the shared grant for responsible and ownerless runs, and retains MCP tools", async () => {
    const f = fixture();
    for (const responsibleUserId of ["person", null]) {
      await expect(resolveManagedGitHubIdentitySelection(f.db, "company", { agentId: "agent", responsibleUserId }))
        .resolves.toMatchObject({ configured: true, identitySource: "organization", grant: { id: "shared" } });
    }
    await expect(filterResolvedGitHubConnectionsForRun({ db: f.db, companyId: "company", agentId: "agent", connections: [f.connection] }))
      .resolves.toEqual([f.connection]);
  });

  it("requires installation for the current company or agent", async () => {
    const f = fixture();
    f.installs[0] = { ...f.installs[0], targetType: "agent", targetId: "another-agent" };
    await expect(resolveManagedGitHubIdentitySelection(f.db, "company", { agentId: "agent" }))
      .resolves.toEqual({ configured: false });
  });

  it.each(["oauth", "other-method", "per_user"])("does not adopt unsupported organization identity %s", async (mode) => {
    const f = fixture();
    if (mode === "oauth") f.connection.authKind = mode;
    if (mode === "other-method") f.connection.config.connectionMethodKey = mode;
    if (mode === "per_user") f.connection.credentialPolicy = mode;
    expect((await resolveManagedGitHubIdentitySelection(f.db, "company", { agentId: "agent" })).grant).toBeUndefined();
  });

  it.each(["user", "agent"])("does not bypass an unavailable higher-priority %s identity", async (kind) => {
    const f = fixture();
    f.rows.push({ ...f.grant, id: "specific", kind, isDefault: false, status: "revoked",
      subjectAgentId: kind === "agent" ? "agent" : null, subjectUserId: kind === "user" ? "person" : null });
    const selection = await resolveManagedGitHubIdentitySelection(f.db, "company", { agentId: "agent", responsibleUserId: "person" });
    expect(selection.grant).toBeUndefined();
    expect(selection.error).toContain("reconnected");
  });

  it("rejects ambiguous shared grants and revoked/disabled identities", async () => {
    const f = fixture();
    f.rows.push({ ...f.grant, id: "second" });
    expect((await resolveManagedGitHubIdentitySelection(f.db, "company", { agentId: "agent" })).error).toContain("More than one");
    f.rows.pop();
    f.grant.status = "revoked";
    expect((await resolveManagedGitHubIdentitySelection(f.db, "company", { agentId: "agent" })).grant).toBeUndefined();
    f.grant.status = "active";
    f.connection.enabled = false;
    expect((await resolveManagedGitHubIdentitySelection(f.db, "company", { agentId: "agent" })).grant).toBeUndefined();
  });

  it("resolves only the selected vaulted version, validates /user, and projects Git auth", async () => {
    const f = fixture();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 42, login: "test-user" })));
    vi.stubGlobal("fetch", fetch);
    const provider = createGitRemoteAuthProvider(f.db, "company", { agentId: "agent", responsibleUserId: "person" }, { secrets: f.secrets, env: { GH_TOKEN: "must-not-use" } });
    const auth = await provider("git@github.com:test-user/repo.git");
    expect(auth?.env.GH_TOKEN).toBe("test-pat");
    expect(auth?.env.GIT_AUTHOR_EMAIL).toBe("42+test-user@users.noreply.github.com");
    expect(JSON.stringify(auth?.configArgs)).not.toContain("test-pat");
    expect(f.secrets.getByName).not.toHaveBeenCalled();
    expect(f.secrets.resolveSecretValue).toHaveBeenCalledWith("company", "secret", 2, {
      accessContext: expect.objectContaining({ consumerId: "workspace-git-credential", actorId: "agent", responsibleUserId: "person" }),
    });
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/user", expect.objectContaining({
      redirect: "error", signal: expect.any(AbortSignal), headers: expect.objectContaining({ Authorization: "Bearer test-pat" }),
    }));
  });

  it.each(["missing", "empty", "revoked", "invalid-user", "provider-error"])("fails closed without leaking a %s credential", async (failure) => {
    const f = fixture();
    if (failure === "missing") f.grant.credentialSecretRefs = [];
    if (failure === "empty") f.secrets.resolveSecretValue.mockResolvedValue("");
    if (failure === "provider-error") f.secrets.resolveSecretValue.mockRejectedValue(new Error("test-pat"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "bad", login: "bad\nidentity" }), { status: failure === "revoked" ? 401 : 200 })));
    const result = await resolveManagedGitHubCredential(f.db, f.secrets, "company", { agentId: "agent" });
    expect(result.configured).toBe(true);
    expect(result.credential).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("test-pat");
    expect(f.secrets.getByName).not.toHaveBeenCalled();
  });
});
