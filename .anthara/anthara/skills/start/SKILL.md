---
name: start
description: Triage router and the first command to run when the user doesn't know which Anthara command applies. Takes a description, classifies the work (bug / small feature / large feature / exploratory / existing artifact pointer), detects regulated context, and recommends the right chain entry — brainstorm, discovery, spec-writer, debug-fix, develop, create-ticket, or skip Anthara entirely. Always confirms before invoking. Use when the user runs /anthara:start, says "kick off a feature", "I want to build X", "we need to fix Y", "where do I start", "which Anthara command", or describes work without picking a command themselves.
argument-hint: <description of what to build, fix, explore, or a URL/path to an existing discovery or spec>
allowed-tools: Read, Bash, Skill
---

# /anthara:start

Triage router. Takes a description, classifies the work, recommends the right chain entry point, then invokes the chosen command. The user's first interaction with Anthara when they don't yet know which command to run.

## Operating principles

- **Closed questions ALWAYS go through `AskUserQuestion`.** No exceptions. Plain-text numbered questions are a defect. Before sending any message containing a question, classify each: closed (yes/no, choose-one, binary) → `AskUserQuestion`; open (the value is in the user's words) → text. Mixed messages send the open part as text and the closed part as a tool call in the same turn. If you find yourself writing `1. ... 2. ... 3. ...` as questions, stop — that is the failure mode.
- **At most 2 closed questions before routing.** If you need more elicitation, that's a discovery signal — invoke `/anthara:discovery` directly with what you have (Step 5). Even when the user's prompt explicitly asks for "clarifying questions," route to discovery — discovery is where elicitation belongs, not start.
- **Silent routing within Anthara; confirm only when bailing out.** brainstorm / discovery / spec-writer / develop / debug-fix / create-ticket are reversible — invoke directly via `Skill` with the structured context note from Step 6. Confirm only the "skip Anthara, fix manually" path, which exits the chain.
- **Detect regulated context once.** Pack detection drives whether trivial fixes get a spec or skip Anthara entirely.
- **Stateless.** start records nothing; the routed-to command does its own memory writes.

## Step 1: Read the description

Parse the user's argument for signal words and structure:

- **Debug/diagnose signals** — *"debug"*, *"why is this failing"*, *"diagnose"*, *"tests are broken"*, *"returns 500"*, *"getting an error"*, *"stack trace"*, *"flaky"*, *"intermittent"*, specific error messages or stack traces pasted directly, CI failure URLs.
- **Bug-fix signals** — *"fix"*, *"broken"*, *"not working"*, *"bug in"*, *"regression"*, specific symptom phrases (*"page 2 missing first item"*, *"login fails when..."*).
- **Small-feature signals** — *"add"*, *"build"*, with concrete scope (*"a button to..."*, *"an endpoint for..."*).
- **Larger-feature signals** — *"build a system"*, *"new product area"*, multiple actors mentioned, multi-stakeholder hints.
- **Brainstorm signals** — *"brainstorm"*, *"what are our options"*, *"how might we"*, *"what if we"*, *"help me think through"*, *"explore approaches"*, *"let's brainstorm"*, open-ended problem with no clear direction yet.
- **Exploratory signals** — *"explore"*, *"investigate"*, *"we're thinking about"*, *"figure out"*, *"research"*, no clear scope but has identifiable stakeholders or inputs to synthesize.
- **Pointer signals** — `https://...`, `docs/specs/...`, *"see the discovery doc at"*, *"per the spec at"*. The user has a starting artifact.

If a URL or file path is provided, that takes precedence — route to the next chain step from that artifact (Step 3 mapping).

## Step 2: Quick context scan

If running inside a repo (cap at ~5 reads — start is triage, not exploration):

- Compute `raw_remote_url = git remote get-url origin`.
- Parse `<owner/repo>` from `raw_remote_url` (e.g., `github.com/anthara-ai/plugin` → `anthara-ai/plugin`). Never `ORG_WIDE`.
- List `docs/specs/` for existing specs (informational — useful when recommending).
- Read `README.md`, `CLAUDE.md`, and one top-level package/config file (`package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod`) if present. Note primary stack, frameworks, and major modules in 2-4 bullets. These bullets feed the **Codebase observations** field of the structured context note in Step 6 — so future skills don't redo this scan.

Call `get_standards(<owner/repo>)` on fabric MCP. Inspect active packs.

- **Regulated context** — any of `hipaa`, `pci`, `soc-2`, `fda-samd`, `gdpr` (or close variants by pack-name) are active.
- **Non-regulated context** — only general packs (`clean-code`, `owasp`, `wcag`, `test-integrity`, etc.) are active.

This drives the bug-fix routing in Step 3.

If fabric is unreachable: assume regulated by default (Anthara's value prop is regulated industries; safer assumption). Note the assumption to the user.

**Detect RISK from description signals.** Risk is a second axis alongside the bucket. It flows downstream to every command — spec depth, develop retry budget, ship checklist, audit weight.

| Risk | Signals |
|---|---|
| **LOW** | Internal tool, low traffic, easy to revert, no regulated data, dev / staging only |
| **MODERATE** | User-facing surface, moderate traffic, some business logic, non-regulated data |
| **HIGH** | Payment flow, authentication / authorization, data migration, regulated content (PHI / PCI / etc.), high-traffic endpoint, hard-to-revert change, third-party integration with no idempotency |

If the description has explicit risk signals (*"payment"*, *"login"*, *"migrate"*, *"PHI"*, *"production database"*), classify accordingly. If unclear, ask once via `AskUserQuestion` at Step 4.

Risk threads forward as a hint to the invoked skill in Step 6.

## Step 3: Heuristic classification

Map description signals + regulated context to a bucket:

| Bucket | Description signals | Regulated? | Route |
|---|---|---|---|
| Debug/diagnose | debug/diagnose, error message, stack trace, CI failure, *"why is this failing"* | either | `/anthara:debug-fix` |
| Trivial fix (regulated) | bug-fix, localized, user already knows the cause | yes | `/anthara:spec-writer` (bug-fix mode) → `/anthara:develop` |
| Trivial fix (non-regulated) | bug-fix, localized, user already knows the cause | no | Skip Anthara — suggest manual fix; offer `/anthara:create-ticket` for tracker entry |
| Small feature | clear scope, single slice expected | either | `/anthara:spec-writer` → `/anthara:develop` |
| Larger feature | clear scope, multi-slice / multi-stakeholder | either | `/anthara:spec-writer` → `/anthara:develop` (spec-writer's grill-me will fire) |
| Brainstorm | open-ended, no plan yet, *"brainstorm"*, *"options"* | either | `/anthara:brainstorm` → `/anthara:discovery` → `/anthara:spec-writer` → `/anthara:develop` |
| Exploratory | fuzzy, multi-stakeholder, *"explore"*, has inputs to synthesize | either | `/anthara:discovery` → `/anthara:spec-writer` → `/anthara:develop` |
| Existing artifact (discovery doc) | user pointed at a discovery brief | either | `/anthara:spec-writer` against that doc |
| Existing artifact (spec) | user pointed at a spec | either | `/anthara:develop` against that spec |

If the heuristic is unambiguous, advance to Step 5. Otherwise Step 4.

## Step 4: Targeted elicitation (only if heuristic is unsure)

**Hard cap: 2 closed questions max.** If the heuristic from Step 3 is already unambiguous, skip Step 4 entirely. After 2 closed `AskUserQuestion` calls, if the route is still unclear, that's a discovery signal — proceed to Step 5 with bucket `exploratory` and silently invoke `/anthara:discovery` with the structured context note. Do not open a third question.

**Per-message check.** Before sending any message in this step, classify every question: closed → `AskUserQuestion`; open → text. Plain-text numbered question lists are a defect (the model's default tendency under user pressure — resist it).

Pick from these closed-question options for the disambiguating `AskUserQuestion` calls:

- *"Is this a bug fix or new functionality?"* — bug / feature / refactor / exploring.
- *"How big do you think it is?"* — single file / a few files / new module / new product area.
- *"Risk level?"* — low (internal, easy revert) / moderate (user-facing, some business logic) / high (payment, auth, migration, regulated data, hard to revert).
- *"Do you have an existing discovery doc or spec already?"* — yes (with pointer) / no.

Skip questions the heuristic already answered. The goal is one or two questions, never a wall.

## Step 5: Choose and invoke the route

Map the bucket from Step 3 (or `exploratory` if Step 4 hit the elicitation cap) to a route. Invoke the route's entry skill via `Skill` directly with the structured context note from Step 6 — no intermediate confirmation. The single exception is the "skip Anthara, fix manually" path: surface that one recommendation via `AskUserQuestion` (options: *Skip and fix manually / Create a tracker entry first / Route through Anthara anyway*) because it exits the chain.

| Bucket | Route |
|---|---|
| Debug / diagnose | `/anthara:debug-fix` |
| Trivial fix (regulated) | `/anthara:spec-writer` (bug-fix mode) → `/anthara:develop` |
| Trivial fix (non-regulated) | Confirm via `AskUserQuestion` — skip Anthara default; tracker-entry and route-anyway as alternatives |
| Small feature | `/anthara:spec-writer` → `/anthara:develop` |
| Larger feature | `/anthara:spec-writer` → `/anthara:develop` |
| Brainstorm | `/anthara:brainstorm` → `/anthara:discovery` |
| Exploratory | `/anthara:discovery` → `/anthara:spec-writer` → `/anthara:develop` |
| Pointer to discovery doc | `/anthara:spec-writer` |
| Pointer to spec | `/anthara:develop` |
| Elicitation overflow (>2 questions needed in Step 4) | `/anthara:discovery` |

For multi-step routes, invoke only the **first** skill. The chain unfolds naturally — discovery's hand-off mentions spec-writer, spec-writer's mentions develop, etc.

## Step 6: Invoke the chosen skill with the structured context note

Invoke via the `Skill` tool. The argument is a **structured prose block** — loose prose, not JSON; downstream skills read what they need without parsing a schema. Required format:

```
<user's original prompt verbatim>

---
ROUTED FROM /anthara:start

Bucket: <bucket name from Step 5 table>
Risk: <LOW | MODERATE | HIGH>
Regulated packs active: <comma-separated pack names, or "none">
Codebase observations: <2-4 short bullets from Step 2's scan, if any; "none" if not in a repo>
Pointer: <URL or path if user provided one, else "none">

Provisional elicitation questions (use, refine, or skip):
1. <Q1>
2. <Q2>
...
```

Rules:

- The block is required for every silent invocation. No exceptions.
- **Provisional elicitation questions** are the ones start *would* have asked if it kept asking — capture them here instead of asking the user. They land in discovery (or whichever skill is invoked) as a starting elicitation set, not a wall. Closed and open both fine — discovery's Tool discipline section routes closed ones through `AskUserQuestion`.
- The risk hint scales spec-writer's grilling depth and develop's reviewer-retry budget — propagate it accurately.

For "skip Anthara" routes (trivial fix in non-regulated context, user picked "fix manually" in Step 5's `AskUserQuestion`): tell the user explicitly, suggest the manual-fix shape (which file, which test to add), then exit. Do not invoke a skill, do not emit the context block.

## Rules

- **Render closed questions via `AskUserQuestion`** — yes/no, choose-one, binary. Plain-text numbered lists are a defect.
- **Cap elicitation at 2 closed questions.** Over the cap → invoke `/anthara:discovery` silently with the structured context block; do not ask a third.
- **Invoke within-Anthara routes silently** — brainstorm / discovery / spec-writer / develop / debug-fix / create-ticket all run directly via `Skill` with the structured context note. Only the "skip Anthara, fix manually" path needs `AskUserQuestion` confirmation because it exits the system.
- **Detect regulated context every run** — the one fabric call start always makes; drives bug-fix routing.
- **Routing is start's job; framing is the routed-to skill's job** — never scope, frame, or pre-elicit on behalf of the downstream skill. Capture provisional questions in the context block instead.
- **Read and triage, don't write.** start does not modify files and does not record to Org Memory; the routed-to command does its own memory writes.
- **One open question per turn** (per Tool discipline). Closed questions go through `AskUserQuestion` in the same turn.
