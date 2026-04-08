# Medplum — Project Context for AI Agents

This document provides authoritative context about the Medplum repository for AI coding agents (Copilot, Cursor, Codex, etc.). Read it before proposing or applying any changes.

---

## Project Overview

Medplum is an **open-source, HIPAA-compliant healthcare developer platform** built around FHIR R4. It provides:

- A **FHIR-compliant Clinical Data Repository (CDR)** backed by PostgreSQL + Redis
- A **REST + GraphQL API** for reading and writing healthcare resources
- A **React web application** (`packages/app`) for clinical data management
- **Developer SDKs** (`packages/core`, `packages/react`, `packages/react-hooks`)
- **Serverless Bots** (AWS Lambda) for healthcare workflow automation
- **On-premise Agent** for HL7v2 / DICOM connectivity
- **AWS CDK infrastructure** for cloud deployment

Current version: **5.1.6** | License: Apache-2.0

---

## Monorepo Structure

This is an **npm workspaces + Turborepo** monorepo. All packages live under `packages/`.

### Core Packages

| Package | Path | Responsibility |
|---|---|---|
| `@medplum/fhirtypes` | `packages/fhirtypes/` | TypeScript type definitions for FHIR DSTU2/STU3/R4/Normative — **generated, do not edit `dist/`** |
| `@medplum/definitions` | `packages/definitions/` | FHIR StructureDefinitions, ValueSets, SearchParameters — **generated, do not edit `dist/`** |
| `@medplum/core` | `packages/core/` | Pure-TS client library: FHIR validation, FhirPath evaluation, WebSocket subscriptions, auth helpers. No browser or Node-specific deps. |
| `@medplum/server` | `packages/server/` | Express.js backend API: FHIR CRUD, auth (OAuth2/SMART), search, bots, subscriptions. Connects to Postgres + Redis. |
| `@medplum/fhir-router` | `packages/fhir-router/` | FHIR URL routing layer with GraphQL support |
| `@medplum/app` | `packages/app/` | Vite + React web application (the Medplum console UI) |
| `@medplum/react` | `packages/react/` | Reusable React component library for healthcare UIs |
| `@medplum/react-hooks` | `packages/react-hooks/` | Reusable React hooks for Medplum integration |
| `@medplum/mock` | `packages/mock/` | In-memory mock FHIR client for unit tests |
| `@medplum/cli` | `packages/cli/` | Command-line interface for Medplum operations |
| `@medplum/agent` | `packages/agent/` | On-premise agent for DICOM/HL7 connectivity |
| `@medplum/bot-layer` | `packages/bot-layer/` | AWS Lambda layer for serverless Bots |
| `@medplum/cdk` | `packages/cdk/` | AWS CDK infrastructure-as-code |
| `@medplum/generator` | `packages/generator/` | Code generator for FHIR types, docs, JSON schemas |
| `@medplum/hl7` | `packages/hl7/` | HL7v2 client and message utilities |
| `@medplum/ccda` | `packages/ccda/` | C-CDA document parsing and generation |
| `@medplum/docs` | `packages/docs/` | Docusaurus documentation site |
| `@medplum/e2e` | `packages/e2e/` | Playwright end-to-end tests |

---

## ⚠️ CRITICAL: PHI Logging Rules

Medplum handles **Protected Health Information (PHI)**. Violating these rules is a HIPAA compliance issue.

**NEVER log any of the following:**

- Patient names (first, last, full, or any part)
- Dates of birth (DOB)
- Medical Record Numbers (MRN) or patient IDs that could identify an individual
- Home or mailing addresses (street, city, ZIP, county)
- Phone numbers or fax numbers
- Email addresses of patients
- Social Security Numbers (SSN)
- Health plan beneficiary numbers
- Account numbers
- Certificate or license numbers
- Device identifiers or serial numbers
- URLs that contain patient identifiers
- Diagnoses, conditions, medications, or any clinical data
- Photographs or biometric identifiers
- Any combination of data that could re-identify a patient

**Safe to log:** request IDs, trace IDs, resource types, FHIR resource IDs (UUIDs), HTTP status codes, timing/performance data, error codes.

```typescript
// ✅ CORRECT — log resource type and ID only
logger.info('Resource updated', { resourceType: 'Patient', id: resource.id });

// ❌ WRONG — never log name, DOB, or any clinical field
logger.info('Patient updated', { name: patient.name, birthDate: patient.birthDate });
```

---

## FHIR Error Handling

All errors returned from the API **must** use FHIR `OperationOutcome` resources. Never return plain JSON error objects or unstructured strings from FHIR endpoints.

```typescript
// ✅ CORRECT — use helpers from @medplum/core
import { badRequest, forbidden, notFound, gone } from '@medplum/core';
throw new OperationOutcomeError(badRequest('Invalid resource'));

// ❌ WRONG — plain error objects are not FHIR-compliant
res.status(400).json({ error: 'Invalid resource' });
```

Key `OperationOutcome` helpers in `@medplum/core`: `allOk`, `badRequest`, `forbidden`, `notFound`, `gone`, `conflict`, `tooManyRequests`, `unsupportedMediaType`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 6.x (strict mode) |
| Runtime | Node.js ≥22.18 |
| Backend framework | Express.js 5.x |
| Database | PostgreSQL 13+ (via `pg` driver) |
| Cache / Queue | Redis 6+ (via `ioredis`, BullMQ) |
| Auth | OAuth2, OpenID Connect, SMART-on-FHIR (`jose`) |
| Frontend build | Vite 8.x |
| Frontend framework | React 19.x + React Router 7.x |
| UI library | Mantine 8.x |
| Testing (unit) | Jest 30.x |
| Testing (e2e) | Playwright 1.x |
| Monorepo tooling | Turborepo 2.x + npm workspaces |
| Formatter | Prettier 3.x (`printWidth:120`, `singleQuote:true`, `trailingComma:"es5"`) |
| Linter | ESLint + Biome |
| Cloud infra | AWS (S3, Lambda, CloudFront, SES, Secrets Manager) via CDK |
| Containerisation | Docker + Kubernetes (Helm charts in `charts/`) |

---

## Development Commands

```bash
# Start dependencies (Postgres 16 + Redis 7)
docker-compose up -d

# Install all workspace dependencies
npm ci

# Build all packages (excludes docs and examples)
npm run build

# Build only app + server (fast iteration)
npm run build:fast

# Run all tests
npm t
# or
npm test

# Lint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format with Prettier
npm run prettier

# Clean all build outputs
npm run clean
```

Full-stack local development (includes server and app containers):

```bash
docker-compose -f docker-compose.full-stack.yml up
```

---

## Coding Conventions

1. **File headers** — All source files must begin with:
   ```
   // SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
   // SPDX-License-Identifier: Apache-2.0
   ```
2. **Imports** — organised automatically by `prettier-plugin-organize-imports`; do not manually sort.
3. **Prettier** — `printWidth: 120`, `singleQuote: true`, `trailingComma: "es5"`. Run `npm run prettier` before committing.
4. **Conventional commits** — `type(scope): message`. Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`. Example: `feat(server): add bulk export endpoint`.
5. **No raw SQL** — always use the repository layer (`packages/server/src/fhir/repo.ts`). The repo layer enforces AccessPolicy, audit logging, and subscription triggers.
6. **No `any` types** — use `unknown` and narrow with type guards.
7. **Async/await** — prefer over raw Promises.
8. **Error propagation** — throw `OperationOutcomeError` from `@medplum/core` for all domain errors.

---

## Testing Patterns

### Server / Backend Tests

Use `withTestContext()` from `packages/server/src/test.setup.ts` to wrap server-side test logic. This sets up the request context store (logger, traceId, requestId) that the server expects:

```typescript
import { withTestContext } from '../../test.setup';

test('creates a patient', () =>
  withTestContext(async () => {
    const result = await repo.createResource<Patient>({ resourceType: 'Patient' });
    expect(result.resourceType).toBe('Patient');
  }));
```

### Frontend Tests

Use **React Testing Library** (`@testing-library/react`) with the Medplum `MockClient`:

```typescript
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { render, screen } from '@testing-library/react';

const medplum = new MockClient();

test('renders patient name', async () => {
  render(
    <MedplumProvider medplum={medplum}>
      <MyComponent />
    </MedplumProvider>
  );
  expect(await screen.findByText('John Smith')).toBeInTheDocument();
});
```

### Test File Naming

- Unit tests: `*.test.ts` or `*.test.tsx` co-located with source
- E2e tests: `packages/e2e/src/*.test.ts`

---

## What NOT to Modify

The following paths contain **generated files**. Do not edit them directly — run the generator instead:

| Path | Why |
|---|---|
| `packages/fhirtypes/dist/` | Auto-generated FHIR TypeScript type definitions |
| `packages/definitions/dist/` | Auto-generated FHIR data definitions (StructureDefs, ValueSets) |
| `packages/generator/output/` | Intermediate generator output |
| `packages/graphiql/public/` | Auto-generated GraphiQL assets |
| `packages/core/docs/` | Auto-generated API documentation |

To regenerate: `cd packages/generator && npm run build && node dist/index.js`

---

## API Contract

- **Standard**: FHIR R4 (4.0.1)
- **Base path**: `/fhir/R4/`
- **Supported operations**: CRUD (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`), search (`_search`), history (`_history`), batch/transaction (`Bundle`), `$everything`, `$validate`, `$graphql`
- **Auth**: Bearer token (JWT) via `Authorization` header; supports SMART-on-FHIR launch context
- **Content-Type**: `application/fhir+json` for FHIR resources; `application/json` for auth endpoints

---

## Database Architecture

- **One table per FHIR resource type** — e.g., `"Patient"`, `"Observation"`, `"DiagnosticReport"`.
- Additional index tables for search parameters (tokens, strings, dates, quantities, references, URIs).
- **Always use the repository layer** (`packages/server/src/fhir/repo.ts`) — never write raw SQL in feature code.
- The repo layer enforces: AccessPolicy evaluation, compartment checks, audit event creation, subscription triggers, and referential integrity.
- Migrations live in `packages/server/src/migrations/` and must be created for every schema change.
- Schema is managed with a custom migration runner (not an ORM).
