# Launch Post Draft

## Short Version

We built OpsCanon: a local-first CLI that turns messy company knowledge into verified agent skills.

Most "company brain" tools stop at search or chat over documents. OpsCanon does something narrower and more operational: it prepares messy exports, flags duplicates/stale/conflicting/noisy sources, routes uncertainty to humans, and compiles approved operating knowledge into source-cited skills, action boundaries, evals, and a read-only MCP server.

Try it:

```bash
npm install -g github:Keyroler1/opscanon#v0
opscanon demo --out opscanon-demo
```

Repo: https://github.com/Keyroler1/opscanon
Landing page: https://keyroler1.github.io/opscanon/

## Longer Version

AI agents need more than a pile of company documents. They need to know how the company actually works:

- how refunds are handled
- how pricing exceptions are approved
- how incidents are escalated
- which systems are touched
- which actions require human approval
- which sources are stale, duplicated, or contradictory

OpsCanon turns those fragmented sources into a reviewed operating brain.

The workflow:

1. `opscanon prepare` cleans and scores messy exports.
2. `opscanon review` creates a human review workspace.
3. `opscanon approve` compiles only approved knowledge.
4. `opscanon build` generates skills, action boundaries, source coverage, evals, and MCP artifacts.
5. `opscanon serve-mcp` exposes the company brain to AI clients through read-only MCP tools.

This is not enterprise search. It is the missing layer between raw company data and reliable AI automation.

## First Users

We are looking for:

- AI implementation agencies onboarding clients
- ops-heavy startups adopting agents
- devtool teams making repos and MCP servers agent-ready
- builders who need source-cited procedures and approval boundaries

Run the demo and open `opscanon-demo/ai-ready-pack/review-dashboard.html`.
