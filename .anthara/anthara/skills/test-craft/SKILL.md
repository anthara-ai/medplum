---
name: test-craft
description: Domain expertise for writing excellent tests. Covers pyramid bias, test independence, determinism, meaningful assertions, behavior-as-documentation, compliance assertions on regulated surfaces, and the reuse-over-reinvent rule (extend existing tests when possible — do not write fresh tests when the established suite covers the behavior). Loaded by the test-writer agent when authoring slice tests, and by reviewer agents when verifying test-suite dimensions. Loaded as context by other agents — not user-invokable.
---

# test-craft

Domain expertise loaded by the test-writer agent before writing failing tests for a slice's ACs, and by reviewer agents when verifying the test suite. Tests are the documentation of behavior; this skill says what good documentation looks like.

## Principles

- **Pyramid bias.** Unit > integration > e2e. Default to unit; justify any non-unit choice in a one-line comment near the test or in its description.
- **One AC, at least one test; usually one test per AC.** Tests map 1:1 to ACs in the spec. The AC's `[ ]` checkbox flips when the test goes green.
- **Tests are independent.** Any test runnable alone, any order, any subset. No setup that mutates global state without a teardown.
- **Tests are deterministic.** No real time (`Date.now()` is mocked or wrapped); no real randomness; no real network; no flaky retries.
- **Meaningful assertions.** *"didn't throw"* is not an assertion. The assertion describes the observable behavior the AC promises.
- **Test names describe behavior.** Read the test list, you should understand what the slice does. *"signs in via Google OAuth and lands on /meetings"* not *"test sign in"*.
- **Arrange / Act / Assert.** Three clear phases. Most tests have one act; tests with multiple acts are usually two tests.
- **Behavior-driven boundaries.** The system under test is a *behavior*, not a class. A unit test can exercise multiple classes when they collaborate to deliver one behavior.
- **Edge and adversarial cases are first-class.** Every slice carries at least one error-path AC and a test for it. Adversarial paths (malformed input, concurrent access, denial conditions) are not afterthoughts.
- **Coverage is the floor, not the ceiling.** High coverage with weak assertions is worse than moderate coverage with strong ones.

## Compliance assertions

When the slice touches regulated content (PHI / payment / consent / accessibility), the test suite includes assertions for the active pack's rules. Concrete examples:

- **HIPAA access control** — three-user RLS fixture: User A writes a transcript; assert User B cannot read; assert User C with a share grant CAN read.
- **HIPAA audit logging** — assert the `audit_log` table has the expected entry with `(timestamp, principal, action, target_id)` after the action.
- **HIPAA error leakage** — when an error fires on a PHI-bearing endpoint, assert the response and log carry no PHI.
- **OWASP A01 broken access control** — request with no JWT returns 401; request with another user's JWT returns 404 (not 403; prevents enumeration).
- **WCAG accessibility** — axe-core runs against rendered UI in the test; assert zero violations at the configured level.
- **PCI cryptography** — sensitive fields absent from logs, headers, responses; tokens unpredictable.

The pack rules retrieved via `get_relevant_standards` for the slice are the source of truth for which assertions to write.

## Reuse over reinvention

**Read the context file's Test Conventions section before writing any test.** If existing tests cover the AC's behavior, extend them with the new assertion rather than writing a parallel test. If existing fixtures (database setup, user factories, RLS-fixture, etc.) match the slice's needs, use them.

When existing tests are close but not exact:

- **Extend, do not duplicate.** Add the new assertion as a separate `it` / `test` within the existing `describe` block.
- **Refactor existing tests minimally** if needed — but only as much as the slice's ACs require. Reviewer agents flag large-scale test refactor as out-of-slice change.

When in doubt about whether to extend or write fresh, surface the choice in the slice handoff summary. Defaulting to fresh is a defect; default to extend.

## Anti-patterns to avoid

- **Assertion-free tests** — calling code without `expect`. Looks like a test; isn't one.
- **`.only` in committed tests** — slips through review. CI must fail on `.only`.
- **Time-dependent tests** — `expect(getDate()).toBe(today)`. Mock the clock.
- **Real-network tests** — slow, flaky, breaks CI. Use fixtures or fakes.
- **Snapshot-only tests for behavior** — a snapshot tells you when output changed, not whether the change was correct. Snapshots fit stable formats (UI render, serialization), not logic.
- **Tests that depend on order** — passes alone but fails with siblings. Hidden state.
- **Mocking what you don't own.** Mock the adapter (your code); don't mock the SDK underneath.
- **Tautological tests** — `expect(add(2, 2)).toBe(2 + 2)`. Verifies behavior, not the implementation restated.
- **Test files duplicating production logic.** When a test reproduces what the code does, the assertion has lost meaning.

## How to use this skill in your work

When the test-writer agent loads this skill, it should:

1. **Read the task context file's Test Conventions and Reusables sections FIRST** (from `docs/specs/<NNN>-<slug>-context.md`). What test framework, what fixtures, what conventions are already in play.
2. **For each AC in the slice, decide test level (unit / integration / e2e).** Default unit; justify upward in a one-line comment when the AC genuinely needs higher (e.g., RLS verification needs a real DB).
3. **Check for existing tests in the area BEFORE authoring fresh.** Extend, don't duplicate.
4. **Map tests 1:1 to ACs.** Each test's name references the AC ID (`5.1.1: unauthenticated visit redirects to /sign-in`).
5. **Compliance ACs get compliance assertions** drawn from the pack rules in `get_relevant_standards`. Do not skip.
6. **Surface decisions in the handoff summary** — which tests were extended vs. fresh, what level was chosen and why.
