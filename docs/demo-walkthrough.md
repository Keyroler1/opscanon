# Demo Walkthrough

This is a script for the eventual demo video. It is also useful for live sales calls.

## Goal

Show: "From messy company export to agent-ready operating brain in 5 minutes."

## Setup

```bash
npm install -g github:Keyroler1/opscanon
opscanon demo --out opscanon-demo
```

## Walkthrough

1. Open `opscanon-demo/raw-company-export/`.
   - Show that the input is ordinary company knowledge: support refunds, pricing exceptions, incidents, vendor review, OCR text, and company overview.

2. Open `opscanon-demo/ai-ready-pack/`.
   - Show `document-quality-report.md`.
   - Show `client-cleanup-checklist.md`.
   - Open `review-dashboard.html`.
   - Explain that weak material becomes review work, not agent facts.

3. Open `opscanon-demo/company-brain/`.
   - Show `operating-model.md`.
   - Show `skills/refund-handling.md`.
   - Show `action-boundaries.md`.
   - Show `brain-quality-report.md` and `brain-eval-report.md`.

4. Run MCP dry-run:

```bash
opscanon serve-mcp --brain opscanon-demo/company-brain --dry-run
```

5. Close with:
   - OpsCanon is not a chatbot over docs.
   - It turns approved operating knowledge into source-cited skills and safe action boundaries for agents.

## What To Emphasize

- Local-first.
- Source-cited.
- Human review before compilation.
- Read-only MCP v1.
- Approval gates for customer, billing, production, security, and external actions.
