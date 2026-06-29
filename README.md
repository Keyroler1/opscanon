# OpsCanon

Turn messy company knowledge into verified agent skills.

OpsCanon cleans fragmented docs, routes uncertainty to humans, and compiles approved operating knowledge into source-cited skills and MCP-ready company brains.

It is not enterprise search, a chatbot over documents, or generic document Q&A. It is a local-first operating-knowledge compiler for AI agents.

## What It Does

- Prepares messy exports into `ai-ready-pack/` with cleaned sources, source inventory, duplicate/noise/staleness reports, review queues, unresolved questions, and a static dashboard.
- Lets humans review and approve weak or uncertain knowledge before it becomes executable.
- Builds a `company-brain/` with operating model, workflow skills, action boundaries, quality score, eval report, freshness report, and read-only MCP server.
- Keeps repo-readiness features as a secondary surface under `opscanon repo`.
- Works deterministically without API keys. Optional LLM synthesis is used only when `--llm` is passed and `OPENAI_API_KEY` is present.

## Install

```bash
npm install -g opscanon
```

Until the npm package is published, install the current public GitHub release:

```bash
npm install -g github:Keyroler1/opscanon
```

For local development:

```bash
npm install
npm run build
node dist/cli.js --help
```

The compatibility binaries `ai-repo-readiness` and `company-brain` remain available during migration.

## Five-Minute Demo

```bash
opscanon demo --out opscanon-demo
```

This creates:

- `raw-company-export/`
- `ai-ready-pack/`
- `approved-pack/`
- `company-brain/`

Open `opscanon-demo/ai-ready-pack/review-dashboard.html` to inspect the static review dashboard.

## Core Workflow

```bash
opscanon prepare ./raw-company-export --out ai-ready-pack --ocr-text ./ocr-output --dashboard
opscanon review ai-ready-pack
opscanon approve ai-ready-pack --out approved-pack
opscanon build --prepared approved-pack --out company-brain
opscanon score --brain company-brain
opscanon eval --brain company-brain
opscanon serve-mcp --brain company-brain --dry-run
```

Only compile-ready or approved cleaned sources flow into `build`. Low-confidence data becomes questions, not facts.

## Repo Readiness

```bash
opscanon repo audit .
opscanon repo audit . --json
opscanon repo generate . --out opscanon-repo-pack
opscanon repo check-mcp ./mcp-config.json
opscanon ci . --out opscanon-artifacts
```

Repo readiness scores:

- Agent-facing setup/docs: 25%
- Machine interfaces: CLI/API/MCP/OpenAPI: 25%
- Repo context quality: 20%
- Eval/test reproducibility: 15%
- MCP/security boundaries: 15%

## Outputs

Prepared pack:

- `cleaned-sources/`
- `source-inventory.json`
- `document-quality-report.md`
- `duplicate-report.md`
- `noise-staleness-report.md`
- `candidate-operating-knowledge.json`
- `human-review-queue.md`
- `client-cleanup-checklist.md`
- `review-decisions.json`
- `review-dashboard.html`
- `ocr-review.md`
- `unresolved-questions.md`

Company brain:

- `company-profile.md`
- `operating-model.md` and `operating-model.json`
- `workflows/`
- `skills/`
- `action-boundaries.md`
- `facts.jsonl`
- `graph.json`
- `source-coverage.md`
- `brain-quality-report.md`
- `brain-eval-report.md`
- `mcp-review.md`

Repo pack:

- `AGENTS.md`
- `repo-map.md`
- `skills/`
- `promptfoo.yaml`
- `mcp-review.md`
- `opscanon-report.md`
- `opscanon-report.json`

## GitHub Action

```yaml
name: OpsCanon

on:
  pull_request:
  workflow_dispatch:

jobs:
  opscanon:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: Keyroler1/opscanon@v0
        with:
          path: .
          out: opscanon-artifacts
          comment: "true"
```

The Action uploads `opscanon-report.md` and `opscanon-report.json` and writes the Markdown report to the GitHub step summary.

## MCP

```bash
opscanon serve-mcp --brain company-brain
```

Read-only tools:

- `search`
- `fetch`
- `get_company_profile`
- `get_operating_model`
- `get_workflow`
- `get_action_boundaries`
- `get_freshness`
- `get_project_context`
- `get_recent_decisions`

See `docs/mcp-setup.md` for Codex and Claude-style configuration examples.

## Trust Model

OpsCanon is local-first. Raw exports, prepared packs, review dashboards, approved packs, and compiled brains stay on the machine unless the user explicitly connects external services.

The pipeline redacts common secret patterns before downstream processing. The MCP server is read-only in v1. See `docs/privacy-and-security.md`.

## Distribution

Primary self-serve channels:

- npm package: `opscanon` once published
- GitHub repo and releases: `Keyroler1/opscanon`
- GitHub Action
- Landing page: `https://keyroler1.github.io/opscanon/`
- Static docs and examples
- Read-only MCP server

Paid features can come later: hosted dashboard, managed connectors, scheduled freshness checks, team review workflow, private cloud/on-prem deployment, audit logs, compliance controls, and billing.

## Docs And Examples

- `docs/quickstart.md`
- `docs/mcp-setup.md`
- `docs/privacy-and-security.md`
- `docs/distribution.md`
- `docs/name-checks.md`
- `docs/launch-post.md`
- `docs/demo-walkthrough.md`
- `docs/buyers/`
- `examples/`
- `site/index.html`

## Feedback

- Bugs and reproducible CLI/Action issues: [open an issue](https://github.com/Keyroler1/opscanon/issues/new/choose).
- Setup questions and MCP help: [start a Q&A discussion](https://github.com/Keyroler1/opscanon/discussions/categories/q-a).
- Connector ideas and workflow feedback: [start an Ideas discussion](https://github.com/Keyroler1/opscanon/discussions/categories/ideas).
