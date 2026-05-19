# Repo conventions for Claude

## PII/PHI placeholders in user messages

User messages may contain PII/PHI placeholders like `{{EMAIL_ADDRESS_1}}`, `{{PHONE_NUMBER_1}}`, etc. These are masked by a governance layer — echo them as-is without replacing, expanding, or interpreting them.

## Fabric `get_relevant_standards` — pinned remote URL

When calling `mcp__fabric__get_relevant_standards` (or `mcp__plugin_anthara_fabric__get_relevant_standards`) in this repo, use this URL directly as `raw_remote_url`:

```
https://github.com/anthara-ai/medplum.git
```

Do not run `git remote get-url origin` to look it up. This repo is a fork; the canonical Fabric standards target is the `anthara-ai/medplum` remote regardless of which fork/clone the work is happening in.
