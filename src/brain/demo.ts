import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildBrain } from './compiler.js'
import { writeBrainEvalReport } from './eval.js'
import { ingestBrainSource } from './ingest.js'
import { renderMcpDryRun } from './mcp-server.js'
import { prepareBrainKnowledge } from './prepare.js'
import { writeBrainQualityReport } from './quality.js'
import { approveBrainPreparedPack, createBrainReviewWorkspace } from './review.js'
import type {
  BrainApproveResult,
  BrainBuildResult,
  BrainEvalReport,
  BrainPrepareResult,
  BrainQualityReport,
  BrainReviewResult
} from './types.js'

export interface OpsCanonDemoResult {
  rootDir: string
  rawDir: string
  ocrDir: string
  preparedPackDir: string
  approvedPackDir: string
  brainDir: string
  prepared: BrainPrepareResult
  review: BrainReviewResult
  approval: BrainApproveResult
  build: BrainBuildResult
  quality: BrainQualityReport
  evalReport: BrainEvalReport
}

export async function createOpsCanonDemo(outDir: string): Promise<OpsCanonDemoResult> {
  const rootDir = resolve(outDir)
  const rawDir = join(rootDir, 'raw-company-export')
  const ocrDir = join(rootDir, 'ocr-output')
  const preparedPackDir = join(rootDir, 'ai-ready-pack')
  const approvedPackDir = join(rootDir, 'approved-pack')
  const brainDir = join(rootDir, 'company-brain')

  await writeDemoRawExport(rawDir, ocrDir)
  const prepared = await prepareBrainKnowledge(rawDir, preparedPackDir, {
    sourceType: 'docs',
    ocrTextPath: ocrDir,
    dashboard: true
  })
  const review = await createBrainReviewWorkspace(preparedPackDir)
  const approval = await approveBrainPreparedPack(preparedPackDir, approvedPackDir)
  await ingestBrainSource(join(approvedPackDir, 'cleaned-sources'), brainDir, { sourceType: 'docs' })
  const build = await buildBrain(brainDir)
  const quality = await writeBrainQualityReport(brainDir)
  const evalReport = await writeBrainEvalReport(brainDir)

  await writeFile(join(brainDir, 'mcp-dry-run.md'), renderMcpDryRun(brainDir), 'utf8')
  await writeFile(join(rootDir, 'README.md'), renderDemoReadme(rootDir), 'utf8')

  return {
    rootDir,
    rawDir,
    ocrDir,
    preparedPackDir,
    approvedPackDir,
    brainDir,
    prepared,
    review,
    approval,
    build,
    quality,
    evalReport
  }
}

async function writeDemoRawExport(rawDir: string, ocrDir: string): Promise<void> {
  const fakeOpenAiKey = ['OPENAI_API_KEY=sk-demo', 'local-redaction-value-1234567890'].join('-')
  await mkdir(rawDir, { recursive: true })
  await mkdir(ocrDir, { recursive: true })
  await writeFile(join(rawDir, 'company-overview.md'), `# AtlasOps Company Overview

AtlasOps helps B2B SaaS teams turn fragmented support, sales, and engineering knowledge into reliable agent workflows.
Customers are AI implementation agencies, support leaders, and engineering managers.
Mission: make operational knowledge safe enough for AI agents to use.
Priority: keep actions source-cited, reviewed, and approval-gated.
`, 'utf8')
  await writeFile(join(rawDir, 'support-refunds.md'), `# Refund Handling

Owner: Support lead
When a customer requests a refund, Support agent checks Zendesk ticket history, Stripe charge status, and account notes.
Support agent summarizes evidence and prepares the recommended refund decision.
Refund requests above $750 require Founder approval before changing Stripe.
Output: approved refund, rejected refund, or unresolved customer question.
`, 'utf8')
  await writeFile(join(rawDir, 'pricing-exceptions.md'), `# Pricing Exception Handling

Owner: VP Sales
When an account lead requests custom pricing, AE gathers Salesforce opportunity context, ARR, term length, and competitor notes.
AE prepares a pricing exception summary for VP Sales.
Discounts above 20 percent require VP Sales approval before sending external terms.
Output: approved pricing exception or rejected pricing exception.
`, 'utf8')
  await writeFile(join(rawDir, 'incident-response.md'), `# Incident Response

Owner: Engineer
When Datadog alerts on production errors, Engineer triages impact, opens a GitHub issue, and posts status in Slack.
Engineer prepares a rollback recommendation and validates customer impact before action.
Production rollback requires Incident commander approval.
Output: incident summary, customer impact note, and approved rollback plan.
`, 'utf8')
  await writeFile(join(rawDir, 'vendor-security.txt'), `# Vendor Security Review

Owner: Security owner
When a team wants a new vendor, Engineer opens security review and shares the vendor subprocessors.
Security owner checks data classification, access scope, and customer impact in Notion.
Do not share production credentials with vendors.
${fakeOpenAiKey}
Output: approved vendor, rejected vendor, or open risk questions.
`, 'utf8')
  await writeFile(join(rawDir, 'scan.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))
  await writeFile(join(ocrDir, 'scan.pdf.txt'), `# Legacy Approval Snapshot

Owner: Finance lead
When a billing exception appears in QuickBooks, Controller reviews invoice amount and customer contract.
Billing changes require Finance lead approval before updating QuickBooks.
Output: approved billing adjustment or rejected billing adjustment.
`, 'utf8')
}

function renderDemoReadme(rootDir: string): string {
  return `# OpsCanon Demo

This folder was generated by \`opscanon demo\`. It shows the self-serve path from messy company export to source-cited company brain.

## What Was Created

- \`raw-company-export/\`: sample support, sales, engineering, security, OCR, and company overview inputs.
- \`ai-ready-pack/\`: cleaned sources, quality reports, review dashboard, OCR report, and client cleanup checklist.
- \`approved-pack/\`: approval-applied pack ready for compilation.
- \`company-brain/\`: operating model, skills, source coverage, action boundaries, score, eval, and MCP dry run.

## Try The Same Flow

\`\`\`bash
opscanon prepare ${rootDir}/raw-company-export --out ${rootDir}/ai-ready-pack --ocr-text ${rootDir}/ocr-output --dashboard
opscanon review ${rootDir}/ai-ready-pack
opscanon approve ${rootDir}/ai-ready-pack --out ${rootDir}/approved-pack
opscanon build --prepared ${rootDir}/approved-pack --out ${rootDir}/company-brain
opscanon score --brain ${rootDir}/company-brain
opscanon eval --brain ${rootDir}/company-brain
opscanon serve-mcp --brain ${rootDir}/company-brain --dry-run
\`\`\`
`
}
