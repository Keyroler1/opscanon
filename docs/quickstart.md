# OpsCanon Quickstart

OpsCanon turns messy company knowledge into verified agent skills and MCP-ready company brains.

## Install

```bash
npm install -g opscanon
```

Until the npm package is published, install from GitHub:

```bash
npm install -g github:Keyroler1/opscanon
```

For local development from this repo:

```bash
npm install
npm run build
node dist/cli.js --help
```

## Five-Minute Demo

```bash
opscanon demo --out opscanon-demo
```

The demo creates:

- `raw-company-export/`: sample messy company input.
- `ai-ready-pack/`: cleaned sources, quality report, review queue, dashboard, and cleanup checklist.
- `approved-pack/`: review-applied pack.
- `company-brain/`: operating model, skills, action boundaries, score, eval, and MCP dry run.

Open `opscanon-demo/ai-ready-pack/review-dashboard.html` in a browser to inspect the review dashboard.

## Customer Workflow

```bash
opscanon prepare ./raw-company-export --out ai-ready-pack --ocr-text ./ocr-output --dashboard
opscanon review ai-ready-pack
opscanon approve ai-ready-pack --out approved-pack
opscanon build --prepared approved-pack --out company-brain
opscanon score --brain company-brain
opscanon eval --brain company-brain
opscanon serve-mcp --brain company-brain --dry-run
```

Low-confidence material becomes review items and unresolved questions. Only compile-ready or approved cleaned sources flow into `build`.

## Repo Readiness

Repo readiness remains available as a secondary surface:

```bash
opscanon repo audit .
opscanon repo generate . --out opscanon-repo-pack
opscanon repo check-mcp ./mcp-config.json
```

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
      - uses: actions/checkout@v5
      - uses: Keyroler1/opscanon@v0
        with:
          path: .
          out: opscanon-artifacts
          comment: "true"
```

The Action writes `opscanon-report.md` and `opscanon-report.json` and uploads them as artifacts.
