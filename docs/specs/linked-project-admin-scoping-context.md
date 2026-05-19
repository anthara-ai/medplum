# Task context: linked-project-admin-scoping

> Generated for spec 0dc6e770-6658-4cb3-9ebc-5875494c59b1 at HEAD 2379a963a · 2026-05-19T08:20:53Z
> Read first by every agent in /anthara:develop's slice loop.

## 1. Affected modules

| Module / file | Role | Notes |
|---|---|---|
| `packages/server/src/fhir/repo.ts` | `Repository` class — single chokepoint for project-scope visibility. Houses `getPermittedProjectIds`, `addProjectFilters`, `canPerformInteraction`, `isSuperAdmin`/`isProjectAdmin`. | ~3,173 lines (god-class — see Dragons). Slice 5.1 edits one method here. |
| `packages/server/src/fhir/repo.test.ts` | Repository unit tests. Existing linked-project templates: `'Project.exportedResourceType'`, `'…enforced on cached reads'`, `'…allows resources in primary project'`. | ~2,399 lines. Slices 5.1–5.4 add tests here; do NOT create a parallel file. |
| `packages/server/src/fhir/accesspolicy.ts` | `applyProjectAdminAccessPolicy` (admin AccessPolicy materialization) and `getRepoForLogin` (Repository factory for an authenticated login). | Unchanged by spec, but its admin-resource shape and `hiddenFields` (`passwordHash`, `mfaSecret`, `superAdmin`) are load-bearing for invariant 4.5. |
| `packages/server/src/fhir/references.ts` | Linked-project handling for `Project.link.project` references; declares `SYSTEM_REFERENCE_PATHS`. | Read-only here — explains why linked-project references are routed through systemRepo for validation. |
| `packages/core/src/access.ts` | Source of truth: `projectAdminResourceTypes` (7 types), `protectedResourceTypes` (3 types), `readInteractions`, `AccessPolicyInteraction`. | Unchanged. New guard in `repo.ts` imports `projectAdminResourceTypes` from `@medplum/core`. |
| `packages/server/src/test.setup.ts` | Shared test fixtures: `createTestProject`, `withTestContext`, `addTestUser`, `initTestAuth`, `bundleContains`. | Reuse, do not reinvent. Tests live in `repo.test.ts`; fixtures here. |
| `packages/server/src/auth/{resetpassword,verifyemail,setpassword}.ts` | Real-world `UserSecurityRequest` create/read patterns (`systemRepo.createResource<UserSecurityRequest>({ resourceType: 'UserSecurityRequest', ... })`). | Reference only — informs test fixture shape for AC 5.1.1/5.1.2 on `UserSecurityRequest`. |
| `packages/server/src/auth/register.ts` | `registerNew(request)` — bootstraps a project + admin membership + login; used in existing linked-project tests. | Reuse verbatim; admin membership is the default for a newly-registered project. |

## 2. Patterns to follow

- **Single enforcement chokepoint.** All read-time project-scope filtering flows through `Repository.getPermittedProjectIds(resourceType)` (called by `addProjectFilters` for SQL queries and by `canPerformInteraction` for post-fetch / cache-path checks). Defined at `repo.ts` (`Repository.getPermittedProjectIds`). Used in `repo.ts` (`Repository.addProjectFilters`, `Repository.canPerformInteraction`). The new guard must live inside this method — do not add a parallel branch.
- **Primary-project convention.** `this.context.projects[0]` is the primary/originating project; subsequent entries are linked projects from `Project.link`. Load-bearing across `repo.ts` (write-deny at `canPerformInteraction`'s `else` branch checks `resource.meta?.project !== this.context.projects?.[0]?.id`). Spec invariant 4.1 reads `[this.context.projects[0].id]`.
- **Resource-type carve-out at the same site.** `getPermittedProjectIds` already special-cases `resourceType === 'Project'` to include all linked projects in results — the new admin-resource guard must run AFTER the early-return and BEFORE the existing per-project loop (so it short-circuits with `[projects[0].id]` without trampling the `Project` carve-out used by test `'Project.exportedResourceType'`).
- **Super-admin bypass is the outer gate.** `canPerformInteraction` opens with `if (!this.isSuperAdmin()) { ... }` — every project-scope restriction is INSIDE that block. The new guard sits inside `getPermittedProjectIds`, which is itself only called from below the super-admin gate; super-admins are unaffected. Defined at `repo.ts` (`Repository.isSuperAdmin`, `Repository.canPerformInteraction`).
- **Test shape.** `test('descriptive name', () => withTestContext(async () => { ... }))`. Always wrap async test bodies in `withTestContext` so `requestContextStore` resolves; see `test.setup.ts` (`withTestContext`).
- **Linked-project test setup (template).** The existing `'Project.exportedResourceType'` test at `repo.test.ts` is the canonical template: (a) `createTestProject({ project: { exportedResourceType: [...] }, withRepo: true })` for the linked project, (b) `registerNew(...)` to create the primary project + admin membership, (c) `globalSystemRepo.updateResource({ ...project, link: [{ project: createReference(linkedProject) }] })` to wire the link, (d) `getRepoForLogin({ project, membership, login, userConfig })` to obtain a `Repository` whose context.projects is `[primary, linked]`. Reuse verbatim for new slice tests.
- **Cache-path regression coverage.** The test `'Project.exportedResourceType enforced on cached reads'` proves the cache path is covered: creating via `linkedRepo` warms Redis, then `repo.readResource` from the primary side exercises `canPerformInteraction` against the cached resource. AC 5.1.5 requires the new tests follow this same shape for `User` (and ideally other admin types).
- **Layered intra-package dependency direction.** `server → core → fhirtypes`. The new guard imports `projectAdminResourceTypes` from `@medplum/core`; never the reverse.

## 3. Reusable utilities

- `packages/server/src/test.setup.ts` — `createTestProject({ project?, withRepo?, withAccessToken?, superAdmin?, membership? })` returns `{ project, repo, membership, client, login, accessToken, accessPolicy }` with typed presence based on options. Pass `withRepo: true` to get a `Repository` bound to that project only (single-project context). For multi-project (linked) contexts, build via `registerNew` + `globalSystemRepo.updateResource` + `getRepoForLogin` per pattern above.
- `packages/server/src/test.setup.ts` — `withTestContext(fn)` runs `fn` inside a `RequestContext`; required for any repo operation in tests.
- `packages/server/src/auth/register.ts` — `registerNew(request: RegisterRequest)` returns `{ project, membership, login, ... }`; the membership returned is a project admin (`admin: true`). Use for the primary-project side of linked-project test fixtures.
- `packages/server/src/fhir/accesspolicy.ts` — `getRepoForLogin({ project, membership, login, userConfig })` builds a `Repository` whose `context.projects` includes the primary + the projects in `project.link`. This is THE factory that produces the multi-project context the spec targets.
- `packages/server/src/fhir/repo.ts` — `getGlobalSystemRepo()`, `getProjectSystemRepo(project)`, `getShardSystemRepo(shardId)`. `getGlobalSystemRepo()` is the cross-project escape hatch used to mutate `Project.link` in tests.
- `@medplum/core` — `createReference(resource)`, `OperationOutcomeError`, `notFound`. Existing repo.test.ts already imports all three; use them for the rejection assertions (`await expect(repo.readResource(...)).rejects.toThrow(new OperationOutcomeError(notFound))`).
- `@medplum/core` — `projectAdminResourceTypes` (the 7-item literal array). Import in repo.ts for the new guard; also import in test for parametric sweeps (AC 5.1.4, 5.2.4).
- `node:crypto` — `randomUUID()` for unique emails/names in tests (existing convention).

## 4. Adjacent code that must coordinate (per slice)

- **Slice 5.1 (admin resources stop surfacing through linked projects):** `packages/server/src/fhir/repo.ts` (`getPermittedProjectIds`) — single-method change; verify call sites `addProjectFilters` and `canPerformInteraction` still see correct behavior. No other production file changes.
- **Slice 5.2 (non-admin sharing unchanged):** `packages/server/src/fhir/repo.test.ts` only. The three existing tests at `'Project.exportedResourceType'` / `'…enforced on cached reads'` / `'…allows resources in primary project'` are the existing coverage; new tests extend, do not modify.
- **Slice 5.3 (super-admin retains visibility):** `packages/server/src/fhir/repo.test.ts` only. Build a super-admin context via `createTestProject({ superAdmin: true, withRepo: true })` (sets `superAdmin: true` on the Project AND threads `superAdmin: options?.superAdmin` into the `RepositoryContext`). Verify `isSuperAdmin()` returns true and the new restriction does not apply.
- **Slice 5.4 (linked-project write-deny):** `packages/server/src/fhir/repo.test.ts` only. The write-deny path is `repo.ts` (`canPerformInteraction`)'s `else if (resource.meta?.project !== this.context.projects?.[0]?.id)` branch. No production change; this slice pins existing behavior under named tests for CREATE/UPDATE/DELETE.

## 5. Known dragons

- `packages/server/src/fhir/repo.ts` — file is ~3,173 lines; `Repository` is a god-class. Convention is to keep adding methods inline rather than extracting. Follow the convention for this spec (the guard is ~3 lines inside `getPermittedProjectIds`); resist the temptation to extract. AI-ergonomics flag: file size already makes context-window discovery harder.
- `packages/server/src/fhir/repo.ts` (`getPermittedProjectIds`) — note the existing `Project` resourceType carve-out at the top of the per-project loop. The new admin-resource guard must short-circuit BEFORE the loop runs; if placed inside the loop or below it, the carve-out for `Project` becomes load-bearing (Project is in `projectAdminResourceTypes`, so a naive guard would break the existing `'Project.exportedResourceType'` test that asserts `projects.length === 3`). AC 5.1.6 documents this.
- **Redis cache bypass risk** — `repo.readResource` consults a Redis cache before falling through to SQL; the cache path skips `addProjectFilters` and only hits `canPerformInteraction`. Because both call sites flow through `getPermittedProjectIds`, the fix is covered. The existing regression test at `repo.test.ts` (`'Project.exportedResourceType enforced on cached reads'`) is the template; AC 5.1.5 requires equivalent cache-path coverage for admin types.
- `primary project = projects[0]` is convention, not a typed contract — load-bearing across `repo.ts` write-deny, `accesspolicy.ts` `getRepoForLogin` (where the array is built `[primary, ...linked]`), and the spec's invariant 4.1. A future refactor that reorders the array silently breaks the model.
- `packages/server/src/fhir/repo.test.ts` is ~2,399 lines and growing. Convention is to keep adding tests inline within the single `describe('FHIR Repo', ...)` block; do not split.
- `references.ts` declares `Project.link.project` as a `SYSTEM_REFERENCE_PATHS` member — linked-project references are validated via systemRepo specifically because non-system repos can't see them by design. Don't break this assumption while testing.
- `applyProjectAdminAccessPolicy` (in `accesspolicy.ts`) already defines `hiddenFields` for `passwordHash`, `mfaSecret`, `superAdmin`. Preserved verbatim by this spec (invariant 4.5). Do not modify.

## 6. Test conventions

- **Framework:** Jest (NOT Vitest, despite the spec mentioning Vitest at root). The server package declares `"test": "jest"` and `jest.config.json`. Tests use `jest.mock(...)`, `jest.spyOn(...)`, `jest.fn()`. The top-level `vitest.config.ts` exists for other packages — server is Jest.
- **Test placement:** Co-located. `foo.ts` ↔ `foo.test.ts` in the same directory. Repository tests live in `packages/server/src/fhir/repo.test.ts`.
- **Run:** `cd /home/chandu/projects/incubyte/medplum/packages/server && npm test` (full suite, slow). Targeted: `npm test -- repo.test.ts` from the server package. Single test by name: append `-t 'test name substring'`.
- **Fixtures:** `packages/server/src/test.setup.ts` — `createTestProject`, `withTestContext`, `initTestAuth`, `addTestUser`. Plus `registerNew` from `auth/register.ts` for full register-flow setup.
- **Lifecycle:** `beforeAll(async () => { const config = await loadTestConfig(); await initAppServices(config); ... })` and `afterAll(async () => { await shutdownApp(); })` — already wired at the top of `repo.test.ts`.
- **Naming:** Descriptive sentences with the resource/feature as subject (e.g. `'Project.exportedResourceType enforced on cached reads'`). Avoid `'test1'` or `'should work'`.
- **Assertion idioms:** `expect(x).toStrictEqual(...)`, `expect(arr).toContain(...)`, `expect(arr).not.toContain(...)`, `await expect(repo.readResource(...)).rejects.toThrow(new OperationOutcomeError(notFound))`.

## 7. Hot paths and performance landmines

- `Repository.getPermittedProjectIds` is on every FHIR read interaction's hot path (search + direct-read + cache-path read-through). The new guard must be O(1) — `projectAdminResourceTypes.includes(resourceType)` over a 7-item literal is acceptable.
- The guard must short-circuit BEFORE the existing per-project loop (which is O(n) over `context.projects` and reads `project.exportedResourceType` for each). Short-circuiting saves the loop entirely for admin reads.
- Do not introduce allocations on the hot path beyond the one-element array `[this.context.projects[0].id]` — match the existing style at the top of the method (`const projectIds = [this.context.projects[0].id]`).
- `canPerformInteraction` runs on every post-fetch and cache-hit; do not add network I/O, audit logs, or logger calls here for the new guard. Spec §6.1.3 / AC 5.4.5 explicitly preserve "deny is silent 404, no new audit log".

## 8. Open uncertainties resolved during orientation

- Spec §11 implicit — "Vitest at the root; the affected file `repo.test.ts` follows the existing test conventions". Resolved: the server package uses **Jest**, not Vitest. Test scripts and `jest.config.json` confirm. Tests must use Jest idioms (`jest.mock`, `jest.spyOn`). Fix the framework expectation downstream.
- Spec §5.3 wording — "Construct a super-admin `Repository` context (via `getSystemRepo()` or `superAdmin: true` Project + a `ProjectMembership`)". Resolved: `createTestProject({ superAdmin: true, withRepo: true })` is the simplest path — it sets `superAdmin: true` on the Project AND propagates `superAdmin: options?.superAdmin` into the `RepositoryContext`, so `isSuperAdmin()` returns true. See `test.setup.ts` (`createTestProject`, the `withRepo` branch).
- Spec §5.4 wording — write-deny path. Resolved: the existing path is `canPerformInteraction`'s `else if (resource.meta?.project !== this.context.projects?.[0]?.id) { return undefined; }`. Tests should verify all three of CREATE/UPDATE/DELETE reach this branch and surface as `OperationOutcomeError(notFound)`.
- Spec §3.1 wording — "super-admin context". Resolved: `Project.superAdmin = true` PLUS `RepositoryContext.superAdmin = true` is what flips `isSuperAdmin()`. The `createTestProject({ superAdmin: true, ... })` fixture handles both.
- Spec §9.4 — upstream contribution intent. Not resolved by orientation; remains an open question for Chandu.

---
## Changelog
- 2026-05-19 — generated by code-orienteer from spec 0dc6e770-6658-4cb3-9ebc-5875494c59b1 at HEAD 2379a963a.
