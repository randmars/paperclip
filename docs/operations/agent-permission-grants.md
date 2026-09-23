# Board-managed agent permission grants

The company Members list is intentionally human-only. Agent grant administration
uses the same membership identity and authorization as human grants, through:

- `GET /api/companies/:companyId/members/:memberId/permissions`
- `PATCH /api/companies/:companyId/members/:memberId/permissions`

Both routes require a board caller with `users:manage_permissions`. Agent callers
cannot administer grants, even if they carry that permission. Agent updates require
an active membership. Existing human self-lockout, role, and archive rules remain
unchanged. PATCH validates supported permission keys and records the existing
`company_member.permissions_updated` audit event.

## Operator procedure

Applying a permission remains an explicit human action. Preparing or deploying this
code does not apply any permission. Use the board's authenticated API session, never
an agent token or a copied board token placed in an agent environment.

1. GET the target membership's permission record and verify company, principal type,
   principal ID, and active status.
2. Preserve each existing `{permissionKey, scope}` pair. Append only the approved
   grant if it is absent. If it is already present, stop successfully without PATCH.
3. PATCH `{grants: [...]}` with the merged list. This API replaces the entire grant
   set. Do not use an old saved list.
4. GET again and verify the exact merged set. Stop and report any difference; do not
   repeatedly overwrite a competing administrator's changes.

Read/merge/write is not compare-and-swap: another administrator writing between the
read and write can race. Perform the operation while other grant editors are idle.
The API does not claim atomic additive grant semantics.

For Paperclip RAN-84, the prepared target is GOV agent
`2a4d95f3-af4a-478f-8276-3d043b7c231c`, membership
`406885fa-eb7c-400a-9f56-86a14e0ecab2`, company
`ce9d4abb-af15-4450-a367-5a7f849978b7`. The requested addition is unscoped
`agents:suggest-changes`, not `agents:configure` or administrator access.
After Rand applies it, verify GOV can read skills for GOV, gitkat, rox, and Clippy;
do not sync or change their skills as part of that read test.

Engineering record: DEV-3765. No runtime grant is bundled with this patch.
