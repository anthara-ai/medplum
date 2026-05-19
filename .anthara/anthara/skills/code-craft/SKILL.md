---
name: code-craft
description: Domain expertise for writing excellent code. Covers naming, function design, error handling, single responsibility, composition, encapsulation, testability, and the categorical-framing preference (kinds-of-things over branching logic). Loaded by the developer agent when implementing slice code, and by reviewer agents when verifying code-quality dimensions. Loaded as context by other agents — not user-invokable.
---

# code-craft

Domain expertise loaded by the developer agent before writing slice code, and by reviewer agents before verifying code-quality. This is what excellent code looks like in this plugin's worldview — opinionated, not a generic style guide.

## Principles

- **Categorical framing over branching logic.** Variation in behavior comes from kinds-of-things (encapsulation, polymorphism, dispatch tables), not from `if-else` chains. When you catch yourself writing branching logic, ask whether the variation is really a category. Usually it is.
- **Single responsibility per module / function.** A function that does X *and* Y is two functions waiting to be split.
- **Encapsulation over primitive obsession.** A patient ID is a `PatientId`, not a `string`. Money is `Money`, not `number`. Types carry the invariants; runtime checks bear load only at boundaries.
- **Composition over inheritance.** Inheritance is the rarest tool; composition is the default.
- **Pure where possible; side effects at the edges.** Domain logic is pure functions; I/O lives in adapters and repositories. Test the domain in isolation.
- **Dependency direction inward.** Outer modules know of inner; inner know nothing of outer. UI / HTTP / DB depend on application services; application services depend on domain; domain depends on nothing.
- **Names read as English.** Classes are nouns, methods are verbs, booleans are predicates (`isPaid`, `canRetry`). Avoid encodings (`strName`, `lstUsers`) and abbreviations (`mgr`, `fn`).
- **Functions are short and single-level.** Default ceiling: 20 lines, ≤3 args, no flag arguments. A function mixing levels of abstraction needs a helper.
- **`return null` is a defect.** Use typed errors, options, results, or empty collections. Never null as control flow.
- **Fail fast at boundaries.** Validate input at the system edge; once inside, trust the types.
- **Comments answer "why", never "what".** If the comment explains what the code does, rename the function.

## Compliance discipline (when in regulated paths)

- Audit-log every operation that reads or writes regulated data — using the project's existing audit infrastructure (see context file's Reusables section). Never invent a parallel one.
- Error messages and logs must not contain regulated content (PHI, payment details, tokens, query strings that may carry PHI). Log identifiers and event types only.
- Encryption and transport posture come from active packs (HIPAA / PCI). Never roll your own crypto.
- Never bypass the established access-control mechanism (RLS, framework guards). Add to it; don't side-step it.

## Anti-patterns to avoid

- **God classes / modules** — many responsibilities, hundreds of lines. Split.
- **Shotgun surgery** — a single change touches many places. Indicates poor cohesion.
- **Feature envy** — a method that mostly uses another class's data. Move it there.
- **Primitive obsession** — `string` and `number` for domain concepts. Encapsulate.
- **Magic numbers and strings** — name them as constants.
- **Hidden shared mutable state** — global singletons, ambient context. Inject explicitly.
- **Defensive over-engineering** — wrapping every call in try/catch. Fail at boundaries; trust internals.
- **Speculative generality** — abstractions for needs that may never materialize. YAGNI.
- **Reinventing utilities the codebase already has.** Read the context file's Reusables section first.

## Patterns to reach for

- **Adapter** — when integrating an external system (Recall.ai, Stripe), put the SDK behind a thin adapter. Domain code talks to the adapter, not the SDK.
- **Anti-corruption layer** — when bridging two bounded contexts with different vocabularies, translate at the seam.
- **Result type** — for operations that can fail in expected ways. Reserve exceptions for unexpected failures.
- **Repository** — when persistence is involved. Domain logic talks to interfaces; concrete repositories live at the edge.
- **Builder / factory** — when constructing complex objects with many optional fields.

## How to use this skill in your work

When the developer agent loads this skill, it should:

1. **Read the task context file FIRST** (from `docs/specs/<NNN>-<slug>-context.md`). The Reusables and Patterns sections tell you what already exists in this project. Use those before reaching for general patterns here.
2. **Apply project-specific patterns over general ones.** If the project's established convention disagrees with a general principle here, follow the project. Surface the deviation as an `@anthara` annotation on the spec if you think the project should evolve.
3. **Cite the rule when committing.** Commit messages reference what was applied — *"Used existing `audit.log` per context §3 Reusables; followed service-layer convention per context §2."*
4. **Do not duplicate code or utilities** that exist in the context's Reusables list. Reuse, extend, or refactor — never reinvent.
