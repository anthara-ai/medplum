---
name: test-execution
description: Tech-agnostic guidance for running tests during a develop run with scope discipline. Three checkpoints per spec — slice-start regression check (test-writer, scoped to prior slices' test files), slice-end verification (developer, scoped to the current slice's test files), full suite once at end-of-spec (orchestrator) as the final gate. No watch mode, no per-AC polling, no per-chunk re-invocations. Loaded by the test-writer and developer agents in the slice loop, and by the debug-fix skill while iterating on a fix. Loaded as context by other agents — not user-invokable.
---

# test-execution

How agents *run* tests during the develop loop. Companion to `test-craft` (what to write). One sentence: scope each test invocation to the test files in play, and let the slice loop's structure determine when to run — three natural checkpoints, never anywhere else.

## Principle

Cold-start cost dominates a develop run's wall time when tests run frequently. The cheapest test invocation is the one not made; the next cheapest is one scoped to a small file set. Per-AC polling and continuous watch mode add complexity (stale-output detection, watcher lifecycle, scope management) for marginal benefit in this loop. Three structured checkpoints deliver the same cold-start economy without the infrastructure.

## Three checkpoints

### 1. Slice-start regression check (test-writer, slice N ≥ 2)

Before writing slice N's tests, run the test files modified in slices 1 through N-1 as a scoped one-shot.

- Skip for the very first slice — no prior tests to check.
- Scope to the test files prior slices touched. Determine via `git diff --name-only --diff-filter=AM <start-of-develop>..HEAD '*.test.*' '*.spec.*'` or via the orchestrator-tracked file list across slice handoffs.
- If failures appear, hand off to the orchestrator with the failure list. The orchestrator routes the developer to fix the regression *before* slice N's tests get written on top of broken state. Do not write new tests over a broken prior suite.
- If green, proceed to write slice N's tests.

### 2. Slice-end verification (developer, every slice)

After writing all the slice's code in one batch, run the slice's test files as a scoped one-shot.

- Run once. **Green:** batch-flip all the slice's ACs `[ ]` → `[x]` in spec + ticket; hand off.
- **Red:** read the output, identify which ACs failed via test names (test names reference AC IDs per `test-craft`), fix only the corresponding code, run again. Repeat within retry budget (default 5 per slice).
- Each fix iteration is one invocation. Tight retry budget — failing fast surfaces a diagnostic to the user faster than burning time on a stuck slice.

### 3. End-of-spec full-suite gate (orchestrator, once)

After the last slice's developer hands off, the orchestrator runs the full test suite as one cold one-shot.

- Catches in-memory state pollution, hidden cross-slice damage, test-order dependence — defects that scoped runs cannot catch by definition.
- One invocation per develop run. Cheap insurance.

## Scope discipline

Every invocation runs a scoped file set — never the whole suite — except the end-of-spec gate.

### Per-stack scoped invocation hints

| Stack            | Scoped invocation example                                    |
|------------------|--------------------------------------------------------------|
| TS/JS (Vitest)   | `pnpm vitest run src/dispatch/dispatch.service.spec.ts`      |
| TS/JS (Jest)     | `pnpm jest src/dispatch/dispatch.service.spec.ts`            |
| Python (pytest)  | `pytest tests/dispatch/test_dispatch.py -q`                  |
| Go               | `go test ./internal/dispatch/...`                            |
| Rust             | `cargo test --test dispatch`                                 |
| JVM (Gradle)     | `./gradlew test --tests "com.example.dispatch.*"`            |
| Ruby (RSpec)     | `bundle exec rspec spec/dispatch/dispatch_spec.rb`           |
| .NET             | `dotnet test --filter "FullyQualifiedName~Dispatch"`         |

The actual command comes from:

1. The project's package / build manifest scripts (`package.json` `test` script, Gradle tasks, etc.).
2. The `docs/specs/<NNN>-<slug>-context.md` Test Conventions section captured by `code-orienteer`.
3. The framework's documented per-file invocation as the fallback.

## Invocation accounting

For a develop run with N slices, M ACs each, no retries:

- Test-writer slice-start regression checks: **N − 1** invocations (slice 1 skips)
- Developer slice-end verifications: **N** invocations (one per slice)
- End-of-spec full suite: **1** invocation
- Total: **2N** invocations

A 3-slice run pays 6 invocations minimum, 9–12 with typical retries (1–2 per slice). A 10-slice run pays ~20–30. Linear with slice count, not multiplicative with AC count — and scoped, so each invocation is cheap.

## What not to do

- **Don't run the whole suite per slice.** It pays cold-start cost for code far outside the slice's scope.
- **Don't pipe through `tail -n N`.** Stdout truncation hides earlier failures; read the full output and find the pass / fail summary line.
- **Don't poll per-AC.** The developer batch-writes code for all the slice's ACs; one invocation at slice end verifies them together. Test names reference AC IDs (per `test-craft`), so the output identifies which AC failed on a re-run.
- **Don't start a watcher.** Continuous watch mode adds watcher-lifecycle complexity for marginal benefit in this loop.
- **Don't run tests in the reviewer agents.** Reviewers read diffs and patterns; they do not execute tests.
- **Don't run a full-suite gate per slice.** Scoped slice-end is the developer's job; full-suite belongs only at end-of-spec.

## How agents use this skill

**test-writer** (at slice N's start):

1. If N ≥ 2: run prior slices' test files (scoped one-shot regression check). If failures, surface to orchestrator with failure list — do not write new tests. If green, proceed.
2. Write the slice's tests for all ACs in one batch. Test names reference AC IDs so the developer can map slice-end output to ACs.
3. Hand off (slice's test file paths, AC mapping). The developer's slice-end run will naturally surface failures in the new tests.

**developer** (per slice):

1. Read context + failing tests + slice content.
2. Write all the slice's code for all ACs in one batch — no per-AC iteration, no mid-batch test polling.
3. Run the slice's test files (scoped one-shot).
4. Green: batch-flip all the slice's ACs `[ ]` → `[x]` in spec + ticket. Hand off.
5. Red: read output → identify failing ACs via test names → fix → run again. Repeat within retry budget (default 5). Surface a diagnostic if budget exhausts.

**debug-fix** (reproduce + verify):

1. Reproduce: scoped one-shot of the specific failing test file.
2. Iterate one change at a time; run the same scoped test after each change. Stop when green.
3. Verify: run the related test suite as a scoped one-shot covering the modules the fix touches (broader than the single test, narrower than full suite).
