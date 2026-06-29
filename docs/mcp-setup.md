# MCP Setup

OpsCanon exposes a read-only MCP server over stdio for compiled company brains.

## Build A Brain First

```bash
opscanon prepare ./raw-company-export --out ai-ready-pack --dashboard
opscanon review ai-ready-pack
opscanon approve ai-ready-pack --out approved-pack
opscanon build --prepared approved-pack --out company-brain
opscanon eval --brain company-brain
```

## Dry Run

```bash
opscanon serve-mcp --brain company-brain --dry-run
```

## Codex

Add a local MCP server entry that runs the installed binary:

```toml
[mcp_servers.opscanon]
command = "opscanon"
args = ["serve-mcp", "--brain", "company-brain"]
```

For a repo-local brain, use an absolute `--brain` path.

## Claude-Style MCP Clients

Use a stdio MCP server:

```json
{
  "mcpServers": {
    "opscanon": {
      "command": "opscanon",
      "args": ["serve-mcp", "--brain", "/absolute/path/to/company-brain"]
    }
  }
}
```

## ChatGPT-Style Clients

Use the same MCP command when the client supports stdio MCP servers. For hosted or remote MCP clients, wrap `opscanon serve-mcp` behind a controlled bridge only after you decide how authentication, audit logging, and network boundaries work.

## Tools Exposed

- `search`: search source-cited company-brain facts.
- `fetch`: fetch a fact or source by id.
- `get_company_profile`: read company profile.
- `get_operating_model`: read the compiled operating model.
- `get_workflow`: fetch one compiled workflow.
- `get_action_boundaries`: read approval gates and safe action boundaries.
- `get_freshness`: read freshness status.
- `get_project_context`: read repo/project context.
- `get_recent_decisions`: read recent source-cited decisions.

OpsCanon v1 MCP tools are read-only. Write actions should be separate tools with explicit human approval gates.
