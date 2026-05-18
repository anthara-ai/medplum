---
name: review-craft
description: Domain expertise for reviewing code changes. Covers review dimensions (correctness, security, performance, maintainability, accessibility, compliance, architecture, test quality), severity calibration (high blocks; medium asks; low informational), citation discipline (file + symbol, never line numbers; one-line snippets only when they identify a pattern), pattern coherence with the project's existing code, and the research-partner-not-adversary tone. Loaded by reviewer agents (parallel-spawned per pack and always-on roles) when verifying slice diffs and end-of-spec aggregate state. Loaded as context by other agents — not user-invokable.
---

# review-craft

Domain expertise loaded by reviewer agents before evaluating a slice diff (per-slice pass) or all slices (end-of-spec pass). The reviewer's job is to surface findings calibrated by severity, cited concretely, and respectful of the developer's work.

## Tone

- **Research partner, not adversary.** Press for concrete answers, never for agreement. Findings describe what is observed, not what the developer should have known.
- **Specific over general.** *"`auth.service.ts` (`handleSignIn`) does not call `audit.log` on success — HIPAA §164.312(b) requires it"* beats *"missing audit log"*.
- **Suggest, do not demand.** A finding proposes a path forward; the developer (or user via collaboration-loop) decides whether to take it.

## Review dimensions

Each reviewer focuses on one or more of these, depending on the pack it's spawned for or its always-on role:

- **Correctness** — does the code do what the AC says? Are edge cases covered? Are error paths handled?
- **Security** — secrets handling, input validation, output encoding, injection risk, broken access control, cryptographic posture.
- **Compliance (per active pack)** — every rule retrieved via `get_relevant_standards` is a checklist item.
- **Architecture** — dependency direction respected? Boundaries clean? No banned anti-patterns from `ARCHITECTURE.md`?
- **Test quality** — pyramid shape, assertion quality, independence, determinism, AC coverage, no `.only`.
- **Maintainability** — naming, function size, single responsibility, encapsulation, no primitive obsession.
- **Accessibility** — WCAG conformance per the configured level, semantic markup, focus management, motion sensitivity.
- **Performance** — hot path discipline (no joins added without measurement), no N+1, no unbounded loops on user input.

The reviewer's spawn parameters determine its dimensions. A `reviewer-hipaa` focuses on HIPAA + compliance + security + correctness. A `reviewer-wcag` focuses on accessibility + UI markup. The aggregator merges findings.

## Severity calibration

- **High** — production-blocking. Compliance rule violated; security gap; correctness bug; broken access control. Develop's slice loop blocks until resolved.
- **Medium** — quality issue worth addressing but not blocking. Architecture deviation, missing audit log on a non-critical path, test quality concern. Develop surfaces; user decides via `AskUserQuestion`.
- **Low** — informational. Naming nit, suggestion for future improvement. Surfaces; never blocks.

**Calibrate honestly.** Marking everything high makes high meaningless. A reviewer that produces only high findings is broken. Most findings should be medium or low; a clean diff produces few or none.

## Citation discipline

- **Refer by file and symbol. Never by line number.** Refactors break line refs the moment they happen. Symbols persist.
- **Quote the offending pattern when it clarifies.** A one-line snippet to identify the problem is fine; full functions are not.
- **Cite the rule.** Compliance findings cite the pack rule by name (*"HIPAA Security & Privacy: Audit controls (§164.312(b))"*). Architecture findings cite `ARCHITECTURE.md`. Style findings cite the convention from the task-context file.
- **Cite the slice / AC.** A finding's relevance is anchored in which slice and AC it concerns.

## Pattern coherence

The context file documents the project's established patterns. The reviewer flags deviations:

- **Reinventing a utility** — diff introduces an audit-log helper while `audit.log` already exists in `apps/api/src/infra/audit.ts`. Cite the context.
- **Diverging from the service-layer convention** — diff puts business logic in a controller. Finding.
- **Bypassing access control** — diff queries the database without RLS context. **High-severity finding.**
- **Inventing a parallel test fixture** when one exists in `tests/fixtures/`. Finding.

Pattern coherence findings are some of the most valuable. They prevent codebase entropy.

## "What's missing" findings

Some findings are about absence, not presence:

- **Missing tests** — an AC has no corresponding test.
- **Missing audit events** — a regulated operation completes without writing to the audit log.
- **Missing rollback / cleanup** — a write happens without a corresponding delete path.
- **Missing feature flags** — substantial new behavior shipped unconditionally.
- **Missing accessibility affordances** — UI element lacks aria, focus management, or keyboard handling.

Surface these even though there's no specific line to cite. Cite the slice / AC / pack rule that demanded the missing thing.

## Anti-patterns the reviewer should avoid

- **Reviewing the spec, not the diff.** The reviewer's job is to verify the diff against the spec / packs / context — not to second-guess the spec.
- **Inflating severity.** Most findings are medium or low. High is reserved for real production-blocking issues.
- **Vague findings.** *"Could be cleaner"* is not actionable. Either name the deviation specifically or do not raise it.
- **Style nitpicks dressed as bugs.** Naming preferences are low; correctness issues are high. Don't conflate.
- **Repeating findings across packs.** When two reviewers spawn for HIPAA and OWASP and both flag the same audit-log gap, the aggregator dedupes. Surface once with both rule citations.
- **Reviewing code outside the diff.** The diff is the scope. If something nearby is wrong but unchanged, surface it as informational only — not as a slice finding.
- **Writing findings in adversarial tone.** *"Why didn't you..."* is wrong. *"This pattern deviates from..."* is right.

## How to use this skill in your work

When a reviewer agent loads this skill, it should:

1. **Read the task context file FIRST.** Established patterns, reusables, dragons, hot paths — these inform what's a finding.
2. **Apply spawn parameters.** Which pack you're reviewing for, or which always-on role (architecture, test-quality). Focus only on those dimensions.
3. **Read the slice diff.** Findings cite specific files / symbols / patterns from the diff.
4. **Apply pack rules from `get_relevant_standards`.** These are the compliance checklist; missing one is a finding.
5. **Calibrate severity honestly.** Most findings are medium or low.
6. **Output findings as a structured list** — each with severity, dimension, citation, and a proposed direction.
