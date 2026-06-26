# RepoHandoff

RepoHandoff audits whether a repository, tool, or MCP server is ready for AI agents to use safely and repeatably.

It starts as a CLI and GitHub Action. There is no hosted dashboard, billing system, or required API key in v1.

## What It Checks

RepoHandoff scores five categories:

| Category | Weight |
|---|---:|
| Agent-facing setup/docs | 25% |
| Machine interfaces: CLI/API/MCP/OpenAPI | 25% |
| Repo context quality | 20% |
| Eval/test reproducibility | 15% |
| MCP/security boundaries | 15% |

## Install

```bash
npm install -g github:Keyroler1/repohandoff
```

The `repohandoff` npm package name is available, but this machine is not authenticated to npm yet. After publishing, the install command will become `npm install -g repohandoff`.

For local development:

```bash
npm install
npm run build
npm link
```

## CLI

```bash
repohandoff audit <path>
repohandoff audit <path> --json
repohandoff generate <path> --out repohandoff-pack
repohandoff check-mcp <command-or-config>
repohandoff ci <path> --out repohandoff-artifacts
```

`audit` is read-only and prints to stdout. `generate` writes only to the selected output folder.

## Generated Pack

`repohandoff generate . --out repohandoff-pack` creates:

- `AGENTS.md`
- `repo-map.md`
- `skills/agent-setup.md`
- `skills/repo-audit.md`
- `skills/mcp-safety.md`
- `promptfoo.yaml`
- `mcp-review.md`
- `repohandoff-report.md`
- `repohandoff-report.json`

## Optional LLM Synthesis

RepoHandoff works deterministically without API keys. If you want a short LLM-written synthesis, pass `--llm` and set `OPENAI_API_KEY`.

```bash
OPENAI_API_KEY=... repohandoff generate . --out repohandoff-pack --llm
```

If `OPENAI_API_KEY` is missing, the deterministic report still works.

## GitHub Action

```yaml
name: RepoHandoff

on:
  pull_request:

jobs:
  repohandoff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/repohandoff@v0
        with:
          path: .
          out: repohandoff-artifacts
          comment: "true"
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

The Action uploads `repohandoff-report.md` and `repohandoff-report.json` as artifacts and writes the Markdown report to the GitHub step summary.

## Validation Loop

Before treating this as production-ready:

1. Audit 20 public repos.
2. Generate 5 useful PRs or issue comments.
3. Get at least 3 maintainers or builders to say they would use it again.
