# Privacy And Security

OpsCanon is local-first by default.

## What Stays Local

- Raw company exports.
- Prepared packs.
- Approved packs.
- Compiled company brains.
- Review dashboards.
- Generated skills and MCP artifacts.

The deterministic pipeline does not require API keys and does not upload documents.

## Optional Network Use

OpsCanon can use networked services only when the user explicitly asks for them:

- `--llm` uses `OPENAI_API_KEY` to synthesize a short repo-readiness summary.
- `opscanon github owner/repo` calls the GitHub API and uses `GITHUB_TOKEN` when present.
- Future connectors should follow the same explicit-consent model.

## Secret Handling

OpsCanon redacts common secret patterns before downstream processing:

- OpenAI-style `sk-...` keys.
- GitHub `ghp_...` and related tokens.
- Slack `xox...` tokens.
- AWS access key ids.
- Common `API_KEY`, `TOKEN`, `SECRET`, `PASSWORD`, and credential assignments.

Generated reports, packs, dashboards, and skills should not contain raw secrets. Treat this as defense-in-depth, not a replacement for customer-side secret hygiene.

## MCP Boundary

The OpsCanon MCP server is read-only in v1. It exposes company-brain context and action boundaries, but does not write to customer systems.

Before adding write tools:

- Define the exact external action.
- Require explicit human approval for sensitive systems.
- Log source evidence and approval decisions.
- Validate all tool input schemas.
- Keep tokens in environment variables or a secret manager.

## Review Boundary

OpsCanon should not blindly trust raw uploads. Preparation routes weak, stale, duplicate, unreadable, noisy, or conflicting material to human review. Low-confidence material becomes questions, not executable skills.

## Data Retention

The CLI writes only to user-selected local folders. Hosted versions should add explicit retention controls, audit logs, data deletion, tenant isolation, and compliance documentation before handling customer production data.
