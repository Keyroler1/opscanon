# Security Policy

OpsCanon is local-first. It processes company exports, repo docs, generated packs, and MCP artifacts on the machine running the CLI unless the user explicitly connects an external service.

## Supported Versions

Security fixes target the latest published release and the `main` branch.

## Reporting A Vulnerability

Do not open a public issue for vulnerabilities, secrets, or private customer data exposure.

Use GitHub private vulnerability reporting when available, or contact the repository owner directly through GitHub. Include:

- affected version or commit
- reproduction steps
- expected and actual behavior
- whether any secrets, customer data, or generated company-brain artifacts were exposed

## Security Expectations

- Never commit secrets, tokens, raw customer exports, or private company-brain outputs.
- Redact sensitive values before sharing logs, reports, dashboards, review queues, or generated packs.
- Keep the MCP server read-only unless a future release explicitly documents write boundaries and approval gates.
- Treat low-confidence, stale, contradictory, or ownerless data as human-review material, not executable knowledge.
