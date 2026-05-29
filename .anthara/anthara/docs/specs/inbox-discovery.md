# Discovery: /inbox — a role-tuned, channel-agnostic work aggregator for Claude Code

> Owned by: Sapan  ·  Started: 2026-05-25  ·  Last synthesized: 2026-05-25
> Anthara discovery brief — multi-stakeholder living document. Run `/anthara:discovery` against this doc to add inputs.

---

## 1. Problem framing

A developer's work is fragmented across many channels — Jira, GitHub, Slack, Linear, Gmail, Teams, Notion — and the "what should I work on next" decision currently requires checking five-plus tabs every time the developer hits a context switch. The cost is paid most heavily at re-entry moments (start of day, between tasks, post-meeting) where shallow signal in any one channel can pull attention away from the highest-leverage work in another. `/inbox` is a Claude Code slash command that pulls every connected work channel via MCP, enriches each item with structured features, and asks the model to produce one flat ranked table of the work most worth doing now — tuned to the user's role and biased by an optional natural-language hint. The audience for v1 is Anthara users (regulated-industry developers), with the command living at `skills/inbox/SKILL.md` alongside the rest of the Anthara chain. Urgency tier: "important but not urgent" — this is a dogfood-driven build with Sapan as the first user, not a critical-path delivery.

## 2. Sources

| ID | Type | Contributor | Date | Description |
|---|---|---|---|---|
| 1 | Live brainstorm session with Sapan | Sapan | 2026-05-25 | Idea framing, frame challenges, five named options (Chief of Staff / Triage Board / Hourly Skim / Role-Adaptive / Anti-Inbox), convergence on Role-tuned work aggregator concept |
| 2 | Live discovery session with Sapan | Sapan | 2026-05-25 | Closure-loop answers on privacy, wizard scope, memory layer, learning bar, dedup bias, latency stance, staleness stance, output format, audience |
| 3 | Anthara plugin repo scan | Discovery facilitator | 2026-05-25 | `.mcp.json` shows only fabric + codebase-memory-mcp declared at plugin scope; existing skills include start/brainstorm/discovery/spec-writer/develop/create-ticket/debug-fix/collaboration-loop; `docs/fabric-adoption.md` defines the prefix-tag convention for fabric writes |
| 4 | Public docs (prokopov.me/posts/daily-standup-skill-for-claude-code) | Web | 2026-05-25 | Reference: Maksym Prokopov's morning-routine skill — three JQL queries + Confluence search + GitHub `gh` CLI; static priority order; 1-day or 3-day-on-Monday lookback; single-repo limitation |
| 5 | Public docs (dev.to/ayan_putatunda — Building a Claude Code Slash Command That Writes Your Daily Standup Updates) | Web | 2026-05-25 | Reference: `/standup` slash command — backward-looking (git commits + Claude Code session files + optional Jira); parallel-agent architecture; minimal-config-over-convention |
| 6 | Public docs (docs.slack.dev/ai/slack-mcp-server) | Web | 2026-05-25 | Slack MCP — production-grade as of 2026; tools include `slack_search_public`, `slack_search_public_and_private`, `slack_read_channel`, `slack_read_thread`, `slack_search_users` |
| 7 | Public docs (developers.google.com/workspace/gmail/api/guides/configure-mcp-server) | Web | 2026-05-25 | Gmail MCP — 10 tools including `search_messages`, `search_threads`, `get_thread`; production status with a known regression on `get_thread` body retrieval (anthropics/claude-ai-mcp#194, April 2026) |
| 8 | Public docs (developers.notion.com/guides/mcp/overview, linear.app/changelog 2026-04-23) | Web | 2026-05-25 | Notion MCP — hosted by Notion, works with Claude Code. Linear MCP — Linear Agent gained MCP support April 2026; production-grade community servers exist |
| 9 | Public docs (developer.microsoft.com/blog/10-microsoft-mcp-servers) | Web | 2026-05-25 | Teams MCP — official server exists for M365 orgs; community-built options for message search and meeting notes; quality is mixed across community servers |
| 10 | Anthara plugin internal — `docs/fabric-adoption.md` and existing skill prefix conventions | Discovery facilitator | 2026-05-25 | Convention: fabric writes use prefix-tagged entries (`[GLOSSARY <project> ...]`, `[ARCH-DECISION ...]`, etc.); `/inbox` will add `[INBOX-PROFILE ...]` and `[INBOX-LEARNED ...]` prefixes per the same convention |

## 3. Type ontology

Drawn from session corpus and the channel-pluggability architecture that emerged.

### 3.1 Kinds of users

The role taxonomy is a **fixed finite ontology**, not free text. Each role has a default auto-scope and a default ranking bias. A free-text "Other / custom" role-description hint is allowed for edge cases that don't fit cleanly (player-coach EM, founder-IC hybrid, contractor with mixed responsibilities) [1, 2].

- **Junior IC** — ships assigned code; "good day" = shipping. Auto-scope: personal feed only. Bias: own tickets above everything else [1].
- **Senior IC** — ships harder code + mentors. Auto-scope: personal + team. Bias: review queue and own-PR-feedback weighted up [1].
- **Staff / Principal** — unblocks the org. Auto-scope: personal + team + cross-org signal. Bias: others' work weighted ABOVE own routine work; RFCs and architecture decisions surfaced [1].
- **Tech Lead** — team velocity + delivery. Auto-scope: personal + team blockers + sprint anomalies. Bias: stale-PR-anywhere-in-team weighted up [1].
- **Engineering Manager** — people + delivery. Auto-scope: + reports' blockers + 1:1 prep + escalations. Bias: people-shaped signals weighted up [1].
- **Product Manager** — discovery + delivery + comms. Auto-scope: + stakeholder threads + decisions awaiting input + customer messages. Bias: external-facing items weighted up [1].
- **Founder / solo** — whatever's on fire. Auto-scope: mixed, impact-weighted. Bias: model judgment most useful here because categories blur [1].
- **Other / custom** — free-text self-description hint feeds the model as a role-prompt addition. Used when nothing above fits [2].

### 3.2 Kinds of data

- **Work item** — the unit of `/inbox` output. Carries: `kind`, `source`, `id`, `title`, `opener`, `opener_role` (if known), `age`, `last_activity`, `linked_items[]`, `signals{...}` (free-form features), `link`, `your_relationship` (assigned / reviewer / mentioned / blocking-others / etc.) [1, 2].
- **Profile** — the user's role + tools + time zone + usernames + manager + any other onboarding facts. Persisted to fabric private memory under `[INBOX-PROFILE anthara-ai-plugin ...]` [2, 10].
- **Learned fact** — anything the user explicitly told `/inbox` to remember (e.g., "ACME is our biggest client"). Persisted under `[INBOX-LEARNED anthara-ai-plugin ...]`. Behavioral signals do not produce learned facts; only explicit teaching does [2, 10].
- **Hint** — free-text natural-language modifier passed as `/inbox <hint>` (e.g., `i'm on-call`, `no meetings today`, `just got back from PTO`). Ephemeral — never persisted [1, 2].
- **Channel adapter manifest** — per-MCP YAML-shaped config declaring "what counts as MY work on this channel" (e.g., for Jira: `mine: assignee = currentUser() AND status != Done`). Adding a channel = adding a manifest, not editing code [1].

### 3.3 Kinds of events

- **`/inbox` invocation** — user runs the command with an optional hint. Triggers parallel MCP queries, enrichment, model ranking, render [1, 2].
- **Row action** — user says "let's work on #3" or "ignore #5" in subsequent chat. The number addresses the rendered table from the most recent `/inbox` output, which lives in the conversation context. No dedicated commands [1].
- **Curiosity ask** — when the user picks a row and the rationale isn't obvious to the model, the model asks: *"I'm curious, why this one?"* The user's answer (or refusal) is the teaching signal candidate [2].
- **Explicit teaching** — user says something like *"remember that ACME is our biggest client"* or answers a curiosity ask with a fact worth retaining. The model writes a `[INBOX-LEARNED ...]` entry to fabric [2].
- **First-run wizard** — fires once per profile-absent invocation. Onboards the role, tools, time zone, usernames, manager. Writes `[INBOX-PROFILE ...]` to fabric [2].

### 3.4 Kinds of states

- **Profile-absent** — fabric has no `[INBOX-PROFILE anthara-ai-plugin ...]` entry. Triggers the first-run wizard [2].
- **Profile-present** — wizard answers stored; subsequent invocations skip onboarding [2].
- **Behavioral-signal-only** — user acted on a row but did not answer the curiosity ask (or the model didn't ask). Influences the current ranking; does not persist [2].
- **Hint-active** — current invocation carries a hint string. Model uses it as a ranking-policy modifier and surfaces its influence in the "Why now" column [1].

## 4. Journeys

### 4.1 First-time invocation (profile-absent)

1. User types `/inbox` for the first time. Skill checks fabric: `search_facts("[INBOX-PROFILE anthara-ai-plugin")` returns empty [2, 10].
2. Skill runs the wizard — exact question set is not exactly three questions; the wizard is intentionally a richer onboarding to build a useful profile for the model. Confirmed candidates: **role** (from the fixed ontology in 3.1), **primary tools/channels** the user uses, **time zone**, **usernames** the user goes by across channels (for `@-mention` detection), **manager's name** (for "who should I be unblocking" reasoning) [2].
3. Skill detects connected MCPs by inspecting `.mcp.json` plus user-level Claude Code MCP configuration. The set drives which channels are queried [1, 3].
4. Skill writes the profile to fabric: `add_shared_memory("[INBOX-PROFILE anthara-ai-plugin role=<X> tools=[<Y>] tz=<Z> ...]")` [2, 10].
5. Skill proceeds to a regular invocation (Journey 4.2) using the just-saved profile.
6. **Error path missing in corpus** — what happens if fabric is unreachable during first-run wizard? Defer the persistent profile; run with an in-memory profile for the session only? Refuse and prompt the user? Surface for spec-writer.

### 4.2 Regular invocation

1. User types `/inbox` or `/inbox <hint>` (e.g., `/inbox i'm on-call`) [1, 2].
2. Skill loads profile + retrieves all `[INBOX-LEARNED anthara-ai-plugin ...]` entries from fabric [2, 10].
3. Skill kicks off parallel MCP queries — one per connected channel, scoped to the user's auto-scope (role-driven) using each channel's adapter manifest [1, 2].
4. Each channel returns raw items; skill normalizes them to the `Work item` schema (3.2) and enriches each with all available structured features (age, opener, links, blocking count, priority, deadline, last activity, your relationship) [1].
5. Skill applies cross-source coupling — string-match on IDs in titles/descriptions, URL extraction in message bodies, fuzzy linking by author + time window. Bias is **under-couple over over-couple**: when uncertain, show as separate rows. False positives kill trust; false negatives are mildly annoying [2].
6. Skill hands the enriched item set + profile + hint to the model. Model returns a flat ranked table of approximately ten rows. Columns: `#`, `Kind`, `Item`, `Why now` [1, 2].
7. Skill renders the table to the terminal as Claude Code markdown output [1].
8. **Workaround:** No explicit dismiss / snooze / pin commands. The table itself is conversationally addressable state — user says "let's work on #3", "ignore #5", "what's the context on #7?" and the model resolves the references from the in-context table [1, 2].
9. **Error path missing in corpus** — what happens when one MCP times out or returns an error? The brief commits to parallel queries with no SLA; spec-writer will need to decide whether to render partial results, retry, or signal the failure inline.

### 4.3 Row-action → curiosity → learning

1. After the table renders, user says *"let's work on #3"* [2].
2. Model resolves #3 from the in-context table [1, 2].
3. Model decides whether the choice is *obvious* (e.g., #3 is the only P0, on-call hint is active) or *non-obvious*. If non-obvious, model asks: *"I'm curious, why this one?"* [2].
4. User answers (or doesn't) [2].
5. If the answer contains a fact worth retaining (and only if the user's framing implies it should persist, e.g., *"because ACME is our biggest client"*), model writes `[INBOX-LEARNED anthara-ai-plugin fact='ACME is the biggest client; tag-ACME tickets default to P0' ...]` to fabric. Behavioral signals alone (user picked #3) **do not** produce a learned fact — explicit teaching is the bar [2, 10].
6. **Error path missing in corpus** — what is the exact grammar of "explicit teaching"? Does the user have to say "remember"? Or does the model judge from context? The brief leans toward "model judges" but flag for spec-writer.

## 5. Findings

### 5.1 Theme: Channel pluggability is the architectural thesis

**5.1.1 Adding a channel = adding a manifest, not editing code.**
- Signal strength: **Strong** (single source but load-bearing; user named this explicitly as the architectural commitment).
- Sources: [1, 2].
- Quote: *"Think of an architecture such that adding a new channel should not need to change code or add more code. Channels are Jira, GitHub, Slack, Teams, emails... imagine anything work can come from. LLM analyzes and presents it as an inbox."* — Sapan, live brainstorm [1].
- Implication for spec-writer: the channel-adapter contract is the spec's central abstraction. Probably a `channels/<name>.manifest.yaml`-shaped declaration per channel + a normalization function from raw MCP output to the `Work item` schema in 3.2. Linear, Notion, Gmail, Teams support is *free* if their MCPs expose enough data.

**5.1.2 MCP availability is uneven and the spec must declare which channels are v1.**
- Signal strength: **Strong** (web research across four MCPs).
- Sources: [6, 7, 8, 9].
- Green-light channels for v1 (production-grade MCPs with the right tools): Atlassian Jira/Confluence, GitHub, Slack, Linear, Notion, Gmail.
- Yellow-light (caveats): Teams MCP — official version exists for M365, but community-built variants are mixed; spec should declare whether to commit to the official one only or accept community-supplied alternates [9]. Gmail has a known `get_thread` body-retrieval regression as of April 2026 [7] — spec should declare graceful degradation when bodies are missing.
- Implication: the brief recommends v1 ships with Atlassian, GitHub, Slack, Linear, Notion, Gmail manifests; Teams behind a feature flag.

**5.1.3 A channel is anything that returns work-bearing items — MCP *or* Bash-callable CLI.**
- Signal strength: **Strong** (revealed during first-day dogfood: the GitHub MCP is not always installed, but `gh` is universally present on dev workstations).
- Sources: [1, 2].
- The first-day usage of the skill exposed two real-world facts: (a) most developers have `gh` installed and authenticated at the OS level but do not have the GitHub MCP configured in Claude Code; (b) `gh` is strictly more capable than the MCP for some queries (e.g., `gh pr list --search "review-requested:@me"`, `gh search issues "assignee:@me state:open"`). If the brief commits to "MCP-only" for channel detection, `/inbox` silently skips GitHub on the common case — strictly worse than Prokopov's morning-routine skill [4] which uses `gh` via Bash on purpose.
- Resolution: channels are detected from **both surfaces** — connected MCPs and installed CLIs. Detection criterion is "returns *work-bearing items*", not "has a search tool" — which also excludes infrastructure / memory MCPs (fabric, codebase-memory-mcp) from the channel set even though they expose search tools.
- The wizard's channels question must always read "MCPs and CLI commands" so the user understands both access paths exist; the "Other" / "Type something" option must explicitly invite typing additional tool names not auto-detected.
- Implication: each channel manifest carries an access-path field — `mcp` or `cli`. Detection probes for the MCP tool list and for `command -v <name>` on a seed list of CLIs (`gh`, `glab`, `linear`). Step 5 queries fire in one assistant turn via Claude Code's parallel-tool-call primitive, which parallelizes MCP calls and Bash calls together.

### 5.2 Theme: Role-tuning is the unique angle

**5.2.1 None of the existing reference tools do role-aware ranking.**
- Signal strength: **Strong** (multi-source: brainstorm convergence + verified prior art).
- Sources: [1, 4, 5].
- Prokopov's morning-routine [4] is hard-coded JQL written by him for him — not role-tuned. `/standup` [5] is backward-looking and one-size-fits-all. Neither generalizes to "staff engineer needs different output than junior IC."
- Quote: *"Staff engineer should focus on unblocking others, junior should focus on proactively working on things."* — Sapan, live brainstorm [1].
- Implication: role-driven auto-scope (3.1) + role-driven ranking bias is the differentiator. The spec must encode the seven roles with their default scopes and biases.

**5.2.2 The hint mechanic is the conversational ranking primer that no comparable tool has.**
- Signal strength: **Strong** (named as a key feature in brainstorm, no prior art found).
- Sources: [1].
- Hint format: free-text English passed as the slash-command argument. Examples: `/inbox i'm on-call`, `/inbox no meetings today`, `/inbox just got back from PTO`, `/inbox 30 min before standup`, `/inbox interview at 2pm`, `/inbox blocked, need something to chew on`.
- Implication: spec must specify that the hint is concatenated to the model's ranking prompt as a ranking-policy modifier, AND that the hint's influence surfaces in the "Why now" column when applicable.

### 5.3 Theme: Output is a flat table, not prose

**5.3.1 The output is one ranked table of up to twenty rows; no walls of text.**
- Signal strength: **Strong**.
- Sources: [1, 2].
- Columns: `#`, `Kind`, `Item`, `Why now`.
- Quote: *"Not long briefs, and walls of text. Rather well formatted (preferably table) list of items the developer should look into."* — Sapan, live brainstorm [1].
- Initial brief committed to ~10 rows; raised to up to 20 after first-day dogfood revealed real users (staff/founder scope) routinely have more than 10 items genuinely worth surfacing in a single view. The model aims lower when the corpus is small or the role/hint narrows scope; never exceeds 20.

**5.3.2 The "Why now" column is free-form but terse, with the most important signal in the first few words.**
- Signal strength: **Strong**.
- Sources: [2].
- Quote: *"Free form but terse, and have the most important aspect bubble up in first few words."* — Sapan, live discovery [2].
- Example shape: `"blocks Fri demo — Priya waiting 31h"` (not `"31h waiting · blocks Fri demo · —"`). The model's ranking judgment is encoded by *which signal it puts first*.
- Implication: spec should give the model a soft style guide for "Why now" but not a template. Quality bar is set in tests — review-craft assertions against rendered output samples.

**5.3.3 The table is conversationally addressable state, not a separate state machine.**
- Signal strength: **Strong** (named explicitly as a design decision; replaces dismiss/snooze/pin entirely).
- Sources: [1, 2].
- Quote: *"It's called inbox for a reason. Just like email inbox, if we decide to ignore some message, we can decide to ignore something from here too. Also, note that we are designing a command for this plugin, so I can pretty much refer to the inbox table and say 'let's work in #3'."* — Sapan, live discovery [2].
- Implication: NO `/inbox-dismiss`, `/inbox-snooze`, `/inbox-pin` commands. The host (Claude Code session) already provides addressable state via conversation context. Subtraction-as-design.

**5.3.4 Every item in the Item column is a clickable markdown link wherever a canonical URL exists.**
- Signal strength: **Strong** (first-day dogfood: real users want to click through to the PR / ticket / message page from the rendered table, not copy-paste identifiers into a browser).
- Sources: [2].
- Rule: link the source identifier (e.g., `[anthara-ai/web #98](https://github.com/...)`), not the whole cell. The descriptive tail after the identifier stays plain text. For coupled items, link each source identifier independently — `[anthara-ai/web #98](pr-url) ↔ [ANTHARA-76](jira-url)`.
- Cross-references inside the table (`pairs with #4`) stay plain text — the host conversation resolves row numbers, not URLs. Cross-references to *external items by ID* (`blocks ANTHARA-77`) may be linked when the URL is known from the enrichment step; never invent URLs.
- Items without a canonical URL (e.g., synthetic FYI roll-ups, or CLI queries whose output didn't expose a URL) render as plain text.
- Implication: every channel adapter must populate the `link` field of the `Work item` schema (§3.2) when the channel exposes a canonical URL — Jira via `https://<host>/browse/<key>`, GitHub via the PR/issue URL, Slack via the message permalink, Notion via the page/comment URL, Linear via the issue URL, Gmail via the message URL, Outlook calendar via the event URL.

### 5.4 Theme: Cross-source coupling is the moat

**5.4.1 A Jira ticket linked to its PR linked to its Slack thread is one work item with multiple sources, not three rows.**
- Signal strength: **Strong**.
- Sources: [1, 2].
- v1 approach: string-match on IDs in titles / descriptions, URL extraction in message bodies, fuzzy linking by author + time window. ~80% accuracy is acceptable; the model can disambiguate in "Why now" with phrasing like *"possibly same as #5"*.
- Bias: **under-couple over over-couple** [2]. False positives ("you collapsed two different things") break trust faster than false negatives ("I see the same work in two rows").
- Implication: spec must define the coupling algorithm clearly and the test suite must include "does not over-couple" assertions.

**5.4.2 Coupling is what makes `/inbox` more than a thin wrapper over MCPs.**
- Signal strength: **Moderate** (single-source-but-load-bearing — discovery facilitator's read, confirmed by user in convergence).
- Sources: [1].
- Discovery facilitator's read: anyone can call MCPs. Almost nobody is doing the work of saying "this Slack thread is about that PR is about that Jira ticket is about that incident." If `/inbox` does this one thing well, it's a genuine synthesis layer, not a thin wrapper. That's the long-term defensibility.

### 5.5 Theme: Learning memory — the personalization that compounds with use

**5.5.1 `/inbox` writes to fabric private memory only on explicit teaching.**
- Signal strength: **Strong**.
- Sources: [2, 10].
- Quote: *"Conservative: only write when user explicitly says 'remember'."* — Sapan, live discovery [2].
- Behavioral signals (user acted on / ignored a row) influence the current run but do not persist. Only when the user *teaches* — either via curiosity-ask answer or unprompted *"remember that..."* — does the model write a `[INBOX-LEARNED ...]` entry.
- Implication: spec should specify the writing grammar precisely. Discovery facilitator's read: the model judges whether the user's framing implies persistence; spec-writer should grill this further.

**5.5.2 Memory writes use the fabric prefix-tag convention; all `/inbox` entries are namespaced.**
- Signal strength: **Strong**.
- Sources: [2, 10].
- Quote: *"The memory should tag inbox related ideas before saving or use the word inbox when saving the memory so that they can be retrieved every time someone uses /inbox command."* — Sapan, live discovery [2].
- Namespace: `[INBOX-PROFILE <project> ...]` for wizard answers, `[INBOX-LEARNED <project> ...]` for taught facts. Aligns with `docs/fabric-adoption.md` [10].
- Implication: a future `/inbox-forget` or `/inbox-show-memory` is trivial because the namespace exists. Spec can defer those features — the prefix discipline makes them cheap to add later.

**5.5.3 The learning loop is conversational, opt-in, and discoverable.**
- Signal strength: **Strong** (synthesis from 5.5.1 + 5.5.2 + curiosity-ask mechanic).
- Sources: [1, 2].
- Conversational — model just asks "why this one?" when non-obvious. No `/inbox --remember-this` command.
- Opt-in — user answers or doesn't; no silent inference into permanent memory.
- Discoverable — namespace prefix makes entries retrievable, cleanable, auditable.
- Implication: the personalization that compounds with use IS the long-term moat. Competitors can match features in a week; they can't match six months of stored personal preferences without six months.

### 5.6 Theme: Privacy lives at the MCP token, not in /inbox

**5.6.1 `/inbox` reads everything the MCP allows. No redaction layer inside `/inbox`.**
- Signal strength: **Strong**.
- Sources: [2].
- Quote: *"Read everything the MCP allows."* — Sapan, live discovery [2].
- Rationale: the trust boundary is the MCP credential the user already configured. If a Slack MCP token gives read-DM access, `/inbox` uses it; if it doesn't, `/inbox` doesn't see DMs. `/inbox` does not enforce a second-layer policy.
- Implication: privacy is a *deployment* concern (which tokens are scoped how), not a *feature* concern. Spec should state this explicitly so users aren't surprised. Note for regulated contexts: when running with PHI / PCI / regulated data in a connected channel, the user is responsible for token scoping — `/inbox` will read whatever the MCP returns.

### 5.7 Theme: Performance is a property of orchestration, not the spec

**5.7.1 No latency SLA in the brief. MCPs run in parallel; the model re-ranks the merged set.**
- Signal strength: **Strong**.
- Sources: [2].
- Quote: *"I would not [commit] around SLAs. I will use something that's well supported like skills, subagents etc and then let them do their work."* — Sapan, live discovery [2].
- Architecture: parallel MCP queries → normalization → coupling → model re-rank → render. Spec-writer and develop will decide retry, timeout, and caching tactics using Claude Code primitives (skills, subagents, parallel tool calls). This is a deliberate non-commitment by the brief.
- Implication: don't put performance assertions in v1. Let dogfood usage reveal the real bottlenecks.

**5.7.2 Staleness is model-inferred, never the primary ranking dimension.**
- Signal strength: **Strong**.
- Sources: [2].
- Quote: *"I would like the model to infer staleness but I would also not make staleness the primary dimension for prioritization, I would let an LLM reason over all the data."* — Sapan, live discovery [2].
- Implication: spec must NOT encode per-kind staleness windows (24h for PRs, 4h for Slack threads, etc.). Instead: pass `age` and `last_activity` to the model as features; let the model reason about whether staleness matters for this item given the role and hint.

### 5.8 Theme: Design context (terminal output, brownfield-with-system)

**5.8.1 Output style follows the Anthara aesthetic.**
- Mode: *brownfield-with-system* (the system being the Anthara plugin's existing skill-doc aesthetic).
- Sources: [3].
- Extracted conventions: clean markdown tables, named concepts called out as bold ("Channel pluggability", "Why now"), one-sentence findings followed by bullet annotations, no emojis in output, categorical framing over branching logic, hierarchical decimal numbering in spec-style docs.
- References named: existing Anthara skill output style (e.g., the rendered output of `/anthara:start`, `/anthara:develop` slice summaries, `/anthara:create-ticket` previews).
- Implication: spec should specify "the rendered table is plain markdown, no ANSI color, no Unicode box-drawing beyond the standard markdown table syntax." Accessibility-by-default — works in any terminal, any font, any screen reader compatible with Claude Code.

**5.8.2 Anti-patterns and don'ts.**
- No emojis in output (consistent with the project's `CLAUDE.md` rule).
- No walls of text — output is the table and only the table by default.
- No verbose prose unless `--verbose` is added later as an opt-in.
- No useless comments in the rendered "Why now" column (e.g., don't write "this is important" — write *why* it is).

### 5.9 Theme: Prior art and adjacent solutions

**5.9.1 The closest existing references are Prokopov's morning-routine skill and Ayan's `/standup` command — both have different jobs.**
- Signal strength: **Strong** (web-verified).
- Sources: [4, 5].
- Morning-routine [4] is a *static digest*: hard-coded JQL queries the author wrote for himself, lists items by section. No ranking, no role-tuning, no hint.
- `/standup` [5] is *backward-looking*: pulls git commits + Claude Code session files + Jira to write Yesterday / Today / Blockers. Useful for standup posts; not for "what should I do."
- `/inbox` occupies a distinct white space: *forward-looking, role-tuned, judgment-based, table-formatted*.

**5.9.2 No tool today does cross-source coupling (Jira ↔ PR ↔ Slack thread).**
- Signal strength: **Moderate** (absence-of-evidence — no comparable tool surfaced in web research).
- Sources: [1, web research].
- Discovery facilitator's read: the absence is real. Integrations exist (Slack → Jira ticket creation, GitHub → Jira sync) but none do the *read-side* unification that `/inbox` aims for.

## 6. Tensions and contradictions

### 6.1 "Chief of staff" framing vs. "clean table of all the things" output

- Source view A: Sapan initially picked "Chief of Staff (A)" framing in brainstorm — implying *one decisive recommendation* with rationale. [1]
- Source view B: Sapan also said *"well formatted (preferably table) list of items the developer should look into. Imagine everything that a developer deals with should come in here"* — implying a scannable feed, not one answer. [1]
- Possible reconciliations:
  - (a) The table IS the chief of staff's output. A good chief of staff doesn't say "go talk to Sarah" — they put a one-page brief on your desk, sorted and annotated. The judgment shows up in *what's on the table* (which 10 items out of 200) and *what order they're in*, not in prose. This is the read that landed in the live discovery [2].
  - (b) Hero-section + tail: top 3 with rationale, then a categorized list. Brainstorm explicitly rejected this in favor of pure flat list.
  - (c) Add a `--decisive` mode in a future version that surfaces just the top item with rationale. Defer.
- Decision in spec: (a). The "Why now" column carries the judgment; the ranking carries the recommendation.

### 6.2 Conservative-write learning bar vs. compounding-personalization promise

- Source view A: Conservative — only write to memory on explicit teaching. Behavioral signals never persist. [2]
- Source view B: The brief's claim that *"the personalization that compounds with use IS the long-term moat"* (5.5.3) implies meaningful learning over weeks of usage. [1, 2]
- Possible reconciliations:
  - (a) Explicit teaching is enough — every time the user picks a row, the curiosity-ask catches the rationale; over weeks of usage, the model has hundreds of taught facts. The learning is real even without behavioral inference.
  - (b) The bar is loose for "explicit teaching" — the model judges whether the user's answer implies persistence rather than requiring the literal word "remember". This is currently the brief's read [2].
  - (c) Defer behavioral inference to v2. Ship conservative; revisit if v1 plateaus.
- Decision in spec: (a) + (b) — the curiosity-ask mechanic generates teaching opportunities frequently enough that conservative-write yields rich memory without requiring inference. Spec-writer should grill the *exact grammar* the model uses to decide "this implies persistence."

### 6.3 Auto-scope-by-role wide query vs. "feels instant" output

- Source view A: Staff and EM auto-scope includes cross-org signal — RFCs, stale PRs in the user's domain, reports' blockers. Implies wide MCP queries. [1]
- Source view B: Output should feel instant; re-runnable mid-day; no walls of text. [1]
- Possible reconciliations:
  - (a) Cross-org queries are *time-bounded* — if the Slack query for "mentions of areas you own" doesn't complete within the channel's parallel budget, it's skipped this run. User sees a footnote: *"Slack cross-org scope skipped — timed out."*
  - (b) Cross-org queries are *cached more aggressively* than personal-scope queries. Personal scope = fresh per invocation; cross-org = 5-minute cache.
  - (c) Cross-org is opt-in via hint: `/inbox cross-org` activates it; default scope is narrower than the role default.
- Decision in spec: facilitator recommends (a) + (b). Spec-writer should pin precise behavior given the "no SLA" stance in 5.7.1.

## 7. Regulatory signals

No regulated-data signals were raised in this discovery session. `/inbox` is a developer-productivity tool, not a clinical / financial / PII-processing surface. However, the brief should note:

**7.1 Token-scope responsibility** — when `/inbox` runs in a context with regulated data flowing through a connected channel (e.g., a Slack workspace where PHI is discussed, a Jira project containing PII), the user is responsible for scoping their MCP tokens appropriately. `/inbox` reads everything the token allows (5.6.1). The brief recommends spec-writer add a docs section noting this responsibility explicitly so the regulated-industry audience (Anthara users) is not surprised [2].

**7.2 Memory residency** — `[INBOX-PROFILE]` and `[INBOX-LEARNED]` entries persist in fabric. Anything the user explicitly teaches (e.g., "ACME is our biggest client") lives there indefinitely. Spec-writer should consider whether a `/inbox-forget` command needs to ship in v1 for users who teach something they later want removed [10].

**7.3 Audit/observability** — fabric writes are auditable via `search_facts("[INBOX-...")`. No additional audit logging is currently planned. For Anthara users in SOC 2 contexts, this may be sufficient (everything Anthara writes to fabric is already audit-trail-bearing); spec-writer should confirm.

## 8. Gaps

**8.1** **The exact channel-adapter manifest format is not specified.** Brief commits to "YAML-shaped" but doesn't pin the schema. Spec-writer should decide: just two queries per channel (`mine`, `awaiting-me`), or richer? How does normalization-to-Work-item get expressed in the manifest?

**8.2** **The model's prompt for ranking is not specified.** Spec-writer should produce a concrete prompt (system + per-invocation context) that takes role + hint + enriched item set and returns the ranked table. This is the single highest-leverage piece of v1 — getting the prompt right is most of the product.

**8.3** **First-run behavior when fabric is unreachable is undefined.** Discovery committed to fabric private memory but the failure mode is open (4.1 step 6).

**8.4** **The exact grammar of "explicit teaching" is undefined.** Does the model require literal phrases ("remember", "note that")? Or does it judge from context? Brief leans toward the latter (6.2 reconciliation b); spec-writer should pin it (5.5.1).

**8.5** **The cross-source coupling algorithm is described but not pinned.** "String-match on IDs, URL extraction in messages, fuzzy by author+window" is directionally correct (5.4.1) but the precision/recall test suite isn't drafted. Spec-writer must produce specific assertions: e.g., *"Given a PR titled 'Fixes INC-198' and a Jira ticket INC-198, they must be coupled. Given a Slack message containing the PR URL, it must couple to the same item. Given two unrelated tickets opened by the same author one hour apart, they must NOT couple."*

**8.6** **Failure-mode prioritization is open.** The discovery facilitator's open question — "what shape of wrongness do you most want to avoid?" — was not directly answered. The brief currently treats false-positive-dedup as the worst failure (5.4.1) but spec-writer should ask once during the closure loop.

Suggested follow-up:
- Spec-writer's grill-me will surface 8.1, 8.2, 8.4, 8.5 naturally — these are all the kind of "where exactly does X live in code" questions spec-writer specializes in.
- 8.3 (fabric-unreachable first-run) is a small but real decision; spec-writer should ask in passing.
- 8.6 (failure-mode shape) is worth one explicit closure-loop question during spec-writing.

## 9. Open questions

Decisions needed before spec-writing begins (mostly resolved during the live session — what remains is genuinely-needs-spec-writer-grill).

**9.1** Channel-adapter manifest schema — what exactly goes in `channels/<name>.yaml` and what does the normalization function look like? (Gap 8.1)

**9.2** The model's ranking prompt — concrete system + context prompt that takes role + hint + items + memory and returns the ranked table. (Gap 8.2)

**9.3** First-run wizard exact question list and order — confirmed candidates (role, primary tools, time zone, usernames, manager). Spec-writer should commit to the exact wizard script.

**9.4** Grammar of "explicit teaching" — when does the model write `[INBOX-LEARNED ...]`? Literal phrase trigger, or contextual judgment? (Gap 8.4)

**9.5** Coupling algorithm — pin the precision/recall test suite. (Gap 8.5)

**9.6** Failure-mode shape — when `/inbox` is wrong, what's the worst kind of wrong? (Gap 8.6)

**9.7** Teams MCP commitment — v1 includes Teams as a green-light channel or behind a feature flag? (Finding 5.1.2)

**9.8** Cross-org auto-scope behavior — time-bound, cache-bound, or hint-gated? Brief recommends time-bound + cached (Tension 6.3 reconciliation a+b); spec-writer should pin.

**9.9** Behavior when fabric is unreachable on first run. (Gap 8.3)

**9.10** Should `/inbox-forget` or `/inbox-show-memory` ship in v1 (Regulatory 7.2), or be deferred?

**9.11** Channel access paths beyond MCP — finding 5.1.3 commits to "MCP *or* Bash-callable CLI" but leaves the seed CLI list open. v1 names `gh` (GitHub), `glab` (GitLab), `linear` (Linear CLI) as the initial CLI seed. Spec-writer should pin the full v1 list and decide the manifest-field shape that distinguishes MCP vs CLI access paths (proposed: `access_path: mcp | cli` plus per-path query template). The exclusion list (fabric, codebase-memory-mcp, any other "infrastructure" MCP that has search tools but doesn't return work items) is also worth pinning explicitly so future MCP additions don't accidentally surface as channels.

**Spec-readiness:** **Spec-ready with caveats.** The design is internally coherent and the architecture (channel-pluggability, role-tuned ranking, conversational addressability, conservative-write learning, fabric-namespaced memory) is locked. The caveats in 9.1–9.10 are the kind of "pin the exact shape" questions `/anthara:spec-writer` is built to grill out during slice decomposition — none of them are genuinely-external blockers requiring more stakeholders or data.

---

## Changelog

- 2026-05-25 — Sapan / Discovery facilitator — Initial synthesis from brainstorm session + live discovery session + web research on MCP availability (Slack, Gmail, Linear, Notion, Teams) and prior-art references (Prokopov's morning-routine, Ayan's `/standup`). Brief committed under `docs/specs/inbox-discovery.md`.
- 2026-05-25 — Sapan / Discovery facilitator — First-day-dogfood feedback: GitHub MCP not detected though `gh` CLI is universally installed; fabric MCP incorrectly surfaced in the wizard's channels list. Added finding 5.1.3 (channels are MCP *or* CLI, infrastructure MCPs explicitly excluded) and open question 9.11 (seed CLI list + manifest-field shape). Skill updated in lockstep: detection extended to Bash-callable CLIs, fabric excluded from channels, wizard question 2 rephrased to always mention "MCPs and CLI commands" with the "Other" option inviting additional tool names.
- 2026-05-25 — Sapan / Discovery facilitator — Second round of first-day-dogfood feedback: real staff/founder-scope runs surface more than 10 items genuinely worth showing; identifiers in the Item column should be clickable links so users can navigate without copy-paste. Updated finding 5.3.1 (row cap raised to up to 20; aim lower when scope is narrow). Added finding 5.3.4 (every item is a clickable markdown link wherever a canonical URL exists; link the identifier, not the whole cell; coupled items link each source independently). Skill updated in lockstep: Step 6 mandates a `link` field on every item, Step 7 model-job adds the link-rendering rule (with cross-reference handling), Step 8 example shows markdown-link table rows, principles and "Do not paginate" line updated to the 20-row cap.
