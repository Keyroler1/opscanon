# Distribution Plan

OpsCanon should be self-serve first. Services can be used to learn, but the core product should not depend on manual onboarding.

## Channels

- npm package: `opscanon`
- GitHub repo: `Keyroler1/opscanon`
- GitHub Action: `Keyroler1/opscanon@v0`
- Landing page: `https://keyroler1.github.io/opscanon/`
- Static docs and examples in this repo.
- MCP server packaged with the CLI.
- Listings in MCP and agent-tooling directories after the package is public.

## Launch Demo

Concrete demo: "From messy company export to agent-ready operating brain in 5 minutes."

```bash
npm install -g opscanon
opscanon demo --out opscanon-demo
```

Show the raw export, review dashboard, cleanup checklist, generated skills, action boundaries, eval report, and MCP dry run.

## First Users

- AI builders wiring agents into real operations.
- AI implementation agencies that need repeatable client onboarding.
- Devtool startups building with MCP and agent workflows.
- Ops-heavy startups adopting internal agents.

## Commercial Model

- Free/open CLI for local packs, repo readiness, static dashboards, and MCP server.
- Paid later: hosted dashboard, managed connectors, scheduled freshness checks, team review workflow, private cloud/on-prem, audit logs, and compliance controls.
- Initial pricing test: $49-$199/month for hosted/team features, with higher-touch setup only as an optional learning channel.

## Name And Launch Checks

Before public launch:

- Confirm npm ownership and reserve `opscanon`.
- Confirm GitHub repo availability for `Keyroler1/opscanon`.
- Check domains such as `opscanon.com`, `opscanon.dev`, and `opscanon.ai`.
- Do a basic trademark/conflict search.
- Publish a v0 release and verify `npm install -g opscanon`.

See `docs/name-checks.md` for the current read-only name and availability notes.

## Missing Product Work

- Hosted UI.
- OAuth connectors.
- Native OCR.
- Billing, auth, and team accounts.
- Scheduled refresh and monitoring beyond local runs.
- Opt-in telemetry and activation funnel.
- Connector request workflow and public roadmap.
