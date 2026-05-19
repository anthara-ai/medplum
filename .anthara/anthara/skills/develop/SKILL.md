---
name: develop
description: Slice-by-slice TDD loop that turns an Anthara spec into code with quality enforced at construction. Reads a spec, gathers task context once (code-orienteer), verifies design plan against design.md (design-check), then runs each slice through test-writer → developer → reviewer fleet (parallel-spawned per active compliance pack from get_relevant_standards). Per-AC checkbox tick in spec and ticket as each AC's test passes. One commit per slice. Resume from spec checkbox state. Use when the user runs /anthara:develop, says "build the spec", "implement this", "develop slice X", or wants to turn an Anthara spec into code.
argument-hint: [optional spec URL or file path]
allowed-tools: Read, Write, Edit, Bash, Agent, Glob, Grep
---

# /anthara:develop

Slice-by-slice TDD loop with quality enforced at construction. Five agents, four phases. The orchestrator integrates them; the file system carries the artifacts; tactical decisions thread through prose handoff summaries; strategic decisions persist to Org Memory.

## Operating principles

- **Outside-in slice order is the build order.** Strict default. Override needs explicit user justification.
- **Per-AC ticks are atomic.** The developer agent flips `[ ]` → `[x]` in the spec AND the ticket the moment each AC's test goes green. A regressed test un-ticks.
- **Tests fail before code.** Test-writer always confirms tests fail before handing off to developer.
- **Quality at construction, not correction.** Reviewer fleet runs per-slice (Phase 2d), not deferred to PR time.
- **Push through; LLM-judgment handles severity.** HIGH-severity reviewer findings auto-iterate (developer fixes from findings; reviewers re-run) until resolved or the retry budget exhausts. MEDIUM findings auto-resolve when trivial; otherwise auto-append to spec §11 Open questions. LOW findings note-only. The user is interrupted only when an external blocker emerges — never to approve a step the skill can decide.
- **Two retry budgets.** Developer gets 10 attempts to make tests green for an AC before surfacing a diagnostic. Reviewer HIGH findings get a separate, larger fix-iteration budget (developer fixes → reviewers re-run). The reviewer budget is risk-scaled (see below). These are independent — developer retry exhaustion surfaces to the user; reviewer retry exhaustion skips the slice.
- **Risk-aware reviewer retry budget.** If `/anthara:start` threaded a risk hint (LOW / MODERATE / HIGH), scale the per-slice reviewer-fix iteration budget: LOW → 5; MODERATE → 10 (default); HIGH → 15. Default to MODERATE when no risk hint is present. Severity calibration matters more than retry count — *"is this really HIGH?"* is the reviewer's first question, and review-craft's calibration discipline is what keeps the loop honest.
- **Resume from spec checkboxes.** Unticked ACs are the resume cursor. No separate state file.
- **Loose handoff summaries.** Agents return prose; the orchestrator reads what it needs without parsing a schema. Trust the agents to surface relevant detail.
- **Strategic decisions go to Org Memory; tactical ones don't.** _"Would `/anthara:explain` need this six months from now?"_ is the test.
- **Tool discipline.** Closed questions through `AskUserQuestion`. One open question per turn.

## Locate the spec

- _Argument provided_ — read the spec at the URL or path.
- _No argument_ — Glob for `docs/specs/*-spec.md` in the current repo. If exactly one spec exists, confirm via `AskUserQuestion`. If multiple, ask which. If none found locally, fall back to `search_facts("recent spec")` on fabric.
- Verify the file is an Anthara spec (`# Spec:` header, hierarchical AC checkboxes in §5).
- Extract: spec UUID, slug, slice count, AC count, active packs declared in §6.

Spec filename pattern: `docs/specs/<NNN>-<slug>-spec.md`. The `<NNN>` is shared with the context file.

## Pre-flight

**Capture risk hint.** If the invocation context note from `/anthara:start` contains `RISK=LOW`, `RISK=MODERATE`, or `RISK=HIGH`, record it; it scales the slice-loop retry budget per the Operating principle (5/10/15). Default MODERATE when absent.

Load:

- `ARCHITECTURE.md` (else fall back to spec §7).
- `design.md` (else fall back to spec's Design context theme — §3 or §5 Findings, depending on where spec-writer placed it).
- `CLAUDE.md` if present.
- `load_context()` on fabric (user / org context).
- Compute `raw_remote_url` via `git remote get-url origin`, parse `<owner/repo>` from it (e.g., `github.com/anthara-ai/plugin` → `anthara-ai/plugin`). Never `ORG_WIDE`.
- `get_standards(<owner/repo>)` for full pack-rule awareness (informational, not injected to agents).

Verify spec is ready:

- Any §11 Open questions marked as _external blockers requiring resolution_? Surface them in the run summary, then proceed. The user invoked develop knowing the spec's state — they can cancel if a blocker matters.
- Any slices stubbed (`...` placeholder content)? Surface them and skip the stubbed slices in the slice loop. The user can re-run `/anthara:spec-writer` to fill stubs if they want different behavior.

Surface a one-line run summary — _"Developing spec `<NNN>-<slug>` — <N> slices, <M> ACs, <K> stubbed slices skipped, <J> external blockers noted"_ — and start.

## Phase 0 — Generate or load task context

Context file path: `docs/specs/<NNN>-<slug>-context.md` (same `<NNN>` as the spec).

- _File exists, HEAD matches the file's stamped HEAD:_ reuse silently.
- _File exists, HEAD has shifted:_ regenerate silently. Surface a one-line note (_"Codebase HEAD has shifted; context regenerated from current code."_).
- _File does not exist:_ spawn `code-orienteer` (Agent tool, `subagent_type: anthara:code-orienteer`). Pass spec path, target context file path, spec UUID, current HEAD. Wait for completion.

Surface code-orienteer's one-line handoff summary and proceed. The user can interrupt and edit the context file at any later point during the slice loop if they spot something the orienteer missed.

The context file is the first thing every subsequent agent reads. If it's wrong, the slice loop will be wrong.

## Phase 1 — Design check

Check whether the spec has any UI-touching slices (slices with a UI mockup, frontend affected modules, or `user_facing: true` signal). If the spec has zero UI-touching slices, skip design-check entirely — surface _"No UI slices; design-check skipped."_ and advance to the slice loop.

Otherwise, spawn `design-check` (Agent tool, `subagent_type: anthara:design-check`). Pass spec path, context file path, design.md path (or fallback note).

Design-check writes `> @anthara [HIGH | MED | LOW] ...` annotations on the spec for any drift, then returns a summary.

- _No findings:_ advance to the slice loop.
- _HIGH findings:_ surface to the user explicitly — _"design-check found N HIGH findings, annotated on the spec; resolve via `/anthara:collaboration-loop`, then re-run `/anthara:develop`."_ Exit. Develop will pick up from spec checkboxes on the next run.
- _MED / LOW findings only:_ note the count in the run summary and proceed. The annotations stay on the spec for later attention.

## Phase 2 — Slice loop

For each slice in `spec.§5` in spec order:

### 5a. Slice prep

Read the slice from the spec. Check checkbox state:

- All ACs `[x]`: skip; advance.
- Some `[x]`: `AskUserQuestion` — _resume from this slice (re-run remaining ACs only) / re-run from scratch (un-tick and start fresh) / skip_.

Build `TaskSlots` from slice metadata:

- `task_type`: `feature` (default), `bugfix` (when spec calls out a fix), or `refactor` (explicit).
- `description`: 2-3 sentence summary distilled from the slice's outside-in description. Concrete and specific — _"Issue a per-transcript share-link token; recipient access logged via HMAC-SHA256 IP hash"_ matches better than _"slice 5.8 share generation"_.
- `surface_area`: list from the slice's Affected modules + spec §3 layers (e.g., `["api", "auth", "db", "ui"]`).
- `data_handled`: list derived from spec §3.2 Kinds of data this slice touches (e.g., `["phi", "session-token"]`).
- `user_facing`: `true` if the slice has a UI mockup or touches a user surface.
- `external_io`: `true` if the slice calls external systems (Recall.ai, Stripe, etc.).
- `file_paths`: glob patterns from the slice's Affected modules.
- `top_k`: `30` (default).

Call `get_relevant_standards(raw_remote_url, task_slots, top_k=30)` on fabric MCP. Receive `relevant_rules`.

Partition `relevant_rules` by pack (`hipaa`, `owasp`, `wcag`, `clean-code`, `pci`, others):

- Each pack with ≥1 rule will spawn one reviewer in 5d.
- Always-on reviewers (spawn regardless of pack hits): `architecture` (verifies style adherence) and `test-quality` (verifies suite shape).

Surface a one-line status — _"Starting slice 5.X (<name>). N relevant rules across packs <list>. Reviewers will spawn for: <list>."_ — then proceed.

### 5b. Spawn test-writer (sequential — developer depends on test-writer's output)

Agent tool, `subagent_type: anthara:test-writer`. Pass: slice ID, slice content, `relevant_rules`, paths to spec / context / ARCHITECTURE.md / design.md.

Wait. Read handoff. Verify tests fail.

- _Tests already pass (AC may be satisfied):_ `AskUserQuestion` — skip slice / re-run with adjusted scope / cancel.
- _Test-writer reports unrecoverable failure:_ surface diagnostic; `AskUserQuestion` — adjust spec / skip slice / cancel.

### 5c. Spawn developer (sequential — depends on test-writer's output)

Agent tool, `subagent_type: anthara:developer`. Pass: slice ID, slice content, test paths from test-writer, `relevant_rules`, paths to spec / context / ARCHITECTURE.md / design.md.

Thread test-writer's handoff prose into the developer's prompt — particularly: test paths, AC mapping, fixtures used. The developer doesn't re-derive these.

Wait. Read handoff. Verify:

- All slice ACs ticked in the spec (and ticket if exists in Org Memory).
- Slice tests green.
- Lint, typecheck, guardrails (PHI scan, secrets scan, license check) clean.

If developer reports test-failure after retry exhaustion (10 attempts per AC):

- Surface developer's diagnostic.
- `AskUserQuestion`: adjust spec via `/anthara:spec-writer` / skip slice / cancel develop.

If developer detected regression (a previously ticked AC's test now fails):

- The developer un-ticked the regressed AC.
- `AskUserQuestion`: address now (re-run developer on the regressed AC) / accept regression with recorded reason / cancel.

### 5d. Spawn reviewer fleet (parallel)

Determine reviewer set:

- One reviewer per pack with ≥1 rule in `relevant_rules`. Spawn parameters: `focus=<pack-name>`, `scope=slice:N`.
- Always-on: `focus=architecture, scope=slice:N`.
- Always-on: `focus=test-quality, scope=slice:N`.

Spawn ALL reviewers in a single Agent-tool batch (parallel execution, `subagent_type: anthara:reviewer`). Each receives: their `focus`, their `scope`, the slice diff (`git diff` against the start-of-slice marker), the relevant pack rules for their focus, paths to spec / ARCHITECTURE.md / context.

Wait for all. Aggregate findings:

- Dedupe across reviewers (e.g., HIPAA + Clean-Code both flag the same audit-log gap → single finding with both rule cites).
- Sort by severity: HIGH first.

### 5e. Slice handoff

Surface aggregated findings, then act on them without user prompts.

- _HIGH severity findings present:_ auto-iterate. Pass findings to developer for fix; re-spawn the reviewers whose pack flagged the issue; repeat. Retry budget: risk-scaled (LOW → 5, MODERATE → 10, HIGH → 15; default MODERATE). If the budget exhausts with HIGH findings still present, the slice is skipped — record skip reason ("HIGH findings unresolved after retry budget") + the unresolved findings to Org Memory; surface in the final summary at Phase 3.
- _MEDIUM findings:_ the developer agent decides. If trivially fixable (lint / typo / naming), auto-fix in place. Otherwise auto-append to spec §11 Open questions as _"<finding> — surfaced by reviewer in slice 5.X"_.
- _LOW findings:_ note in the slice handoff summary; do not address.

Run the slice's full test set once more (regression sanity).

Record to Org Memory via `add_shared_memory()` only if the slice produced a strategic decision worth persisting (architectural deviation, override of a HIGH finding, integration with prior decision). Skip if unremarkable. The test: _"would `/anthara:explain` need this in six months?"_

Surface a one-line slice-handoff summary (_"Slice 5.X done — N ACs ticked, M tests added, K findings (high/med/low)."_) and proceed to the next slice. The user can interrupt to pause; otherwise the loop continues.

## Phase 3 — Spec handoff

After the last slice:

Spawn reviewer fleet for the end-of-spec scope:

- Each pack reviewer with `scope=all` (cross-slice patterns, cumulative impact).
- Always-on `architecture` reviewer with `scope=all` (cohesion / coupling deltas across the whole spec).
- Always-on `test-quality` reviewer with `scope=all` (full suite shape: pyramid distribution, total coverage delta, mutation score if available).

Wait. Aggregate. End-of-spec findings are advisory by default — they do NOT block develop's exit; the user decides.

Run the full test suite (Bash). Surface the develop-run summary:

- N slices completed
- M ACs ticked
- Test count added; coverage delta; mutation delta (if available); execution time; pyramid shape
- "What's missing" list from the final reviewer pass

Record final summary to Org Memory:

```
add_shared_memory("Spec <UUID> develop run complete on <date>. <N> slices, <M> ACs.
Notable strategic decisions: <list>. <N> HIGH-severity overrides recorded with reasons. Final suite green.")
```

## Hand off

Tell the user:

- All slices complete (or stopped at slice X, with reasons).
- Test suite green.
- `/anthara:ship` (when available) is the next chain command.
- Branch is ready for manual review and PR.

Then `AskUserQuestion`: _"Want a walkthrough of what was built? (`recap` agent — files touched, core logic, tests, key decisions)"_ with options: _Yes, walk me through it / No, I'm good (Recommended)_.

If yes, spawn `recap` (Agent tool, `subagent_type: anthara:recap`) and pass: `spec_path`, the run summary you've been threading through the slice loop, `source_files` (aggregated from each developer agent's handoff), `test_files` (aggregated from each test-writer agent's handoff), `key_decisions` (strategic notes you wrote to Org Memory during the run). Wait for completion; the agent's narration goes directly to the user.

Do not pronounce the spec ready to merge — the user owns that call. Findings deferred to spec §11 carry forward; future develop runs read them.

## Failure handling

- _Test-failure after developer retry exhaustion (10 attempts per AC):_ surface developer's diagnostic; `AskUserQuestion` — adjust spec / skip slice / cancel.
- _Reviewer-found HIGH after reviewer retry-budget exhaustion (risk-scaled: LOW→5, MODERATE→10, HIGH→15):_ skip the slice; surface the unresolved findings in the final summary; record to Org Memory.
- _Mid-slice interrupt:_ on next `/anthara:develop` invocation, the spec's `[ ]` checkbox state is the cursor. Resume from the first unticked AC.
- _Regression mid-slice:_ developer un-ticks; orchestrator surfaces; user decides.
- _Cross-slice contamination (a slice's code breaks an earlier slice's test):_ treat as regression at slice handoff; pause and ask.
- _Fabric MCP unreachable (`get_relevant_standards`, `add_shared_memory`):_ proceed in degraded mode (use full pack rules from `get_standards` if cached; skip strategic memory writes). Note explicitly in the run summary.
- _No `git remote origin`:_ surface; `AskUserQuestion` — set remote / use placeholder / cancel. `get_relevant_standards` requires the remote URL.

## Resume on interrupt

Re-running `/anthara:develop` on the same spec:

1. Compare current `git HEAD` to the context file's stamped HEAD. If different, regenerate the context silently (same rules as Phase 0 above). Surface a one-line note.
2. Walk slices in order. The first slice with any unticked AC is the resume slice.
3. Surface the resume plan — _"Resuming from slice N — slices 5.1 to 5.<N-1> already complete."_ — and proceed. To start fresh, the user invokes develop with an explicit `--fresh` argument or edits the spec checkboxes before invoking.
4. Already-complete slices (all ACs `[x]`) are skipped.

## Guardrails

- Never spawn a slice-loop agent without a context file at `docs/specs/<NNN>-<slug>-context.md`.
- Never modify the context file from inside the slice loop. Regenerate via `code-orienteer` if wrong.
- Never let reviewer findings persist as inline `@anthara` annotations on code. Thread findings to the developer in conversation; deferred MED findings go to spec §11.
- Never parse agent handoffs as JSON. They are loose prose; read what you need.
