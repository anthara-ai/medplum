---
name: debug-fix
description: Systematic debugging for regulated codebases. Reproduces the failure, reads everything (errors, logs, console, code), checks Fabric org memory for known gotchas, narrows systematically, finds the root cause, fixes with compliance guardrails, and verifies. Ensures debugging instrumentation never leaks PHI/PCI data. Use when the user runs /anthara:debug-fix, says "debug this", "why is this failing", "fix this bug", "tests are broken", "this endpoint returns 500", or describes a specific failure symptom they want diagnosed.
argument-hint: <symptom description, error message, failing test name, or URL to a failing CI run>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# /anthara:debug-fix

Systematic debugging for regulated codebases. Read and analyze first, change code last. Most debugging failures come from jumping to fixes before understanding the problem.

## Operating principles

- **Reproduce before theorizing.** Confirm the failure exists by running the failing test, hitting the endpoint, or triggering the flow. Without reproduction, understanding is incomplete.
- **Read everything before changing anything.** The full error, the logs, the code path, the browser console. The root cause is usually already visible — buried deeper than the first line.
- **Check org memory for known gotchas.** Before deep investigation, search Fabric for prior incidents, architectural gotchas, and known flaky patterns in the affected area. Someone may have already documented the trap.
- **Compliance-safe instrumentation.** When adding debug logging, never log PHI, payment tokens, credentials, or query strings that may carry regulated content. Log identifiers and event types only. Remove all instrumentation after diagnosing.
- **One change at a time.** Make one change, observe the result, then decide the next step. Multiple simultaneous changes prevent identifying which one resolved the issue.
- **Root cause over symptom.** A null pointer exception is a symptom — the root cause is *why* the value is null. Trace backwards; don't stop at the first explanation.
- **Explain before fixing.** If you can't articulate the root cause, you haven't found it yet.
- **Verify after fixing.** Re-run the failing test, run related suites, check actual behavior. Never declare "fixed" based on the code looking right.
- **Tool discipline.** Closed questions through `AskUserQuestion`. One open question per turn. Use available MCP tools (browser, database, LSP) before adding workarounds.

## Step 1: Understand the symptom

Parse the user's description for:

- **Error signals** — stack traces, error codes, HTTP status codes, exception names, log lines.
- **Behavioral signals** — *"page is blank"*, *"button does nothing"*, *"data is stale"*, *"login redirects to wrong page"*.
- **Test signals** — test name, assertion failure message, `FAIL` output.
- **CI signals** — URL to a failing run, workflow name, step that failed.
- **Regression signals** — *"this worked yesterday"*, *"broke after the last deploy"*, *"started after merging PR #N"*.

If the symptom is vague, ask one clarifying question via `AskUserQuestion`: *"Can you share the exact error message or the failing test name?"*

## Step 2: Check org memory for known issues

Before investigating code, search Fabric for prior knowledge about the failure area:

```
search_facts("<service name> <error keyword>")
search_facts("<module name> gotcha")
search_facts("<test file name> flaky")
```

Known patterns to look for:
- Prior incidents with the same root cause (avoid re-diagnosis).
- Architectural gotchas documented by the team (DI traps, nock race conditions, seed-build conflicts, webhook secret rotation — these are real patterns in Anthara repos).
- Environment-specific issues (WSL Redis port conflicts, CI-vs-local divergence from missing `.env`).

If org memory surfaces a match, verify it still applies (memory can be stale — check the current code state). If it's a known gotcha with a documented fix pattern, apply it directly and skip to Step 7.

## Step 3: Reproduce the failure

Confirm the failure before touching code.

- **Test failure** — run the specific test: `pnpm test -- --testPathPattern="<file>" --testNamePattern="<name>"` (or the project's equivalent).
- **Endpoint failure** — hit the endpoint with `curl` or the project's HTTP client. Check the response body AND status code.
- **UI failure** — if Chrome MCP is connected, navigate to the page, check console errors, inspect network requests. Don't guess what the user sees — look at it.
- **CI failure** — read the full CI log. Identify whether the failure is in build, lint, typecheck, test, or deploy.
- **Flaky failure** — run the test 3 times. If it passes intermittently, the bug is timing-dependent (race condition, test-order dependency, uncontrolled clock/network). Note this — it changes the investigation strategy.

If you cannot reproduce: say so explicitly. Do not proceed to fix. Instead, add targeted instrumentation (Step 5) to capture the failure on next occurrence.

## Step 4: Read everything

Before theorizing, read:

- **The full error** — the entire stack trace, not just the first line. The root cause is often buried deeper.
- **The logs** — application logs, server output, build output. They often tell you exactly what went wrong.
- **The browser console** — for frontend: console errors, network failures, failed requests, CORS issues. Check the Network tab for status codes and response bodies.
- **The code** — trace the actual execution path from entry point to failure. Don't guess what the code does — read it.
- **The test** — read the failing test's setup, act, and assert. Is the test correct? Sometimes the test is wrong, not the code.
- **Recent changes** — `git log --oneline -10` on the affected files. If this is a regression, the introducing commit is often in the last few changes.

### Verify assumptions

The bug is often in the gap between what you assume and what's actually true:

- Is the file you're editing the one actually being executed?
- Is the environment variable set? Is it the right value?
- Are you on the correct branch? Is the code deployed/built?
- Is the service running? Is the database reachable?
- Is the test running against the code you think it is?
- In NestJS: is the module importing what you think? (DI gotchas are common.)

## Step 5: Narrow systematically

Use binary search to shrink the problem space:

- Comment out half the logic — does it still fail?
- Hardcode an intermediate value — does the downstream code work?
- Use the simplest possible input — does the base case work?
- Isolate the layer — is the bug in the controller, service, repository, or external call?

### Add instrumentation when needed

When existing logs aren't enough, add targeted logging at the divergence point:

- Log actual values, not just "reached here".
- **Never log PHI, payment data, or credentials** — log record IDs, operation types, and event metadata only. This is a hard constraint from active compliance packs.
- Analyze the output before making the next move.
- Remove all instrumentation after diagnosing.

### Use available tools

Don't debug blind when integrations are available:

- **MCP servers** — if LSP tools are available, use them to trace references, find callers, and check types. If database tools are available, query the actual data (SELECT only — never UPDATE/DELETE/DROP).
- **Browser automation** — if Chrome MCP is connected, check the console, inspect network requests, read the actual DOM state.
- **Shell tools** — check running processes, port bindings, environment variables, file permissions. The answer is often one command away.

## Step 6: Find and articulate the root cause

Symptoms and root causes are different things.

- Trace backwards from the failure to the origin of the bad state.
- Ask "why?" at each layer — don't stop at the first explanation.
- A fix that addresses the symptom will break again. A fix that addresses the root cause won't.

**Articulate the root cause before writing the fix.** State it clearly:

- Bad: *"I'll try changing this parameter and see if it works."*
- Good: *"The query returns null because the join uses the wrong foreign key — `user_id` references `accounts` but should reference `users`."*

If you can't articulate it, go back to Step 4. You haven't found it yet.

## Step 7: Fix with compliance guardrails

Before writing the fix, check whether the affected code path touches regulated content:

- If the fix touches endpoints that serve ePHI, payment data, or audit-logged operations: load standards via `get_relevant_standards` with the fix's surface area.
- If active packs include HIPAA / PCI / SOC 2: ensure the fix maintains existing access control, audit logging, and encryption posture. Never bypass RLS, guards, or existing auth checks as part of a fix.
- If the fix changes error handling on a regulated path: ensure error messages and logs carry no regulated content.

Write the minimal fix that addresses the root cause. Do not refactor surrounding code, add features, or clean up adjacent issues — those are separate work items.

## Step 8: Verify the fix

The fix isn't done until you've confirmed it works:

- Re-run the specific failing test — does it pass now?
- Run the full related test suite — did the fix break anything else?
- If it's a frontend fix, check the browser — does the UI behave correctly?
- If it's a data fix, query the actual data — is the state correct?
- If the original failure was in CI, confirm the fix addresses the CI-specific condition (CI often lacks `.env` files, has different scheduling, etc.).

Never declare "fixed" based on the code looking right. Prove it.

## Step 9: Record the gotcha (if warranted)

After fixing, evaluate whether this bug represents a durable gotcha worth recording to Fabric org memory:

- **Save if:** the root cause was non-obvious, could trap another developer, stems from an architectural decision or external-system quirk, or is environment-specific (CI vs. local divergence).
- **Skip if:** the bug was a straightforward typo, logic error, or something obvious from the code.

If saving, use `add_shared_memory` with a clear pattern: what the gotcha is, why it happens, and the fix pattern. Confirm with the user before saving to shared memory.

## Escape hatches

- **If the same approach failed twice, stop.** Retrying the same thing is not debugging — it's hoping. Step back, re-read, and try a different angle.
- **If you've exhausted analytical approaches (Steps 3-6) and still can't find the root cause:** say so explicitly. Suggest targeted instrumentation to capture the failure on next occurrence, or recommend pairing with another developer who knows the area.
- **If the fix is risky (touches auth, payment, data migration):** surface the risk to the user via `AskUserQuestion` before applying. Offer to write the fix as a separate branch for review.
- **Trial-and-error is a last resort.** Only after exhausting reproduce → read → narrow → articulate. If you find yourself guessing, go back to reading.

## What NOT to do

- Do not jump to code changes before reproducing and understanding the failure.
- Do not make multiple changes at once hoping one of them works.
- Do not log PHI, payment data, credentials, or regulated content during debugging — even temporarily.
- Do not bypass access control, RLS, or auth guards as a debugging shortcut.
- Do not delete or modify production data while investigating. SELECT only.
- Do not declare "fixed" without running the failing test and related suites.
- Do not skip org memory search — prior gotchas save hours.
- Do not add permanent debug logging. All instrumentation is temporary.
- Do not refactor, clean up, or improve code adjacent to the fix. Fix the bug; nothing more.
