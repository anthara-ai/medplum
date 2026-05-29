---
name: review-craft
description: Domain expertise for reviewing code changes. Covers review dimensions (correctness, security, performance, maintainability, accessibility, compliance, architecture, test quality), severity calibration (high blocks; medium asks; low informational), citation discipline (file + symbol, never line numbers; no code snippets in findings), pattern coherence with the project's existing code, terse one-liner output format, and the research-partner-not-adversary tone. Loaded by reviewer agents (parallel-spawned per pack and always-on roles) when verifying slice diffs and end-of-spec aggregate state. Loaded as context by other agents — not user-invokable.
---

# review-craft

Domain expertise loaded by reviewer agents before evaluating a slice diff (per-slice pass) or all slices (end-of-spec pass). The reviewer's job is to surface findings calibrated by severity, cited concretely, and respectful of the developer's work.

## Tone

- **Research partner, not adversary.** Findings describe what is observed, not what the developer should have known.
- **Specific over general.** Name the file, symbol, and the rule or pattern violated. Avoid vague language like *"could be cleaner"*.
- **Reviewer finds; developer fixes.** A finding states what and where. The hint is a brief direction, not a prescription. Solution design is the developer's job.

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
- **No code snippets in findings.** Locator + a short phrase is the contract.
- **Cite the rule, short and ASCII only.** Compliance findings cite the rule by short id — `HIPAA 164.312(b)`, `OWASP A01`, `WCAG 1.4.3`, `PCI 3.4`. No special characters. Architecture findings cite `ARCHITECTURE.md`; style findings cite the convention from the task-context file. Long-form rule names are not used in findings.
- **Slice / AC goes in the header**, not on each finding.

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
6. **Output findings in the terse one-liner format.** Severity letter, locator (`file:symbol`), terse `what`, optional pack rule cite in brackets, and a brief one-line hint. No prose, no dimension labels, no code snippets. See the reviewer agent's "What you return to the orchestrator" section for the exact shape.
