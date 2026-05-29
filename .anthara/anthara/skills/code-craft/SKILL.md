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
- **Self-documenting code over comments.** Before writing a comment that explains *what* the code does, try the smaller refactors first: rename a function, name an intermediate value with a variable, extract a named block into a function. The instinct to add an explanatory comment is a signal that an extraction was missed.
- **Comments answer "why", never "what".** If a comment explains *what*, the fix is rename → extract a variable → extract a function — in that order of effort.
- **Cognitive load is the cost.** Function size, nesting depth, naming, argument count are proxies for the next reader's working memory. Optimize for the reader: short functions, shallow nesting, intention-revealing names.
- **Functional core, imperative shell.** Pure functions in the center; I/O at the edge. The shell is thin and integration-tested; the core is exhaustively unit-tested in isolation.
- **Construct with collaborators; call with work.** Pass dependencies in the constructor (or factory). Pass the data the method operates on as method arguments. Do not smuggle dependencies through call parameters.
- **Arrange code to communicate data flow.** Top-to-bottom reading order matches data flow direction. Helpers used near the top are defined immediately after the entry function; helpers used later are defined later. Reading the file feels like reading a paragraph.
- **Inject configuration; never bake assumptions.** Constants that vary by environment, feature flag, or tenant belong in configuration. Hardcoded values become tomorrow's incident.
- **Throw close to detection; catch close to recovery.** Throw where the failure is detected. Catch only where you can do something meaningful — log with context, retry, fall back, present an error to the user. Catch-and-rethrow without adding value is noise.

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
- **Metadata comments tagging spec / ticket / AC references in production code.** AC IDs live in the spec, the ticket, and test names (per `test-craft`). Tagging code with `// 5.2.1` or `// Slice 5.2 AC 1` is metadata that rots when the spec evolves and adds noise to readers; the link between code and AC already lives in better places (test → AC mapping by name, commit messages, ticket).
- **Catch-only-to-rethrow** without adding context, logging meaningfully, or recovering. If you cannot act on the exception, let it propagate to where someone can.
- **Cruft in new code** — unused imports, dead branches, commented-out code, dangling TODOs in code you are authoring. Land code clean; don't expand scope to clean up prior code.

## Patterns to reach for

- **Adapter** — when integrating an external system (Recall.ai, Stripe), put the SDK behind a thin adapter. Domain code talks to the adapter, not the SDK.
- **Anti-corruption layer** — when bridging two bounded contexts with different vocabularies, translate at the seam.
- **Result type** — for operations that can fail in expected ways. Reserve exceptions for unexpected failures.
- **Repository** — when persistence is involved. Domain logic talks to interfaces; concrete repositories live at the edge.
- **Builder / factory** — when constructing complex objects with many optional fields.
- **Decorator / wrapper for cross-cutting concerns** — logging, audit, retry, caching belong in wrappers around the core, not interleaved with domain logic. Wrap once at the edge; keep the core pure.

## How to use this skill in your work

When the developer agent loads this skill, it should:

1. **Read the task context file FIRST** (from `docs/specs/<NNN>-<slug>-context.md`). The Reusables and Patterns sections tell you what already exists in this project. Use those before reaching for general patterns here.
2. **Apply project-specific patterns over general ones.** If the project's established convention disagrees with a general principle here, follow the project. Surface the deviation as an `@anthara` annotation on the spec if you think the project should evolve.
3. **Cite the rule when committing.** Commit messages reference what was applied — *"Used existing `audit.log` per context §3 Reusables; followed service-layer convention per context §2."*
4. **Do not duplicate code or utilities** that exist in the context's Reusables list. Reuse, extend, or refactor — never reinvent.
