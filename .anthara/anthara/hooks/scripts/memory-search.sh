#!/usr/bin/env bash
# UserPromptSubmit hook for Fabric — coach Claude on when to fetch memory
# via search_facts, instead of flooding with list_memories(scope=all) at
# session start.
#
# Pattern adapted from mem0's mem0-plugin/scripts/on_user_prompt.sh: the
# agent has more context than this script does, so we inject a decision
# rubric and let the agent decide whether/how to search. Short prompts
# (acknowledgements / continuations) skip silently so the rubric doesn't
# drown trivial messages.
#
# Input:  JSON on stdin (prompt, session_id, cwd, transcript_path)
# Output: Coaching rubric injected into Claude's context (exit 0)

set -uo pipefail

INPUT=$(cat)

# Try jq, then python3. If neither is available the prompt stays empty
# and we fall through to printing the rubric — over-coaching is
# preferable to silently skipping.
PROMPT=""
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null || echo "")
elif command -v python3 >/dev/null 2>&1; then
  PROMPT=$(echo "$INPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('prompt', ''))" 2>/dev/null || echo "")
fi

# Skip the rubric on short replies (acknowledgements / continuations).
# If parsing failed PROMPT is empty and we fall through to emit.
if [ -n "$PROMPT" ] && [ ${#PROMPT} -lt 20 ]; then
  exit 0
fi

cat <<'EOF'
## Fabric memory — search deliberately, do not flood

CALL `mcp__plugin_anthara_fabric__search_memories`  WHEN the user:
  - references past work, decisions, or anything "we" built
  - asks "how should we...", "best way to...", or any decision-style question
  - hits an error, bug, or asks for debugging help
  - requests work touching their stack, tools, conventions, or preferences
  - mentions a person, project, or term you do not recognize this session

SKIP search WHEN:
  - the prompt is an acknowledgement or short continuation
  - the user is *stating* new info — that's a write trigger (`add_private_memory` / `add_shared_memory`), not a search
  - pure syntax / general-knowledge question answerable from training
  - you already searched this scope earlier in this turn

PASS `tags=[...]` to `search_memories` matching the query type — hard-filter, so be deliberate. To pick the right tag, read your `mcp__plugin_anthara_fabric__list_tags` result: every tag carries a `description` written specifically to explain what kind of memory belongs under it. Match the user's query intent against those descriptions and choose the most specific tag. Prefer a project-created tag over a more generic seed tag when both describe the query (e.g. a `deployment_strategy` tag is more specific than `tooling_setup` for a deploy question). Multiple tags use OR-semantics. Unknown / wrong tag = empty results.

Strip conversational filler. Empty results are normal — proceed without context.

EOF

exit 0
