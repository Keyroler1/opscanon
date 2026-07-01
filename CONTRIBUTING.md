# Contributing To OpsCanon

OpsCanon turns messy company knowledge into verified agent skills and MCP-ready company brains.

## Local Setup

```bash
npm install
npm run build
node dist/cli.js --help
```

## Useful Commands

```bash
npm test
npm run test:coverage
npm run typecheck
npm run build
npm publish --dry-run
```

## Contribution Areas

- document preparation and quality scoring
- human review and approval workflow
- source connectors and import formats
- company-brain compiler outputs
- MCP safety and schema checks
- repo-readiness audit heuristics
- docs, examples, and buyer workflows

## Safety Rules

- Do not add real customer exports, secrets, tokens, credentials, or private company data.
- Use synthetic fixtures for tests.
- Low-confidence knowledge should become review items or unresolved questions, not facts.
- Generated skills should be source-cited and conservative about approvals, exceptions, and write boundaries.

## Pull Requests

Keep PRs focused. Include the commands you ran and any generated output you inspected. For package, action, or docs changes, run `npm publish --dry-run`.
