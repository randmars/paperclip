# Paperclip Operations Runbook — randm + Mitsui

> Living document for the self-hosted Paperclip deployment on `mars-grace`.
> Covers architecture, current state, hard-won operational lessons, and the
> Mitsui → randm consolidation plan. Last updated: 2026-09-23.

## 1. Deployment architecture

| Component | Location | Notes |
|---|---|---|
| Paperclip server | `mars-grace` host, compose project `paperclip` | Container `paperclip-paperclip-1`, API on `127.0.0.1:3100`, public UI `https://mars-grace.lykoi-beta.ts.net:8444` |
| Source checkout | `mars-grace:/home/randy/docker/paperclip` | Clone of `paperclipai/paperclip`, branch `wip/tree-triage-2026-09-22`; local fork push target `randmars/paperclip` |
| Data dir | `/home/randy/docker/paperclip-data` | Mounted at `/paperclip` (DB, vault, agent workspaces, instructions) |
| Board API key | `/home/randy/.paperclip-board-key` | Bearer token for `GET/POST http://127.0.0.1:3100/api/...` (operator-scope) |
| Provider routing | 9-router (local) + native subscriptions | Grok + Claude subscription connections per company; OpenAI ChatGPT account drives Codex agents |
| Image | `paperclip-dev-3753:shared-github-pat` | Local build; contains the codex-local model catalog patch (see §4.1) |
| Networks | `docker_default` (192.168.32.x) + `paperclip_default` | Container is dual-homed; host gateway `192.168.32.1` reachable from Paperclip |

Compose files actually used (from `paperclip-recreate.sh`):
`docker/docker-compose.quickstart.yml` + `docker-compose.integration.yml`
(+ a dev hotfix overlay). **`docker/docker-compose.buffy-9router.yml` is
wrong** — it declares an external network `bridge`, but 9-router reachability
comes from `docker_default`. Do not `docker compose up` with it. This is fixed
in this repo's commit; keep it fixed after upstream pulls.

## 2. Companies

### randm (main) — `ce9d4abb-af15-4450-a367-5a7f849978b7`
- 16 agents (leads per business line + workers: `clod`, `gitkat`, `clippy`, `Harbor`, `rox`, …), 1 routine
- 90 issues; active connections: GitHub, Linear, Wix, Grok, OpenAI, Claude subscriptions, Clippy (Slack), GitHub—gitkat
- heLLM service token already provisioned (see `secret-sync-map.json`, never commit)

### Mitsui (proof of concept) — `c58bae20-f32e-43a0-9dc9-6d5074632775`
- 4 agents: Mitsui CTO (`cto` role), Frontend, Backend, QA Engineer — all `codex_local`, model `gpt-5.6-luna`, effort `high`, `dangerouslyBypassApprovalsAndSandbox: true`
- 142 issues (54 done, 70 in-progress, 8 backlog, 5 blocked, 4 in-review)
- 2 routines: Pastel feedback sync (canvas 964116 → MIT issues, runbook on MIT-20), daily project-memory
- Connections: Pastel (active/ok), Linear (active/ok), GitHub (active/ok), Wix (active/`error`), Slack for Mitsui CTO (active), Grok + Claude subscriptions (active); Gmail + Drive stay `draft` (see §4.4); two archived dead Pastel MCP rows
- Instructions live at `/paperclip/instances/default/companies/<cid>/agents/<agent-id>/instructions/AGENTS.md` (managed mode)

**Decision (2026-09-23, Rand):** consolidate Mitsui into randm. The separate
company proved the CTO-style structure works, but two orgs split attention;
randm is where the momentum is. Migration plan in §5.

## 3. Agent model policy

**Approved models for `codex_local` on this deployment (ChatGPT-account Codex):
`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` (current standard), `gpt-5.5`,
`gpt-6-astra` (explicitly NOT for Mitsui per Rand — too powerful).**

Everything else that used to be in the picker (`gpt-5.4*`, `gpt-5*`, `o3*`,
`o4-mini`, `codex-mini-latest`) is API-key-era and is rejected with
`400 … not supported when using Codex with a ChatGPT account`, which the ACP
engine classifies as a terminal service failure — the run dies instantly and
the agent drops to `error`. This killed 16 agents once (2026-09-23 ~04:51).
The catalog is patched (§4.1) so those slugs no longer appear.

Recovery procedure if an agent is found in `error` with instant failures:
1. Check the run error text (run ledger) for the 400 model message.
2. PATCH the agent's `adapterConfig.model` to `gpt-5.6-luna`.
3. Clear the error state + wake with a fresh session (POST wake endpoint).
   A stale continuation (`continuation_source_context_missing`) needs the
   fresh-session wake, not a plain retry.

## 4. Hard-won operational lessons

### 4.1 Codex model catalog patch (committed in this repo)
`packages/adapters/codex-local/src/index.ts` — `models` list limited to the
five verified models with an explanatory comment. Applied to the repo AND the
running container (`docker cp`), then `docker restart paperclip-paperclip-1`.
Upstream rebuilds keep the fix because it's in the checkout. Backups:
`*.bak-codex-models-20260923-013910`.

### 4.2 Restart mechanics
`docker restart` preserves networks — use it, not `docker compose up`, while
the compose override network mismatch exists. In-flight runs get interrupted
by a restart and resume automatically; expect two `succeeded` entries per
interrupted issue.

### 4.3 Connector model (verified at schema level)
`toolConnections` / `toolApplications` / `toolGrants` are all keyed by
`companyId`; all tool routes are `/companies/:companyId/tools/...` with a
per-company `tools:admin` gate. **Connections cannot be shared between
companies by design** — the same upstream account is authorized once per
company (separate vault grants). Example: the Linear OAuth app "paperclips"
lists both redirect URIs (`:3100` randm, `:8444` Mitsui).

### 4.4 Google Workspace (Gmail/Drive/Docs) — dead path, do not retry
The "Connect with Paperclip" broker route uses Paperclip's own Google client
(`583045679430-…`), which Google has **disabled** (`disabled_client` —
unverified app), and every Google Workspace app additionally requires
**Google Workspace MCP Developer Preview** enrollment. If ever needed: apply
for the preview, create a Cloud OAuth client with redirect
`https://mars-grace.lykoi-beta.ts.net:8444/api/tools/oauth/callback`, then use
the "Use your own Google OAuth app" (customer-draft-oauth) path. Note Gmail
here is read + create-drafts only; sending is permanently disabled. Delivery
workaround: agents produce plain text; Rand sends from his own mail client.

### 4.5 heLLM Missive pipeline (explored 2026-09-23, parked)
heLLM (`hellm-server` container, host-networked, `192.168.100.2:3201`, also
reachable at gateway-reachable addresses) owns the Missive PAT and exposes:
- `POST /api/missive/agent-outputs` — enqueue `post`/`draft`/`skip`.
  Machine auth = Manny capability token (`moc1.` HMAC, 15-min TTL, bound to
  one conversation+run; allows `post`/`skip`, `internal_only` only).
  Human-session auth required for `draft` (`confirmed=true` + `approval_ref`
  + active human). `GET /` lists queue; `POST /:id/retry` requeues deadletter.
- Roi MCP gateway `/mcp` — research/read-only tools only (`MCP_READ_ONLY=1`),
  **no Missive tools**.
- `/api/v1` (`hk_…` bearer) — `POST /threads/:id/messages` is drafts-only
  (direction=draft enforced, voice-lint gate).
A Paperclip-side bridge was scoped but parked when the consolidation decision
landed. Internal posts into an existing Missive conversation are the safe
automatable surface; drafts/sends stay human.

### 4.6 Board hygiene patterns
- `blocked` status with no real blocker relation = orphan parking; the desk
  generates false "needs human" cards. Park client-blocked work in `backlog`
  with the reason in the description instead.
- Duplicate desk cards (same integration requested on several issues): keep
  the canonical one, decline duplicates with a reason — declining wakes the
  assignee, which is usually desirable.
- `connection_request` intents that are already satisfied: `complete` refuses
  on company-identity connections (409); resolve as declined-with-reason.
- Issues with no assignee never get heartbeats; route them or they rot.
- Client-blocked items (Mitsui: images, Kumano pricing, compliance docs) are
  parked in backlog awaiting Rand, not agent work.

## 5. Mitsui → randm migration plan (approved by Rand 2026-09-23)

Order matters: name conflicts first, then connections (auth), then agents,
routines, and only then issues (so assignees exist). Desk cards and run
history are NOT migrated — randm starts with a clean desk.

1. **Name-collision check:** randm has no `Mitsui *` agents; Mitsui agents
   will be created with their current names (prefixed `Mitsui` already).
2. **Connections:** recreate Pastel (needs fresh OAuth under randm — Mitsui's
   grant cannot be copied), Wix (draft → authorize or defer), Slack (skip —
   randm has Slack). GitHub/Linear/Grok/Claude already exist in randm.
3. **Agents:** POST 4 agents into randm with the same role/capabilities/
   adapter config (model `gpt-5.6-luna`), porting `instructions/AGENTS.md`
   content from the Mitsui data dir into the new agents' instructions.
4. **Routines:** recreate the Pastel sync routine (rewriting connection id
   references + `/MIT/` links to randm keys) and the daily-memory routine.
5. **Issues:** recreate open Mitsui issues (86 non-done) with status,
   priority, description; map `Mitsui *` assignee ids → new randm agent ids;
   client-blocked ones go to `backlog` with the blocked-on-client note.
   Pastel-linked issues keep their `pastel:{n}` idempotency keys.
6. **Cutover:** wake randm agents, verify runs succeed, then set the Mitsui
   company to paused/archived — do NOT delete (history + vault remain).
7. **Verify:** randm board shows the Mitsui workload in progress; no agent in
   `error`; desk holds only genuine gates.

## 6. Useful API quick reference (operator key)

```
GET  /api/companies                                   list companies
GET  /api/companies/:cid/agents|issues|routines|tools/connections
POST /api/companies/:cid/agents                       create agent
PATCH /api/companies/:cid/agents/:aid                 update agent (model, status)
PATCH /api/companies/:cid/issues/:iid                 status/assignee/description
POST /api/companies/:cid/agents/:aid/wake             wake (optionally fresh session)
GET  /api/companies/:cid/attention                    decision desk
```
Auth: `Authorization: Bearer $(cat /home/randy/.paperclip-board-key)`.
OpenAPI: `GET /api/openapi.json`. Schema detail: read
`/app/server/dist/routes/*.js` in the container for exact payload shapes.
