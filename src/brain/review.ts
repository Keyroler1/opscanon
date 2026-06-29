import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathExists } from '../utils/files.js'
import { redactSecrets } from '../utils/redaction.js'
import type {
  BrainApproveResult,
  BrainPrepareReport,
  BrainPreparedDocument,
  BrainReviewDecision,
  BrainReviewDecisionFile,
  BrainReviewResult
} from './types.js'
import { slugify } from './workflows.js'

export async function createBrainReviewWorkspace(packDir: string): Promise<BrainReviewResult> {
  const absolutePackDir = resolve(packDir)
  const decisionsPath = join(absolutePackDir, 'review-decisions.json')
  const decisions = await readOrCreateDecisionFile(absolutePackDir)
  await writeFile(decisionsPath, `${JSON.stringify(decisions, null, 2)}\n`, 'utf8')
  await writeFile(join(absolutePackDir, 'review-workspace.md'), renderReviewWorkspace(decisions), 'utf8')
  return {
    packDir: absolutePackDir,
    decisionCount: decisions.decisions.length,
    decisionsPath
  }
}

export async function approveBrainPreparedPack(packDir: string, approvedPackDir: string, options: {
  decisionsPath?: string
} = {}): Promise<BrainApproveResult> {
  const absolutePackDir = resolve(packDir)
  const absoluteApprovedPackDir = resolve(approvedPackDir)
  const decisionsPath = resolve(options.decisionsPath ?? join(absolutePackDir, 'review-decisions.json'))
  const inventory = await readPrepareInventory(absolutePackDir)
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8')) as BrainReviewDecisionFile
  const documentsByPath = new Map(inventory.documents.map((document) => [document.relativePath, document]))
  let approvedDocuments = 0
  let rejectedDocuments = 0

  await cp(absolutePackDir, absoluteApprovedPackDir, { recursive: true, force: true })
  const cleanedDir = join(absoluteApprovedPackDir, 'cleaned-sources')
  await mkdir(cleanedDir, { recursive: true })

  for (const decision of decisions.decisions) {
    if (decision.decision === 'reject') {
      rejectedDocuments += 1
      continue
    }
    if (decision.decision !== 'approve-current' && decision.decision !== 'approve-with-corrections') {
      continue
    }

    const document = documentsByPath.get(decision.path)
    if (!document) {
      continue
    }
    const contentPath = decision.decision === 'approve-with-corrections' && decision.correctedContentPath
      ? resolve(decision.correctedContentPath)
      : document.originalPath
    if (!(await pathExists(contentPath))) {
      continue
    }

    const rawContent = await readFile(contentPath, 'utf8')
    const redactedContent = redactSecrets(rawContent)
    const cleanedPath = join(cleanedDir, `${slugify(document.relativePath.replace(/\.[^.]+$/, ''))}.md`)
    await writeFile(cleanedPath, renderApprovedMarkdown(redactedContent, document, decision), 'utf8')
    approvedDocuments += 1
  }

  await writeFile(join(absoluteApprovedPackDir, 'review-decisions-applied.json'), `${JSON.stringify(decisions, null, 2)}\n`, 'utf8')
  await writeFile(join(absoluteApprovedPackDir, 'approval-summary.md'), renderApprovalSummary(decisions, approvedDocuments, rejectedDocuments), 'utf8')

  return {
    packDir: absolutePackDir,
    approvedPackDir: absoluteApprovedPackDir,
    approvedDocuments,
    rejectedDocuments
  }
}

async function readOrCreateDecisionFile(packDir: string): Promise<BrainReviewDecisionFile> {
  const decisionsPath = join(packDir, 'review-decisions.json')
  if (await pathExists(decisionsPath)) {
    return JSON.parse(await readFile(decisionsPath, 'utf8')) as BrainReviewDecisionFile
  }

  const inventory = await readPrepareInventory(packDir)
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    packDir,
    decisions: inventory.documents
      .filter((document) => document.status === 'review')
      .map((document) => ({
        documentId: document.id,
        path: document.relativePath,
        title: document.title,
        currentStatus: document.status,
        classifications: document.classifications,
        qualityScore: document.qualityScore,
        decision: document.classifications.includes('unreadable') ? 'needs-ocr' : 'needs-review',
        allowedDecisions: document.classifications.includes('unreadable')
          ? ['needs-ocr', 'reject']
          : ['approve-current', 'approve-with-corrections', 'reject', 'needs-review'],
        reviewer: '',
        notes: '',
        correctedContentPath: ''
      }))
  }
}

async function readPrepareInventory(packDir: string): Promise<BrainPrepareReport> {
  return JSON.parse(await readFile(join(packDir, 'source-inventory.json'), 'utf8')) as BrainPrepareReport
}

function renderApprovedMarkdown(content: string, document: BrainPreparedDocument, decision: BrainReviewDecision): string {
  return `---
original_path: ${document.relativePath}
source_type: ${document.sourceType}
content_hash: ${document.contentHash ?? 'review-approved'}
quality_score: ${document.qualityScore}
last_modified: ${document.lastModified ?? 'unknown'}
review_decision: ${decision.decision}
reviewer: ${decision.reviewer || 'unknown'}
classifications: ${document.classifications.join(', ')}
---

${normalizeMarkdownBody(content, document.title)}
`
}

function normalizeMarkdownBody(content: string, title: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.some((line) => /^#{1,6}\s+/.test(line))) {
    return lines.join('\n\n')
  }
  return [`# ${title}`, ...lines].join('\n\n')
}

function renderReviewWorkspace(decisions: BrainReviewDecisionFile): string {
  const rows = decisions.decisions.map((decision) => `| ${decision.path} | ${decision.decision} | ${decision.classifications.join(', ')} | ${decision.notes || 'needs reviewer note'} |`).join('\n')
  return `# Review Workspace

Edit review-decisions.json to approve, correct, reject, or keep each item in review.

| Path | Decision | Classifications | Notes |
|---|---|---|---|
${rows || '| none | none | none | none |'}
`
}

function renderApprovalSummary(decisions: BrainReviewDecisionFile, approvedDocuments: number, rejectedDocuments: number): string {
  return `# Approval Summary

- Decisions reviewed: ${decisions.decisions.length}
- Documents approved into cleaned-sources: ${approvedDocuments}
- Documents rejected: ${rejectedDocuments}

Only approved or previously compile-ready cleaned sources should flow into brain build.
`
}
