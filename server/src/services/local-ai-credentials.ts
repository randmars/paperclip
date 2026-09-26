import { readLocalAiCredentialFile } from "./local-ai-credential-file.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchClaudeQuota,
  parseClaudeCredential,
  readClaudeCredential,
  readIsolatedClaudeCredential,
} from "@paperclipai/adapter-claude-local/server";
import { readCodexAuthInfo, fetchCodexQuota } from "@paperclipai/adapter-codex-local/server";
import { parseGrokAuthPayload, hasUsableGrokAuthValue } from "@paperclipai/adapter-grok-local/server";
import type { AiProvider } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

/** Read an owned login home, or an explicitly authorized local-operator import. */
export async function readVerifiedLocalAiCredential(provider: AiProvider, loginHome?: string): Promise<string> {
  if (provider === "openrouter") throw unprocessable("OpenRouter requires an API key.");
  if ((provider === "openai" || provider === "xai") && !loginHome)
    throw unprocessable("Start a separate local sign-in for this connection before connecting.");
  try {
    if (provider === "anthropic") {
      // Never change process.env or fall back to the server account when an
      // authenticated user's isolated login is missing or invalid.
      let credential: string | null = null;
      if (loginHome) {
        for (const name of [".credentials.json", "credentials.json"]) {
          const raw = await readLocalAiCredentialFile(path.join(loginHome, name)).catch(() => null);
          if (!raw) continue;
          const parsed = parseClaudeCredential(raw);
          if (!parsed) continue;
          if (parsed.expiresAt != null && parsed.expiresAt <= Date.now() && !parsed.refreshToken) continue;
          credential = raw;
          break;
        }
        // On macOS the CLI stores the isolated login in the auth home's own
        // suffixed Keychain item rather than a credentials file. The helper
        // never consults the unsuffixed operator item.
        if (!credential) credential = await readIsolatedClaudeCredential(loginHome);
      } else {
        credential = await readClaudeCredential({ allowKeychain: true });
      }
      const parsed = credential ? parseClaudeCredential(credential) : null;
      if (!credential || !parsed) throw new Error("Missing login");
      // Claude Code can refresh an expired access token when the imported
      // document still contains its refresh token. Do not reject that
      // durable credential merely because its short-lived access token aged
      // out before the next managed run.
      if (parsed.expiresAt == null || parsed.expiresAt > Date.now()) {
        await fetchClaudeQuota(parsed.token);
      } else if (!parsed.refreshToken) {
        throw new Error("Expired login");
      }
      return credential;
    }
    if (provider === "openai") {
      const auth = await readCodexAuthInfo(loginHome);
      if (!auth?.accessToken || !auth.refreshToken || !auth.idToken) throw new Error("Missing login");
      await fetchCodexQuota(auth.accessToken, auth.accountId);
      return JSON.stringify({ tokens: { access_token: auth.accessToken, refresh_token: auth.refreshToken, id_token: auth.idToken, account_id: auth.accountId }, last_refresh: auth.lastRefresh });
    }
    const raw = await fs.readFile(path.join(loginHome!, "auth.json"), "utf8");
    const payload = parseGrokAuthPayload(JSON.parse(raw));
    if (!payload || !hasUsableGrokAuthValue(payload.value)) throw new Error("Missing login");
    const response = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${payload.value.key}` },
      redirect: "error", signal: AbortSignal.timeout(15000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Invalid login");
    return raw;
  } catch {
    // Provider/CLI errors may contain credential material; never return them.
    throw unprocessable(provider === "anthropic" && !loginHome
      ? "Could not verify the local subscription. Run claude auth login in a terminal on the machine running Paperclip, then try Connect again."
      : "Could not verify the local subscription. Run the sign-in command shown for this connection, finish signing in, then try Connect again.");
  }
}
