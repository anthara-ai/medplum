# Medplum — Claude Code Context

This file configures Claude Code's understanding of the Medplum repository.

> **Full project context is in [`AGENTS.md`](./AGENTS.md)** — read that file first for the monorepo structure, PHI logging rules, FHIR conventions, tech stack, dev commands, testing patterns, and database architecture.

---

## PR Review Guidelines for Claude

When reviewing pull requests or generating code in this repository, apply the following checks in addition to the general guidelines in `AGENTS.md`.

### 🔴 Blocking Issues (must fix before merge)

1. **PHI in logs**
   - Search all `logger.*` calls in the diff for any patient-identifying fields: `name`, `birthDate`, `address`, `telecom`, `identifier`, `ssn`, `mrn`, diagnoses, or any field from a `Patient` / `RelatedPerson` / `Practitioner` resource.
   - Flag any log statement that could contain a real person's identity.

2. **AccessPolicy bypass**
   - Any direct database query (raw SQL or direct table access) that skips `packages/server/src/fhir/repo.ts` bypasses AccessPolicy enforcement.
   - Flag `db.query(...)`, `client.query(...)`, or any import from `packages/server/src/fhir/sql.ts` used outside of `repo.ts` without a documented exception.

3. **Missing database migrations**
   - If the diff adds or modifies a column, table, or index in any file under `packages/server/src/`, a corresponding migration file must exist in `packages/server/src/migrations/`.
   - Flag PRs that alter the data model without a migration.

4. **Non-`OperationOutcome` error responses**
   - Any `res.status(4xx).json(...)` or `res.status(5xx).json(...)` that does not produce a FHIR `OperationOutcome` resource is non-compliant.
   - All domain errors must use helpers from `@medplum/core` (`badRequest`, `forbidden`, `notFound`, etc.) and throw `OperationOutcomeError`.

5. **Edits to generated files**
   - Changes inside `packages/fhirtypes/dist/`, `packages/definitions/dist/`, `packages/generator/output/`, or `packages/graphiql/public/` should be regenerated, not hand-edited.
   - Flag any manual edits to these paths.

### 🟡 Warnings (should fix, discuss if not)

6. **Test coverage**
   - New public functions, API endpoints, and React components should have accompanying `*.test.ts` / `*.test.tsx` files.
   - Server tests must use `withTestContext()`; React tests must use `@testing-library/react` with `MockClient`.
   - Flag PRs that add significant logic without tests.

7. **FHIR R4 compliance**
   - New or modified FHIR resource handling should conform to the FHIR R4 specification.
   - Required fields, cardinality constraints, and value-set bindings must be respected.
   - Reference the official FHIR R4 spec at https://hl7.org/fhir/R4/ when in doubt.

8. **Conventional commit format**
   - Commit messages should follow `type(scope): message` (e.g., `feat(server): add bulk export`).
   - Flag commits with vague messages like "fix stuff" or "WIP".

9. **Prettier formatting**
   - Diffs should be formatted with `npm run prettier` (`printWidth:120`, `singleQuote:true`, `trailingComma:"es5"`).
   - Flag unformatted code.

### ℹ️ Notes for Claude Code specifically

- When proposing code changes, always emit the SPDX licence header at the top of new `.ts` / `.tsx` files:
  ```
  // SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
  // SPDX-License-Identifier: Apache-2.0
  ```
- Prefer editing existing files over creating new ones unless a new module is clearly warranted.
- When uncertain about a FHIR resource structure, import from `@medplum/fhirtypes` rather than defining inline types.
- Never suggest storing secrets in code; Medplum uses AWS Secrets Manager and environment variables.
