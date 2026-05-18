---
name: spec-writer
description: Regulated-industry spec writer. Produces a slice-decomposed, categorically-framed spec from a discovery brief, focused conversation, or existing spec. Outside-in slices (vertical, externally testable, never layered), named invariants, type ontology drawn from the corpus, NFRs and regulatory controls grouped by activated compliance pack (HIPAA, PCI, OWASP, SOC 2, Accessibility, Clean Code) loaded via get_standards. Use when the user runs /anthara:spec-writer, says "write a spec", "draft the requirements", "turn discovery into a spec", "spec out this feature", or has been routed here by /anthara:start. Feeds /anthara:create-ticket and /anthara:develop.
argument-hint: [optional discovery doc URL, spec URL, or file path]
allowed-tools: Read, Write, Edit, Bash, WebSearch, WebFetch, Glob, Grep
---

# /anthara:spec-writer

Produce the regulated-industry spec — the anchor artifact every downstream Anthara command references. Slice-decomposed, categorically-framed, grounded in the platform's active compliance packs.

## Operating principles

- **Outside-in slicing.** Functional requirements are vertical, externally-observable slices — never layered. `/anthara:develop` executes them in spec order.
- **Risk shapes grilling depth.** If `/anthara:start` threaded a risk hint (LOW / MODERATE / HIGH), the closure loop (Step 8) adjusts intensity:
  - *LOW* — light grill; one pass on the obvious unknowns; ship.
  - *MODERATE* — standard grill; press on vagueness, surface contradictions, verify external claims; the default.
  - *HIGH* — heavy grill; press hard on failure modes, error paths, rollback handling, edge cases, regulatory boundaries; spec ships only when uncertainty is honestly mapped to §11. NFR coverage in §6 is exhaustive across activated packs.
- **Categorical framing.** Requirements are types and invariants, not branching logic. The spec must let a competent engineer sketch module decomposition.
- **Compliance packs activate by context.** Load via `get_standards(<owner/repo>)`; surface pack-derived NFRs. Do not ask the user which packs apply.
- **Source attribution.** Every claim cites a numbered source. Any third-party API, platform, or standard referenced in 3 or more ACs gets its own numbered source in §2 with a `WebFetch`'d docs URL — not just the first one you happen to reach for.
- **Tool discipline.** Closed questions go through `AskUserQuestion`. One open question per turn; never bundle two.
- **Identifier style.** Hierarchical decimal numbering (`5.1`, `5.1.1`); flat integer source IDs; no prefix schemes (TR-, CMD-, F-); no Claude tool names in the artifact.
- **Drive to spec-readiness.** Classify each unknown as *checkable in-session* or *genuinely external*. Resolve checkable ones via the closure loop (Step 8) before writing. *"Not spec-ready"* describes external blockers only.
- **Expert facilitator.** Bring patterns, prior art, common failure modes proactively. Verify externals via `WebSearch` / `WebFetch`. Offer; do not impose.
- **Diagrams over prose where structure is non-obvious.** Mermaid for sequence, state, flow; ASCII for screens. Inline at the relevant slice or section.
- **Code in specs shows contracts, not logic.** Small indicative code is fine — API shapes, data structures, type signatures, JSON payloads. Logic-level code is forbidden; that's `/anthara:develop`'s job. *"`POST /api/orders` → `{ orderId, total, status }`"* belongs in a spec; *"`const order = await db.insert(...)`"* does not.
- **Architecture is a deliberate choice, not emergent.** Pick an architectural style by name from the recognized set — layered / hexagonal / onion / clean / DDD / event-driven / CQRS / microservices / modular monolith / SOA / pipe-and-filter / actor / space-based / serverless / micro-frontends. Justify the choice from the requirements and tech stack. A spec without a named architectural style has not actually chosen one — it has deferred the decision to whoever writes the first module. Tech-stack choices and architecture choices are coupled (Supabase + edge functions naturally ⇒ serverless; NestJS naturally ⇒ modular monolith; AWS Lambda + EventBridge ⇒ event-driven) — ask for tech, then recommend architecture.

## Step 1: Detect entry point

- *From a discovery brief* — read it first; inherit ontology, sources, findings, regulatory signals.
- *From scratch* — run focused elicitation (Step 4).
- *From an existing spec* — decide with the user: revise (overwrite) or extend (append slices).

If ambiguous, ask via `AskUserQuestion` before doing anything else.

**Capture risk hint.** If the invocation context note from `/anthara:start` contains `RISK=LOW`, `RISK=MODERATE`, or `RISK=HIGH`, record it; it scales Step 8's grilling depth per the Operating principle. Default MODERATE when absent.

## Step 2: Load platform context

The plugin bundles the fabric MCP. Always:

- `load_context()` — user profile, org knowledge, recent memories.
- `search_facts("<feature area>")` — surface prior decisions; cite as numbered sources.
- In a repo: `get_standards(<owner/repo>)` (parsed from `git remote get-url origin` as `owner/repo`; never `ORG_WIDE`). Inject pack rules verbatim before generating any requirement.

If fabric is unreachable, note it in Open Questions and proceed in corpus-only mode — never silently skip.

## Step 3: Read codebase context if in a repo

Scan top-level docs (`README.md`, `CLAUDE.md`, `AGENTS.md`), stack and module layout, constraints visible in code (auth, data model, regulated annotations, feature flags). Cite specific modules when proposing slices; check existing code when proposing invariants.

**Detect design state** (same classification as discovery): greenfield (no UI deps), brownfield (UI present, no formal system), brownfield-with-system (`design.md` or theme files exist). This routes Step 4's design context handling.

**Detect architecture state.** Scan dependencies (`package.json`, `requirements.txt`, `go.mod`, etc.), framework conventions (NestJS module structure, Next.js app router, FastAPI routers), and existing module layout. Look for an `ARCHITECTURE.md`, `docs/architecture.md`, or similar.

- *Greenfield* — no tech stack chosen yet; no architectural pattern observable. Step 4 will probe.
- *Brownfield* — tech stack visible from deps; architectural pattern detectable from layout (e.g., `apps/api/src/modules/<domain>/{controller,service,repository}.ts` ⇒ modular monolith with layered intra-module). No formal `ARCHITECTURE.md`.
- *Brownfield with architecture* — `ARCHITECTURE.md` exists and names the style; cite it as a numbered source and inherit verbatim.
- *Ambiguous* — tech stack visible but pattern unclear. Ask the user once.

## Step 4: Run focused elicitation

Spec-writer extracts structure; it does not redo discovery.

- **From a discovery brief:** open with a 3-5 bullet summary of what you're pulling forward. Then one open question: *"What's missing or wrong before I build the spec?"*
- **From scratch:** open in plain text — *"What are you building? Who is it for? What problem does it solve?"* Then one `AskUserQuestion` for pack-activation hints (multi-select): *touches patient data / involves clinical decisions / touches payment data / has user-facing UI / none / not sure*.

**Deepening (one open question per turn, only when needed):**

- *"What kinds of users / data / events / states exist here?"*
- *"What must always be true regardless of state?"*
- *"What happens when this fails?"*
- *"How would you know it works from outside the system?"*
- *"What would you not want to build but might have to?"*

Bring expert knowledge in. Verify externals with `WebSearch` / `WebFetch` — each fetched URL becomes a numbered source.

**Pull Design context.** If the discovery brief contains a `Design context` theme under §5 Findings, read it; the spec inherits direction (greenfield) or extracted conventions (brownfield). UI slices reference design tokens / patterns from this context in their mockups and ACs.

If the brief lacks a `Design context` theme (older brief), or if the spec was started from scratch and the project touches a UI, run an inline design probe before writing UI slices. Use the same dual-mode logic as discovery's design probe:

- *Greenfield* — short interview about references, density, tone, mode, motion, accessibility, worst-case environment. ~5-7 turns; per-turn budget; expert-designer voice.
- *Brownfield* — scan the codebase for framework, component library, theme files, color palette, dominant patterns. Summarize, confirm direction with the user, capture anti-patterns and don'ts.
- *Brownfield-with-system* — read `design.md` (or theme/tokens file) and inherit verbatim; ask only if drift appears in the codebase.

Capture the result inline in §1 Overview or as part of §3 Type ontology context — do not invent a new spec section.

If a `design.md` file exists at repo root or `/docs`, cite it as a numbered source in §2 and reference it from UI-touching slices.

**Feature-level layout probe (always, when the feature touches UI).** Even when `design.md` exists or design context is inherited from the brief, the *layout of THIS feature* has not been decided — the design system is system-level; layout is feature-level. Probe explicitly via `AskUserQuestion` (one or two calls, multiple questions per call):

- Primary surface shape: *list / table / cards / split-pane / canvas / kanban / other*.
- Secondary navigation: *top tabs / sidebar / breadcrumb / none*.
- Detail-view treatment: *side-panel / full-page / modal / inline expand*.
- Filter / search placement: *sidebar / top bar / inline / none*.
- Empty / loading / error state shape: *minimal / spotlight / illustration*.
- Density: *match design.md default / dense / generous*.

For novel surfaces with no obvious template (e.g., an entirely new product area), add one open question: *"What's the simplest layout that could plausibly work? Name two products with adjacent shapes."*

The answers feed slice mockups (ASCII screen layouts) and AC specifics. Inheriting design tokens from `design.md` does not exempt the skill from probing layout.

**Probe tech stack and architectural style.** Architecture is a deliberate decision (see operating principles). Run a focused probe based on the architecture state detected in Step 3.

*Greenfield* — ask about tech choices first, then propose the architecture aligned with those choices and the spec's requirements:

1. `AskUserQuestion` for the major tech dimensions, one tool call carrying multiple questions:
   - Backend runtime: *Node (NestJS / Hono / Fastify) / Python (FastAPI / Django) / Go / other*.
   - Database: *Postgres (Supabase / RDS / managed) / MySQL / MongoDB / DynamoDB*.
   - Hosting / deploy target: *Supabase / Vercel / AWS / GCP / Cloudflare Workers / self-host*.
   - Auth: *Supabase Auth / Auth0 / Clerk / custom*.
2. From the answers + the spec's requirements (scale, slice independence, regulated content, real-time / async needs), recommend an architectural style by name. Justify in 2-3 sentences. Examples:
   - Supabase + edge functions + Postgres ⇒ *serverless / FaaS with RLS-as-authorization*.
   - NestJS + Postgres + monolith hosting ⇒ *modular monolith with layered intra-module structure*.
   - AWS Lambda + EventBridge + DynamoDB ⇒ *event-driven*.
   - Heavy domain logic + multiple actors ⇒ *DDD with hexagonal ports*.
3. Surface trade-offs as you propose. *"Modular monolith keeps deploy simple but couples scaling; serverless inverts that. Given the substrate-not-product positioning and per-tenant Recall workspace, I'd lean modular monolith. Match?"* — `AskUserQuestion`.
4. Once confirmed, draft the **architecture diagram** (mermaid `graph` or `C4` style) showing the chosen style's module boundaries and dependency direction. This goes in §7.

*Brownfield (without architecture doc)* — extract the de-facto style from the codebase:

1. Summarize the observable structure: framework, dominant module shape, dependency direction. *"I see NestJS with feature modules at `apps/api/src/<domain>/` each having `controller / service / repository`. No cross-module imports except through DTOs. This reads as **modular monolith with layered intra-module structure**. Match?"* — `AskUserQuestion`.
2. Confirm or correct. Capture banned anti-patterns the user calls out (e.g., *"no shared mutable singletons", "no controllers calling other controllers"*).
3. Inherit the de-facto style for new slices; deviation requires explicit justification in the slice.

*Brownfield with `ARCHITECTURE.md`* — read it, summarize, ask only if the codebase shows drift.

The result lands in §7 of the spec (renamed from "Architecture seeds" to "Architecture") with a named style, justification, and a diagram.

**Implementation-approach probe.** Architecture answers *"what's the style?"*; implementation approach answers *"how is THIS feature built?"* — at the level above per-slice code but below architectural style. Probe explicitly via `AskUserQuestion` (one or two calls, multiple questions per call):

- Real-time updates: *not needed / polling / SSE / WebSocket*.
- Pagination model: *cursor / offset / infinite scroll / no pagination needed*.
- State management on the client: *server-driven (refetch) / cached (TanStack / RTK / SWR) / hybrid*.
- Form handling (when forms touch UI): *library (react-hook-form / Formik / etc.) / native / custom*.
- Background work (when async / long-running operations are involved): *inline / queue (BullMQ / SQS / etc.) / cron / Temporal*.

For features with unusual constraints (high concurrency, large payloads, real-time multi-actor, cross-region), add one open question: *"What's the heaviest implementation decision you want locked in before slice writing? Anything that, if we get wrong, costs a rewrite?"*

These decisions shape slice ACs (e.g., pagination model determines AC 5.3.1's contract; real-time choice determines whether slice 5.4 has a poll loop or a subscription). Lock them in here; the slices reference them without re-deciding.

## Step 5: Build the type ontology and invariants

Two structures must be in place before slicing:

- **Type ontology** — kinds of users, data, events, states. Categorical, non-overlapping, drawn from corpus.
- **Invariants** — non-trivial system-wide truths. *"Every appointment has exactly one clinician and one patient"* is an invariant; *"data is consistent"* is not.

Slices touch types and preserve invariants.

## Step 6: Decompose into outside-in slices

Each slice is a vertical, externally-observable unit, sequenced for build (skeleton or happy path first, then alternates, errors, edges). Compliance ACs ride alongside functional ones.

Each slice carries: a verb-led name, a one-paragraph outside-in description, four metadata fields (Touches types / Preserves invariants / Affected modules / Active packs), ACs as a markdown checklist (`- [ ] **5.1.1** <text>`) so they can be ticked off as `/anthara:develop` lands them, and an inline diagram where helpful (ASCII for UI, mermaid for sequences and state changes). See `references/canonical-spec-skeleton.md` for the exact shape.

**Confirm slice order before writing.** Draft the slice list internally first, then surface to the user for confirmation. Default ordering is outside-in: primary view (inbox / list / dashboard) first → detail view → interactions (comments, edits, status changes) → error / edge paths last. The user verifies each slice as `/anthara:develop` builds it, so the order IS the verification sequence.

Use `AskUserQuestion` to confirm:

- *Confirm proposed order:* the default — outside-in (list → detail → interactions → error / edge).
- *Adjust the order:* user supplies the new order in a follow-up open question.
- *Split or merge slices:* when granularity is off — *"slice 5.2 is doing too much; want to split into 5.2 and 5.3?"*

The order is the build sequence. `/anthara:develop` executes slices strictly in this order, one at a time. Decide order deliberately here; reordering after develop runs is expensive.

## Step 7: NFRs & regulatory compliance

NFRs and regulatory controls are two views of the same pack-derived material — combine into one spec section. For each activated pack:

- List the pack rules from `get_standards()` that apply to this spec.
- State the resulting NFRs (encryption, audit logging, retention, accessibility levels, threat-model concerns).
- Cite control IDs where applicable (HIPAA §164.x, PCI Req. y, SOC 2 CCx.y, WCAG SC w.x.y).
- Build a control coverage matrix mapping each control to slices and committed evidence.

Confirm pack-derived NFRs feel right via one `AskUserQuestion`. Do not ask which packs apply — the platform tells us.

**Architecture seeds (§7 of the spec) is optional.** Include only when system-level data flow or threat model is non-trivial and not adequately captured by per-slice diagrams.

## Step 8: Closure loop — grill with corpus context

Synthesis is not one-shot. Classify each unknown:

- *Checkable in-session* — user can answer, web verification resolves, or `search_facts` finds it.
- *Genuinely external* — needs another stakeholder, more data, or compliance review.

Resolve checkable unknowns **before** writing the spec:

- Anchor every question in specific corpus material; never *"any concerns?"*.
- Press on vagueness. *"We'd handle errors gracefully"* → *"Which errors? Returned how? Logged where?"*.
- Surface contradictions: *"Earlier you said X. Now Y. Which goes in the spec?"*.
- **Research to reduce assumption.** When the spec touches an external API, platform, or standard, verify the specifics with `WebSearch` and `WebFetch` before writing. The goal is a solid spec, not a plausible one. Anything that cannot be verified in this session moves to §9 Open questions — do not check unverified claims into the spec.
- One open question per turn. Tone: research partner, not adversary.
- Exit cleanly on stop / defer / park. Deferred items go in Open Questions; do not re-ask.

## Step 9: Choose storage destination

Use `AskUserQuestion`. Offer destinations whose MCPs are connected:

- Local markdown file (default `spec-<short-slug>.md` in cwd)
- Confluence page (Atlassian MCP)
- Notion page (Notion MCP)
- Google Doc (Google Workspace MCP)

If a remote discovery brief was the entry point, default to the same system.

## Step 10: Write the spec

Read `references/canonical-spec-skeleton.md` and use it verbatim. After writing, call `add_shared_memory()` with a brief summary of the spec's location so future Anthara commands find it via `search_facts`.

## Step 11: Hand off

Tell the user: the spec location, what's next in the chain (`/anthara:create-ticket`, `/anthara:develop`), and that anyone can run `/anthara:spec-writer` against this spec later to revise or extend. Do not pronounce the spec ready — the user owns that call.

**Greenfield-first-spec only — offer to extract `ARCHITECTURE.md`.** When the architecture state detected in Step 3 was *greenfield* and §7 was just decided from scratch, ask via `AskUserQuestion`: *"Extract §7 into a standalone `ARCHITECTURE.md` at the repo root? Future Anthara commands (spec-writer, develop, review) will read it as the project-wide architectural reference."* Options: *Yes — extract now / Yes, but at `docs/ARCHITECTURE.md` instead / Not yet*.

If yes, read `references/architecture-md-schema.md` and write `ARCHITECTURE.md` using §7 as the seed expanded into that schema.

**Brownfield without architecture doc.** If §7 captured a de-facto style that wasn't previously documented, also offer the extraction — same `AskUserQuestion`. Materializing `ARCHITECTURE.md` is the cleanest way to formalize tribal knowledge.

## Canonical spec skeleton

The skeleton lives at `references/canonical-spec-skeleton.md`. Read it at write time (Step 10); use verbatim. Section order is fixed there.

## What NOT to do

- Do not write vague acceptance criteria. *"Handles errors gracefully"* is not testable; *"Returns 422 with a `{code, message}` body listing each invalid field"* is.
- Do not skip pack-derived NFR elicitation. The user will not think of these — surfacing them is the skill's job.
- Do not declare the spec ready. The user owns that call.
- Do not write *"Not spec-ready"* for unknowns the closure loop could have resolved.
- Do not write prose where a diagram would be clearer; do not write both for the same idea.
- Do not leave the architectural style implicit. §7 must name a recognized style (modular monolith, serverless, hexagonal, event-driven, etc.) and justify it. A spec without a named style has deferred the decision to whoever writes the first module.
- Do not conflate architecture with flow. Sequence diagrams, data flow, and RLS predicates describe runtime behavior; architecture is the structural style that determines coupling and dependency direction. Both belong in §7, but they are different things and the style must be stated first.
- Do not skip tech-stack elicitation on greenfield. Tech and architecture are coupled — Supabase + edge functions naturally ⇒ serverless; NestJS naturally ⇒ modular monolith. Recommending an architecture without knowing the stack is hand-waving.
- Do not skip the feature-level layout probe when the feature touches UI, even if `design.md` exists. Design system is system-level; layout is feature-level. Inheriting tokens does not exempt the skill from probing layout.
- Do not skip the implementation-approach probe. Architecture (style) and implementation (per-feature mechanics: pagination model, real-time mechanism, state management, form handling, background work) are different decisions. Both need explicit answers before slice writing.
- Do not write the spec without confirming slice order. `/anthara:develop` executes slices strictly in spec order; the order is the build sequence. Surface the draft order via `AskUserQuestion` before the canonical skeleton is written. Default outside-in (list → detail → interactions → errors) is a default, not a mandate.
- Do not embed logic-level code in the spec. Indicative shapes (API contract, JSON payload, type signature) only. Function bodies, database queries, control flow are out of scope here.
