# Fabric adoption

How Anthara skills use [Fabric](https://github.com/anthara-ai/fabric) — the org's context engineering platform — to become *stateful* across sessions and across projects. Phase 1 contract; this is what's live in the plugin today.

## What changes after fabric adoption

**Anthara becomes stateful.** Skills accumulate structured knowledge in fabric's shared memory as decisions are made; later sessions read that knowledge back and surface it proactively. The third spec feels materially faster and sharper than the first because the architecture decisions, module boundaries, glossary terms, and patterns from prior projects are inherited.

**With fabric** (current behaviour after Phase 1):
- spec-writer's architecture probe surfaces prior org decisions: *"Your org has 4 prior architecture decisions; closest match is anthara-api (modular monolith, shipped clean). Recommend match?"*
- discovery's Glossary Challenge surfaces cross-project term conflicts: *"You're calling this Workspace — 3 other projects use Tenant for the concept."*
- Closure loops cite prior decisions: *"Last spec locked pagination as cursor-based. Same rationale here?"*
- Pack-canonical terms (HIPAA's "Protected Health Information", PCI's "Cardholder Data", WCAG contrast levels) seed automatically — no re-deriving what the regulator already defines.

**Without fabric** — skills behave like current Anthara (no prior-knowledge surfacing). The session works; it just isn't stateful.

## Why no committed view-files (CONTEXT.md, ARCHITECTURE.md, etc.)

A prior design explored generating `CONTEXT.md` / `ARCHITECTURE.md` / `BOUNDARIES.md` / `design.md` as exported views over fabric's graph. Phase 1 dropped that — fabric is the canonical store, no parallel committed files.

Trade-offs accepted:
- Git history for terms / decisions / module boundaries lives in fabric's temporal facts (`valid_at`, `invalid_at`, `expired_at`), not in `git log`.
- Code-review surface for those artifacts is deferred to a future fabric review UI.
- Offline reading is unavailable for those artifacts.
- New devs require fabric MCP from session one.

The win: a single source of truth, no drift between files and fabric, no merge-conflict surface on those files, and the design matches the long-term direction.

## Prefix conventions for `add_shared_memory`

Anthara skills write structured facts to fabric's shared org graph via `add_shared_memory(data="...")`. Each fact carries a square-bracketed prefix tag identifying the type + the project. Graphiti's default ontology extracts the inner content as entities and relationships.

| Tag | Shape | Emitted by |
|---|---|---|
| `[GLOSSARY <project> term=<X> status=<candidate\|confirmed\|canonical> def=<Y>]` | Canonical or candidate domain term with definition | discovery (on Canonical-Term Proposal); start (pack-canonical seeding) |
| `[DECISION <project> slice=<id> chose=<X> why=<Y>]` | A choice locked in a spec slice | spec-writer (on slice lock); closure-loop |
| `[PATTERN <project> name=<X> applied-at=<slice-ref> outcome=<X> failure=<Y>]` | A named pattern's application and observed outcome | develop (on slice completion) |
| `[ARCHITECTURE <project> style=<modular-monolith\|serverless\|...> rationale=<Y> outcome=<shipped\|N-incidents\|...>]` | Project architectural style decision | spec-writer (after architecture probe locks) |
| `[BOUNDARY <project> module=<X> owns=<Y> interacts-via=<event-bus\|direct-call\|...> with=<module-name>]` | Module ownership boundary + interaction pattern | spec-writer (during slicing) |
| `[DESIGN-TOKEN <project> token_type=<color\|spacing\|typography\|...> name=<X> value=<Y> pack=<wcag-aa\|...>]` | Canonical design token | spec-writer / discovery (design probe); start (pack-canonical seeding) |
| `[DESIGN-PATTERN <project> name=<X> used-for=<Y>]` | Reusable design pattern | spec-writer (design probe) |
| `[COMPLIANCE-CONTROL <project> pack=<X> control_id=<Y> description=<Z>]` | A specific compliance control bound to the project | start (pack-canonical seeding); reviewer (when consulting controls) |
| `[INBOX-PROFILE <project> role=<X> tools=[<Y>,<Z>] tz=<TZ> usernames={...} manager=<name>]` | User's `/inbox` profile (role, channels, time zone, usernames, manager) — set once during the first-run wizard | inbox (first-run wizard) |
| `[INBOX-LEARNED <project> fact=<X> learned-from=<row-ref or invocation context>]` | A fact the user explicitly taught `/inbox` during a curiosity-ask answer or a "remember that..." utterance | inbox (Step 9 row-action follow-up) |

**Project slug** is the `owner-repo` from `git remote get-url origin` (e.g., `github.com/anthara-ai/plugin` → `anthara-ai-plugin`). Use this as `<project>` in every prefix so cross-project queries can filter or aggregate.

**Field order matters** — the tag conventions above are positional after `<project>`. Skills should emit in the order shown so search-by-prefix-substring works.

**Spaces inside values** — wrap values containing spaces in single quotes inside the brackets: `term='Protected Health Information'`. The tag stays one shared-memory entry.

## Query patterns for `search_facts`

Skills retrieve prior knowledge via `search_facts(query="...", limit=N)`. The query is a free-text string ranked by relevance against the org graph (and the user's private graph).

**Prefix-substring queries** — the cheapest pattern:

```
search_facts("[ARCHITECTURE")           → all prior architecture decisions
search_facts("[GLOSSARY term=Workspace") → all uses of "Workspace" as a term
search_facts("[BOUNDARY module=scheduling") → prior boundaries on the "scheduling" module
search_facts("[DECISION slice=5.3.1")   → prior decisions tied to slice 5.3.1
```

Ranking does the rest — relevant results bubble up; unrelated entries with similar substrings sink.

**Status filtering** — `search_facts` returns each result with a `status` field (`active` / `expired` / `invalid`). Skills filter to `active` only by default. `expired` surfaces only when investigating drift (*"why did this decision change?"*). Respect `valid_at` for "most recent first" ordering.

**Cross-project queries** — when querying without a `<project>` constraint, results span all projects in the org. This is the cross-project intelligence path — *"how have similar features been built before?"* — and is the point of fabric adoption.

**Per-project queries** — include `<project>` in the query string to filter to the current project: `search_facts("[GLOSSARY anthara-plugin term=...")`.

## Pack-canonical seeding (start skill)

On first `/anthara:start` per repo, the start skill:

1. Calls `get_standards(<owner/repo>)` to discover active packs (HIPAA, PCI, WCAG, SOC 2, FDA SaMD, OWASP, Clean Code).
2. For each pack's canonical terms — HIPAA's "Protected Health Information", PCI's "Cardholder Data", WCAG's "WCAG AA contrast 4.5:1", etc. — calls `add_shared_memory` with the appropriate prefix:
   - Compliance terms → `[GLOSSARY <project> term='...' status=canonical derived_from_pack=<pack> def='...']`
   - Compliance design tokens (WCAG contrast levels, focus indicators) → `[DESIGN-TOKEN <project> ... pack=<pack>]`
   - Compliance controls → `[COMPLIANCE-CONTROL <project> pack=<pack> control_id=<id> description='...']`

**Idempotency.** Graphiti deduplicates by content, so re-running start on an already-seeded repo is safe. No "is it already seeded?" check is needed; the seeding step runs every time start runs, and Graphiti silently dedupes.

**Pinned status.** Pack-canonical entries write with `status=canonical` from the start. They can't be sharpened away — discovery and spec-writer surface them as authoritative when a related term comes up in conversation.

## Skill-by-skill: with vs without fabric

### discovery
- **Without fabric:** runs from scratch every time. Glossary Challenge has nothing to challenge against.
- **With fabric:** Glossary Challenge surfaces prior canonical terms (*"3 prior projects call this concept Tenant"*); pack-canonical terms are pre-seeded; new candidate terms get written on Canonical-Term Proposal hits.

### spec-writer
- **Without fabric:** generic playbook for every architecture probe, slicing, design probe.
- **With fabric:** architecture probe cites prior org architectures with outcomes; slicing inherits module boundary patterns; design probe inherits canonical tokens; closure loop cites prior Decision records.

### develop
- **Without fabric:** each slice implementation is independent; no cross-slice pattern recognition.
- **With fabric:** known patterns get recognized when applied; Decision records read at slice start so the developer agent has the rationale in scope.

### reviewer (review-craft, agents/reviewer.md)
- **Without fabric:** reviews against pack rules only.
- **With fabric:** consults prior Decisions and ComplianceControls; surfaces mismatches between the slice and the project's locked decisions.

### start
- **Without fabric:** triages and routes.
- **With fabric:** also seeds pack-canonical terms on first session per repo so downstream skills have regulator-canonical vocabulary available immediately.

## Long-term direction

Phase 1 (this doc) uses Graphiti's default ontology + prefix conventions over `add_shared_memory`. Sufficient for the visible-diff target.

**Phase 2 (future, fabric-side ticket)** would add:
- `prepare_context(task, args)` MCP tool — task-shaped context delivery in one call instead of multi-call orchestration in skills.
- Optionally: custom ontology registration (`Term`, `Decision`, etc. as first-class entity types) for precision filtering and entity-type-aware queries.
- Optionally: per-project standalone graphs for stronger isolation.

Phase 2 lands only if Phase 1 surfaces friction that those additions would solve.

The plugin's *direction* doesn't change between Phase 1 and Phase 2 — fabric remains the source of truth, no committed view-files. Phase 2 sharpens the implementation; Phase 1 establishes the contract.

## What to do when fabric is unreachable

Every skill gracefully degrades: if `add_shared_memory`, `search_facts`, or `load_context` fails, the skill continues with current-session reasoning only. No prior-knowledge surfacing. Surface the degradation explicitly in the skill's run summary so the user knows what they're missing.

The skill's degraded behavior matches the current pre-fabric Anthara experience. Nothing breaks; the stateful features simply don't fire.
