import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { pathExists } from '../utils/files.js'
import { isTextFile, readTextFile } from '../utils/files.js'
import { redactSecrets } from '../utils/redaction.js'
import { hash } from './ingest.js'
import type {
  BrainPrepareManifest,
  BrainPrepareIssue,
  BrainPrepareReport,
  BrainPrepareResult,
  BrainPreparedDocument,
  BrainPreparedDocumentClassification,
  BrainReviewDecisionFile,
  BrainSourceRecord,
  BrainSourceType
} from './types.js'
import { buildOperatingModel, extractWorkflows, renderOperatingModelMarkdown, slugify } from './workflows.js'

const DEFAULT_MAX_BYTES_PER_FILE = 500_000
const DEFAULT_MAX_AGE_DAYS = 730
const DEFAULT_MIN_QUALITY_SCORE = 70

const PREPARE_TEXT_EXTENSIONS = new Set([
  '.csv',
  '.log',
  '.tsv',
  '.text'
])

const UNREADABLE_EXTENSIONS = new Set([
  '.gif',
  '.heic',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp'
])

export interface BrainPrepareOptions {
  sourceType?: BrainSourceType
  maxAgeDays?: number
  minQualityScore?: number
  maxBytesPerFile?: number
  ocrTextPath?: string
  dashboard?: boolean
}

interface RawDocument {
  absolutePath: string
  relativePath: string
  name: string
  bytes: number
  lastModified: string
  readable: boolean
  rawContent: string
  content: string
  redacted: boolean
  ocrTextPath?: string
  convertedFromOcr: boolean
}

interface ConflictRule {
  documentId: string
  relativePath: string
  topic: string
  kind: 'approval-threshold' | 'approval-owner' | 'permission'
  value: string
  line: string
}

export async function prepareBrainKnowledge(inputPath: string, packDir: string, options: BrainPrepareOptions = {}): Promise<BrainPrepareResult> {
  const absoluteInputPath = resolve(inputPath)
  const absolutePackDir = resolve(packDir)
  const sourceType = options.sourceType ?? 'docs'
  const maxAgeDays = positiveInteger(options.maxAgeDays, DEFAULT_MAX_AGE_DAYS)
  const minQualityScore = positiveInteger(options.minQualityScore, DEFAULT_MIN_QUALITY_SCORE)
  const maxBytesPerFile = positiveInteger(options.maxBytesPerFile, DEFAULT_MAX_BYTES_PER_FILE)
  const rawDocuments = await readRawDocuments(absoluteInputPath, maxBytesPerFile, options.ocrTextPath ? resolve(options.ocrTextPath) : undefined)
  const context = buildPrepareContext(rawDocuments, maxAgeDays)
  const documents = rawDocuments.map((document) => classifyDocument(document, context, { sourceType, minQualityScore }))
  const conflicts = detectConflicts(rawDocuments, documents)
  applyConflicts(documents, conflicts)

  const highConfidenceDocuments = documents.filter((document) => document.status === 'compile')
  const issues = buildPrepareIssues(documents, conflicts)
  const cleanedDir = join(absolutePackDir, 'cleaned-sources')
  await mkdir(cleanedDir, { recursive: true })

  for (const document of highConfidenceDocuments) {
    const rawDocument = rawDocuments.find((candidate) => candidate.relativePath === document.relativePath)
    if (!rawDocument) {
      continue
    }
    const cleanedContent = normalizeToMarkdown(rawDocument, document)
    const cleanedPath = join(cleanedDir, `${slugify(document.relativePath.replace(/\.[^.]+$/, ''))}.md`)
    await mkdir(dirname(cleanedPath), { recursive: true })
    await writeFile(cleanedPath, cleanedContent, 'utf8')
    document.cleanedPath = relative(absolutePackDir, cleanedPath).replaceAll('\\', '/')
  }

  const sourceRecords = highConfidenceDocuments.flatMap((document) => {
    const rawDocument = rawDocuments.find((candidate) => candidate.relativePath === document.relativePath)
    return rawDocument ? [preparedSourceRecord(rawDocument, document)] : []
  })
  const workflows = extractWorkflows(sourceRecords)
  const operatingModel = buildOperatingModel(workflows)
  const report: BrainPrepareReport = {
    generatedAt: new Date().toISOString(),
    inputPath: absoluteInputPath,
    packDir: absolutePackDir,
    sourceType,
    minQualityScore,
    maxAgeDays,
    totalFiles: rawDocuments.length,
    cleanedDocuments: highConfidenceDocuments.length,
    reviewItems: documents.filter((document) => document.status === 'review').length,
    duplicateItems: documents.filter((document) => document.classifications.includes('duplicate')).length,
    staleItems: documents.filter((document) => document.classifications.includes('stale')).length,
    unreadableItems: documents.filter((document) => document.classifications.includes('unreadable')).length,
    noiseItems: documents.filter((document) => document.classifications.includes('noise')).length,
    documents,
    issues
  }
  const manifest = buildPrepareManifest(report)
  const reviewDecisions = buildReviewDecisionFile(report)

  await writeFile(join(absolutePackDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(join(absolutePackDir, 'source-inventory.json'), `${JSON.stringify({ ...report, issues: undefined }, null, 2)}\n`, 'utf8')
  await writeFile(join(absolutePackDir, 'candidate-operating-knowledge.json'), `${JSON.stringify(operatingModel, null, 2)}\n`, 'utf8')
  await writeFile(join(absolutePackDir, 'document-quality-report.md'), renderQualityReport(report), 'utf8')
  await writeFile(join(absolutePackDir, 'duplicate-report.md'), renderDuplicateReport(documents), 'utf8')
  await writeFile(join(absolutePackDir, 'noise-staleness-report.md'), renderNoiseStalenessReport(report), 'utf8')
  await writeFile(join(absolutePackDir, 'human-review-queue.md'), renderHumanReviewQueue(report), 'utf8')
  await writeFile(join(absolutePackDir, 'client-cleanup-checklist.md'), renderClientCleanupChecklist(report), 'utf8')
  await writeFile(join(absolutePackDir, 'unresolved-questions.md'), renderUnresolvedQuestions(report), 'utf8')
  await writeFile(join(absolutePackDir, 'ocr-review.md'), renderOcrReview(rawDocuments, documents), 'utf8')
  await writeFile(join(absolutePackDir, 'review-decisions.json'), `${JSON.stringify(reviewDecisions, null, 2)}\n`, 'utf8')
  await writeFile(join(absolutePackDir, 'review-dashboard.html'), renderReviewDashboard(report, manifest), 'utf8')
  await writeFile(join(absolutePackDir, 'operating-model-preview.md'), renderOperatingModelMarkdown(operatingModel, sourceRecords), 'utf8')

  return {
    packDir: absolutePackDir,
    totalFiles: report.totalFiles,
    cleanedDocuments: report.cleanedDocuments,
    reviewItems: report.reviewItems,
    duplicateItems: report.duplicateItems,
    staleItems: report.staleItems,
    unreadableItems: report.unreadableItems,
    noiseItems: report.noiseItems
  }
}

async function readRawDocuments(rootPath: string, maxBytesPerFile: number, ocrTextRoot?: string): Promise<RawDocument[]> {
  const rootStat = await stat(rootPath)
  const files: Array<{ absolutePath: string; relativePath: string; name: string }> = []

  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = join(path, entry.name)
      if (entry.isDirectory()) {
        if (!['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache'].includes(entry.name)) {
          await visit(absolutePath)
        }
        continue
      }

      if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: relative(rootPath, absolutePath).replaceAll('\\', '/'),
          name: entry.name
        })
      }
    }
  }

  if (rootStat.isDirectory()) {
    await visit(rootPath)
  } else {
    files.push({
      absolutePath: rootPath,
      relativePath: basename(rootPath),
      name: basename(rootPath)
    })
  }

  const documents: RawDocument[] = []
  for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const fileStat = await stat(file.absolutePath)
    let readable = isPrepareTextFile(file.absolutePath) && fileStat.size <= maxBytesPerFile
    let rawContent = ''
    let ocrTextPath: string | undefined
    let convertedFromOcr = false
    if (readable) {
      try {
        rawContent = await readTextFile(file.absolutePath, maxBytesPerFile)
      } catch {
        rawContent = ''
      }
    }
    if (!readable && ocrTextRoot) {
      const candidateOcrPath = join(ocrTextRoot, `${file.relativePath}.txt`)
      if (await pathExists(candidateOcrPath)) {
        try {
          rawContent = await readFile(candidateOcrPath, 'utf8')
          readable = Boolean(rawContent.trim())
          ocrTextPath = candidateOcrPath
          convertedFromOcr = readable
        } catch {
          rawContent = ''
        }
      }
    }
    const content = readable ? redactSecrets(rawContent) : ''
    documents.push({
      ...file,
      bytes: fileStat.size,
      lastModified: fileStat.mtime.toISOString(),
      readable,
      rawContent,
      content,
      redacted: readable && content !== rawContent,
      ocrTextPath,
      convertedFromOcr
    })
  }

  return documents
}

function buildPrepareContext(documents: RawDocument[], maxAgeDays: number): {
  contentHashCounts: Map<string, number>
  normalizedHashCounts: Map<string, number>
  firstByContentHash: Map<string, RawDocument>
  firstByNormalizedHash: Map<string, RawDocument>
  maxAgeDays: number
} {
  const contentHashCounts = new Map<string, number>()
  const normalizedHashCounts = new Map<string, number>()
  const firstByContentHash = new Map<string, RawDocument>()
  const firstByNormalizedHash = new Map<string, RawDocument>()
  const candidates = documents
    .filter((candidate) => candidate.readable && candidate.content.trim())
    .sort((a, b) => canonicalPathRank(a.relativePath) - canonicalPathRank(b.relativePath) || a.relativePath.localeCompare(b.relativePath))
  for (const document of candidates) {
    const contentHash = hash(document.content)
    const normalizedHash = hash(normalizeForDuplicate(document.content))
    contentHashCounts.set(contentHash, (contentHashCounts.get(contentHash) ?? 0) + 1)
    normalizedHashCounts.set(normalizedHash, (normalizedHashCounts.get(normalizedHash) ?? 0) + 1)
    if (!firstByContentHash.has(contentHash)) {
      firstByContentHash.set(contentHash, document)
    }
    if (!firstByNormalizedHash.has(normalizedHash)) {
      firstByNormalizedHash.set(normalizedHash, document)
    }
  }
  return { contentHashCounts, normalizedHashCounts, firstByContentHash, firstByNormalizedHash, maxAgeDays }
}

function classifyDocument(raw: RawDocument, context: ReturnType<typeof buildPrepareContext>, options: {
  sourceType: BrainSourceType
  minQualityScore: number
}): BrainPreparedDocument {
  const classifications = new Set<BrainPreparedDocumentClassification>()
  const reasons: string[] = []
  const title = inferTitle(raw.content, raw.name)
  const detectedOwner = inferOwner(raw.content)
  const detectedDates = inferDates(raw.content)
  const contentHash = raw.readable && raw.content.trim() ? hash(raw.content) : undefined
  const normalizedHash = raw.readable && raw.content.trim() ? hash(normalizeForDuplicate(raw.content)) : undefined
  let duplicateOf: string | undefined

  if (!raw.readable) {
    classifications.add('unreadable')
    reasons.push(unreadableReason(raw.name))
  }
  if (raw.readable && !raw.content.trim()) {
    classifications.add('noise')
    reasons.push('Document is empty after reading.')
  }
  if (raw.readable && raw.content.trim() && isNoise(raw.content)) {
    classifications.add('noise')
    reasons.push('Document has too little meaningful operating content.')
  }
  if (isStale(raw.lastModified, context.maxAgeDays)) {
    classifications.add('stale')
    reasons.push(`Last modified is older than ${context.maxAgeDays} day(s).`)
  }
  if (raw.redacted) {
    classifications.add('secret-redacted')
    reasons.push('Likely secret values were redacted before cleanup.')
  }
  if (raw.convertedFromOcr) {
    classifications.add('ocr-converted')
    reasons.push(`OCR text supplied from ${raw.ocrTextPath ?? 'external text export'}.`)
  }
  if (contentHash && (context.contentHashCounts.get(contentHash) ?? 0) > 1) {
    const original = context.firstByContentHash.get(contentHash)
    if (original && original.relativePath !== raw.relativePath) {
      classifications.add('duplicate')
      duplicateOf = original.relativePath
      reasons.push(`Exact duplicate of ${original.relativePath}.`)
    }
  } else if (normalizedHash && (context.normalizedHashCounts.get(normalizedHash) ?? 0) > 1) {
    const original = context.firstByNormalizedHash.get(normalizedHash)
    if (original && original.relativePath !== raw.relativePath) {
      classifications.add('duplicate')
      duplicateOf = original.relativePath
      reasons.push(`Near duplicate of ${original.relativePath}.`)
    }
  }

  for (const classification of contentClassifications(raw.content, raw.name)) {
    classifications.add(classification)
  }

  const qualityScore = scoreDocument(raw, classifications, duplicateOf, { detectedOwner, detectedDates })
  const status = statusForDocument(classifications, qualityScore, options.minQualityScore)
  if (qualityScore < options.minQualityScore) {
    reasons.push(`Quality score ${qualityScore} is below compile threshold ${options.minQualityScore}.`)
  }

  return {
    id: `prep_${hash(`${raw.relativePath}:${contentHash ?? raw.bytes}`).slice(0, 16)}`,
    relativePath: raw.relativePath,
    originalPath: raw.absolutePath,
    title,
    contentHash,
    normalizedHash,
    bytes: raw.bytes,
    lastModified: raw.lastModified,
    detectedOwner,
    detectedDates,
    sourceType: options.sourceType,
    classifications: [...classifications].sort(),
    qualityScore,
    status,
    reasons,
    duplicateOf,
    redacted: raw.redacted,
    stale: classifications.has('stale')
  }
}

function statusForDocument(classifications: Set<BrainPreparedDocumentClassification>, qualityScore: number, minQualityScore: number): BrainPreparedDocument['status'] {
  if (classifications.has('duplicate')) {
    return 'exclude'
  }
  if (classifications.has('unreadable') || classifications.has('stale') || classifications.has('noise') || classifications.has('conflict') || qualityScore < minQualityScore) {
    return 'review'
  }
  return 'compile'
}

function scoreDocument(raw: RawDocument, classifications: Set<BrainPreparedDocumentClassification>, duplicateOf: string | undefined, metadata: {
  detectedOwner?: string
  detectedDates: string[]
}): number {
  let score = 0
  if (raw.readable && raw.content.trim()) score += 20
  if (raw.relativePath) score += 5
  if (raw.lastModified || metadata.detectedDates.length > 0) score += 5
  if (metadata.detectedOwner) score += 10
  if (!duplicateOf) score += 15
  if ([...classifications].some((classification) => ['procedure', 'policy', 'decision', 'customer-evidence', 'system-docs'].includes(classification))) score += 25
  if (!classifications.has('stale')) score += 10
  if (!classifications.has('noise') && !classifications.has('unreadable')) score += 10
  if (classifications.has('secret-redacted')) score -= 5
  return Math.max(0, Math.min(100, score))
}

function contentClassifications(content: string, name: string): BrainPreparedDocumentClassification[] {
  const value = `${name}\n${content}`.toLowerCase()
  const classifications: BrainPreparedDocumentClassification[] = []
  if (/\b(workflow|process|procedure|playbook|runbook|sop|when|if|before|after|output|checks?|updates?|approves?|reviews?)\b/.test(value)) classifications.push('procedure')
  if (/\b(policy|must|must not|do not|never|required|approval|permission)\b/.test(value)) classifications.push('policy')
  if (/\b(decision|decided|reason:|owner:)\b/.test(value)) classifications.push('decision')
  if (/\b(customer|lead|opportunity|ticket|case|account)\b/.test(value)) classifications.push('customer-evidence')
  if (/\b(hubspot|salesforce|greenhouse|github|linear|jira|quickbooks|stripe|slack|zendesk|crm|system|vendor)\b/.test(value)) classifications.push('system-docs')
  if (/\b(meeting|notes|agenda|attendees|action items)\b/.test(value)) classifications.push('meeting-notes')
  return classifications
}

function normalizeToMarkdown(raw: RawDocument, document: BrainPreparedDocument): string {
  const body = normalizeMarkdownBody(raw.content, document.title)
  return `---
original_path: ${document.relativePath}
source_type: ${document.sourceType}
content_hash: ${document.contentHash ?? 'none'}
quality_score: ${document.qualityScore}
last_modified: ${document.lastModified ?? 'unknown'}
detected_owner: ${document.detectedOwner ?? 'unknown'}
detected_dates: ${document.detectedDates.join(', ') || 'none'}
classifications: ${document.classifications.join(', ')}
---

${body}
`
}

function normalizeMarkdownBody(content: string, title: string): string {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
  const nonEmpty = lines.filter(Boolean)
  const hasHeading = nonEmpty.some((line) => /^#{1,6}\s+/.test(line))
  const normalized = nonEmpty.map((line, index) => {
    if (index === 0 && !hasHeading && line.toLowerCase() === title.toLowerCase()) {
      return `# ${title}`
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^#{1,6}\s+/.test(line) || /^[A-Za-z ]+:\s+/.test(line)) {
      return line
    }
    return line
  })

  return hasHeading ? normalized.join('\n\n') : [`# ${title}`, ...normalized.filter((line) => line.toLowerCase() !== title.toLowerCase())].join('\n\n')
}

function preparedSourceRecord(raw: RawDocument, document: BrainPreparedDocument): BrainSourceRecord {
  return {
    id: `src_${hash(`prepared:${document.relativePath}:${document.contentHash ?? ''}`).slice(0, 16)}`,
    sourceType: document.sourceType,
    title: document.title,
    path: raw.absolutePath,
    content: raw.content,
    contentHash: document.contentHash ?? hash(raw.content),
    ingestedAt: new Date().toISOString(),
    redacted: raw.redacted,
    metadata: {
      relativePath: document.relativePath,
      bytes: Buffer.byteLength(raw.content, 'utf8'),
      lastModified: document.lastModified,
      sourceAdapter: 'ai-ready-prepare'
    }
  }
}

function detectConflicts(rawDocuments: RawDocument[], documents: BrainPreparedDocument[]): ConflictRule[][] {
  const rules: ConflictRule[] = []
  const documentByPath = new Map(documents.map((document) => [document.relativePath, document]))
  for (const raw of rawDocuments) {
    const document = documentByPath.get(raw.relativePath)
    if (!document || !raw.content.trim()) continue
    for (const line of raw.content.split(/\r?\n/).map((candidate) => candidate.trim()).filter(Boolean)) {
      const thresholdMatch = line.match(/\b(.{0,80}?)(above|over|greater than)\s+(\$?\d[\d,]*(?:\s*(?:percent|dollars))?).{0,80}?\brequires?\b.{0,80}?\bapproval\b/i)
      if (thresholdMatch) {
        rules.push({
          documentId: document.id,
          relativePath: document.relativePath,
          topic: approvalTopic(`${document.title} ${line}`),
          kind: 'approval-threshold',
          value: thresholdMatch[3]?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '',
          line
        })
      }

      const ownerMatch = line.match(/\brequires?\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]+){0,3}|VP\s+[A-Z][A-Za-z]+|People lead|Finance lead|Security owner|Controller|Manager|Founder|CFO|CEO)\s+approval\b/i)
      if (ownerMatch) {
        rules.push({
          documentId: document.id,
          relativePath: document.relativePath,
          topic: approvalTopic(`${document.title} ${line}`),
          kind: 'approval-owner',
          value: canonicalRuleValue(ownerMatch[1] ?? ''),
          line
        })
      }

      const permission = permissionRuleForLine(document.title, line)
      if (permission) {
        rules.push({
          documentId: document.id,
          relativePath: document.relativePath,
          topic: permission.topic,
          kind: 'permission',
          value: permission.value,
          line
        })
      }
    }
  }

  const byTopic = new Map<string, ConflictRule[]>()
  for (const rule of rules) {
    const key = `${rule.topic}:${rule.kind}`
    byTopic.set(key, [...(byTopic.get(key) ?? []), rule])
  }

  return [...byTopic.values()]
    .filter((items) => new Set(items.map((item) => item.value)).size > 1)
}

function applyConflicts(documents: BrainPreparedDocument[], conflicts: ConflictRule[][]): void {
  const byId = new Map(documents.map((document) => [document.id, document]))
  for (const conflict of conflicts) {
    const conflictingDocuments = conflict
      .map((rule) => byId.get(rule.documentId))
      .filter((document): document is BrainPreparedDocument => Boolean(document))
    const hasStaleConflict = conflictingDocuments.some((document) => document.classifications.includes('stale'))
    for (const document of conflictingDocuments) {
      if (hasStaleConflict && !document.classifications.includes('stale')) {
        document.reasons = [...document.reasons, `${conflictReason(conflict)} The conflicting source is stale and routed to review.`]
        continue
      }

      if (!document.classifications.includes('conflict')) {
        const classifications: BrainPreparedDocumentClassification[] = [...document.classifications, 'conflict']
        document.classifications = classifications.sort()
      }
      document.reasons = [...document.reasons, conflictReason(conflict)]
      if (document.status === 'compile') {
        document.status = 'review'
      }
    }
  }
}

function buildPrepareIssues(documents: BrainPreparedDocument[], conflicts: ConflictRule[][]): BrainPrepareIssue[] {
  const issues: BrainPrepareIssue[] = []
  for (const document of documents) {
    if (document.status === 'compile') continue
    issues.push({
      severity: document.status === 'exclude' ? 'info' : 'warning',
      documentId: document.id,
      path: document.relativePath,
      message: document.reasons.join(' ') || `Document requires review because it was classified as ${document.classifications.join(', ')}.`,
      recommendation: recommendationForDocument(document)
    })
  }
  for (const conflict of conflicts) {
    issues.push({
      severity: 'warning',
      message: `${conflictReason(conflict)} ${conflict.map((rule) => `${rule.value} in ${rule.relativePath}`).join('; ')}.`,
      recommendation: 'Ask the source owner to identify the current rule before compiling this procedure.'
    })
  }
  return issues
}

function buildPrepareManifest(report: BrainPrepareReport): BrainPrepareManifest {
  const packQualityScore = Math.round(report.documents.reduce((total, document) => total + document.qualityScore, 0) / Math.max(1, report.documents.length))
  const conflicts = report.documents.filter((document) => document.classifications.includes('conflict')).length
  return {
    version: 1,
    generatedAt: report.generatedAt,
    inputPath: report.inputPath,
    packDir: report.packDir,
    safeToBuild: report.cleanedDocuments > 0,
    packQualityScore,
    counts: {
      totalFiles: report.totalFiles,
      compileReady: report.cleanedDocuments,
      review: report.reviewItems,
      duplicates: report.duplicateItems,
      stale: report.staleItems,
      unreadable: report.unreadableItems,
      noise: report.noiseItems,
      conflicts
    },
    artifacts: [
      'cleaned-sources/',
      'source-inventory.json',
      'document-quality-report.md',
      'duplicate-report.md',
      'noise-staleness-report.md',
      'candidate-operating-knowledge.json',
      'human-review-queue.md',
      'client-cleanup-checklist.md',
      'review-decisions.json',
      'review-dashboard.html',
      'ocr-review.md',
      'unresolved-questions.md'
    ],
    nextCommands: [
      `opscanon review ${report.packDir}`,
      `opscanon approve ${report.packDir} --out approved-pack`,
      'opscanon build --prepared approved-pack --out company-brain'
    ]
  }
}

function buildReviewDecisionFile(report: BrainPrepareReport): BrainReviewDecisionFile {
  return {
    version: 1,
    generatedAt: report.generatedAt,
    packDir: report.packDir,
    decisions: report.documents
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

function renderOcrReview(rawDocuments: RawDocument[], documents: BrainPreparedDocument[]): string {
  const documentByPath = new Map(documents.map((document) => [document.relativePath, document]))
  const ocrLines = rawDocuments
    .filter((document) => document.convertedFromOcr || !document.readable)
    .map((document) => {
      const prepared = documentByPath.get(document.relativePath)
      if (document.convertedFromOcr) {
        return `- ${document.relativePath}: OCR text supplied from ${document.ocrTextPath ?? 'external text export'}; status ${prepared?.status ?? 'unknown'}.`
      }
      return `- ${document.relativePath}: OCR/manual review required. Provide text as <ocr-folder>/${document.relativePath}.txt and rerun opscanon prepare --ocr-text <ocr-folder>.`
    })

  return `# OCR Review

${ocrLines.length ? ocrLines.join('\n') : '- No OCR/manual review items found.'}
`
}

function renderReviewDashboard(report: BrainPrepareReport, manifest: BrainPrepareManifest): string {
  const rows = report.documents.map((document) => [
    '<tr>',
    `<td>${escapeHtml(document.relativePath)}</td>`,
    `<td>${escapeHtml(document.status)}</td>`,
    `<td>${document.qualityScore}</td>`,
    `<td>${escapeHtml(document.detectedOwner ?? 'unknown')}</td>`,
    `<td>${escapeHtml(document.classifications.join(', ') || 'none')}</td>`,
    `<td>${escapeHtml(document.reasons.join(' ') || 'Ready to compile.')}</td>`,
    '</tr>'
  ].join('')).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AI-Ready Knowledge Review</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #17202a; background: #f7f8fa; }
    main { max-width: 1200px; margin: 0 auto; }
    h1, h2 { margin-bottom: 8px; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; margin: 18px 0; }
    .metric { background: #fff; border: 1px solid #d8dee4; border-radius: 6px; padding: 12px; }
    .metric strong { display: block; font-size: 24px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8dee4; }
    th, td { padding: 8px; border-bottom: 1px solid #d8dee4; text-align: left; vertical-align: top; }
    th { background: #eef2f6; }
  </style>
</head>
<body>
<main>
  <h1>AI-Ready Knowledge Review</h1>
  <p>Use this dashboard to review what is compile-ready, what needs human cleanup, and what should become questions instead of facts.</p>
  <section class="metrics">
    <div class="metric"><span>Pack Score</span><strong>${manifest.packQualityScore}</strong></div>
    <div class="metric"><span>Compile Ready</span><strong>${manifest.counts.compileReady}</strong></div>
    <div class="metric"><span>Needs Review</span><strong>${manifest.counts.review}</strong></div>
    <div class="metric"><span>Conflicts</span><strong>${manifest.counts.conflicts}</strong></div>
    <div class="metric"><span>Unreadable</span><strong>${manifest.counts.unreadable}</strong></div>
  </section>
  <h2>Source Inventory</h2>
  <table>
    <thead><tr><th>Path</th><th>Status</th><th>Score</th><th>Owner</th><th>Classifications</th><th>Reason</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</main>
</body>
</html>
`
}

function renderQualityReport(report: BrainPrepareReport): string {
  const rows = report.documents.map((document) => `| ${document.relativePath} | ${document.status} | ${document.qualityScore} | ${document.detectedOwner ?? 'unknown'} | ${document.detectedDates.join(', ') || document.lastModified?.slice(0, 10) || 'unknown'} | ${document.classifications.join(', ') || 'none'} |`).join('\n')
  return `# Document Quality Report

## Summary

- Input files: ${report.totalFiles}
- Cleaned documents: ${report.cleanedDocuments}
- Review items: ${report.reviewItems}
- Duplicates: ${report.duplicateItems}
- Stale documents: ${report.staleItems}
- Unreadable documents: ${report.unreadableItems}
- Noise documents: ${report.noiseItems}

## Inventory

| Path | Status | Score | Owner Signal | Date Signal | Classifications |
|---|---:|---:|---|---|---|
${rows || '| none | none | 0 | unknown | unknown | none |'}
`
}

function renderDuplicateReport(documents: BrainPreparedDocument[]): string {
  const duplicates = documents.filter((document) => document.classifications.includes('duplicate'))
  return `# Duplicate Report

${duplicates.length
    ? duplicates.map((document) => `- ${document.relativePath} duplicates ${document.duplicateOf ?? 'another source'}.`).join('\n')
    : '- No exact or near duplicates found.'}
`
}

function renderNoiseStalenessReport(report: BrainPrepareReport): string {
  const documents = report.documents.filter((document) => document.classifications.some((classification) => ['noise', 'stale', 'unreadable'].includes(classification)))
  return `# Noise And Staleness Report

${documents.length
    ? documents.map((document) => `- ${document.relativePath}: ${document.classifications.join(', ')}. ${document.reasons.join(' ')}`).join('\n')
    : '- No noisy, stale, or unreadable documents found.'}
`
}

function renderHumanReviewQueue(report: BrainPrepareReport): string {
  const issueLines = report.issues.length
    ? report.issues.map((issue) => `- ${issue.path ?? 'cross-document issue'}: ${issue.message} Recommendation: ${issue.recommendation}`).join('\n')
    : '- No human review items. The prepared pack is ready for compilation.'

  return `# Human Review Queue

Human review is part of the product. These items should become corrected source material or explicit unresolved questions before agents rely on them.

${issueLines}
`
}

function renderClientCleanupChecklist(report: BrainPrepareReport): string {
  const reviewItems = report.documents.filter((document) => document.status === 'review')
  const duplicateItems = report.documents.filter((document) => document.classifications.includes('duplicate'))
  const staleItems = report.documents.filter((document) => document.classifications.includes('stale'))
  const unreadableItems = report.documents.filter((document) => document.classifications.includes('unreadable'))
  const noisyItems = report.documents.filter((document) => document.classifications.includes('noise'))
  const conflictItems = report.issues.filter((issue) => /conflicting/i.test(issue.message))

  const lines = [
    ...unreadableItems.map((document) => `- OCR or export readable text for \`${document.relativePath}\`; place it at \`<ocr-folder>/${document.relativePath}.txt\` and rerun \`opscanon prepare --ocr-text <ocr-folder>\`.`),
    ...staleItems.map((document) => `- Confirm whether \`${document.relativePath}\` is still current, or replace it with the latest owner-approved source.`),
    ...duplicateItems.map((document) => `- Remove or ignore \`${document.relativePath}\`; canonical source appears to be \`${document.duplicateOf ?? 'listed in duplicate-report.md'}\`.`),
    ...noisyItems.map((document) => `- Replace \`${document.relativePath}\` with a source that states the actual policy, decision, system, owner, or procedure.`),
    ...conflictItems.map((issue) => `- Resolve this conflict before approving automation: ${issue.message}`),
    ...reviewItems
      .filter((document) => !document.classifications.some((classification) => ['unreadable', 'stale', 'duplicate', 'noise', 'conflict'].includes(classification)))
      .map((document) => `- Ask the source owner to fill missing details for \`${document.relativePath}\`: owner, trigger, system, decision rule, approval gate, and expected output.`)
  ]

  return `# Client Cleanup Checklist

Use this checklist to turn weak or unclear source material into approved operating knowledge. Do not compile unresolved items into executable skills.

## Summary

- Input files reviewed: ${report.totalFiles}
- Compile-ready files: ${report.cleanedDocuments}
- Files needing human review: ${report.reviewItems}
- Duplicates: ${report.duplicateItems}
- Stale files: ${report.staleItems}
- Unreadable files: ${report.unreadableItems}
- Noise files: ${report.noiseItems}

## Actions For The Client

${lines.length ? lines.join('\n') : '- No cleanup required before approval. Review the generated dashboard and approve the pack.'}

## Next Commands

\`\`\`bash
opscanon review ${report.packDir}
opscanon approve ${report.packDir} --out approved-pack
opscanon build --prepared approved-pack --out company-brain
\`\`\`
`
}

function renderUnresolvedQuestions(report: BrainPrepareReport): string {
  const questions = report.issues
    .filter((issue) => issue.severity !== 'info')
    .map((issue) => `- ${issue.path ? `${issue.path}: ` : ''}${issue.recommendation}`)
  return `# Unresolved Questions

${questions.length ? questions.join('\n') : '- No unresolved questions from preparation.'}
`
}

function recommendationForDocument(document: BrainPreparedDocument): string {
  if (document.classifications.includes('unreadable')) return 'Run OCR/manual review and provide a text export.'
  if (document.classifications.includes('duplicate')) return `Use the canonical source ${document.duplicateOf ?? 'listed in the duplicate report'}.`
  if (document.classifications.includes('stale')) return 'Confirm whether this document is current or provide the latest source.'
  if (document.classifications.includes('conflict')) return 'Resolve the conflicting approval, ownership, or permission rule before compiling.'
  if (document.classifications.includes('noise')) return 'Replace with a source that describes actual policy, decision, customer, system, or procedure knowledge.'
  return 'Ask a source owner to fill missing owner, date, system, decision, or output details.'
}

function conflictReason(conflict: ConflictRule[]): string {
  const topic = conflict[0]?.topic ?? 'unknown topic'
  const kind = conflict[0]?.kind ?? 'approval-threshold'
  if (kind === 'approval-owner') return `Conflicting approval owners found for ${topic}.`
  if (kind === 'permission') return `Conflicting permission rules found for ${topic}.`
  return `Conflicting approval thresholds found for ${topic}.`
}

function permissionRuleForLine(title: string, line: string): { topic: string; value: string } | undefined {
  const lower = line.toLowerCase()
  const isDeny = /\b(must not|do not|never|cannot|can't|may not|without approval)\b/.test(lower)
  const isAllow = /\b(may|can|allowed to|approved to)\b/.test(lower) && !isDeny
  if (!isAllow && !isDeny) {
    return undefined
  }

  return {
    topic: approvalTopic(`${title} ${line}`),
    value: isDeny ? 'deny' : 'allow'
  }
}

function canonicalRuleValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isPrepareTextFile(path: string): boolean {
  const lower = path.toLowerCase()
  return isTextFile(path) || PREPARE_TEXT_EXTENSIONS.has(extname(lower))
}

function isNoise(content: string): boolean {
  const words = content.split(/\s+/).filter(Boolean)
  if (words.length < 8) return true
  const uniqueRatio = new Set(words.map((word) => word.toLowerCase())).size / words.length
  return uniqueRatio < 0.25 && words.length < 80
}

function isStale(timestamp: string, maxAgeDays: number): boolean {
  const elapsed = Date.now() - new Date(timestamp).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return false
  return Math.floor(elapsed / 86_400_000) > maxAgeDays
}

function inferTitle(content: string, fallbackName: string): string {
  const firstHeading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,3}\s+/.test(line))
  if (firstHeading) {
    return firstHeading.replace(/^#{1,3}\s+/, '').trim()
  }
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine && firstLine.length <= 120
    ? firstLine
    : basename(fallbackName, extname(fallbackName)).replace(/[-_]+/g, ' ')
}

function inferOwner(content: string): string | undefined {
  const explicitOwner = content.match(/\b(?:owner|responsible|assigned to|approver):\s*([^\n\r.;]+)/i)?.[1]?.trim()
  if (explicitOwner) {
    return explicitOwner.slice(0, 80)
  }

  const roleMatch = content.match(/\b(SDR|BDR|AE|sales lead|support lead|success manager|engineer|security owner|finance lead|controller|recruiter|manager|founder|admin|operator)\b/i)?.[1]?.trim()
  return roleMatch ? roleMatch.slice(0, 80) : undefined
}

function inferDates(content: string): string[] {
  const matches = content.match(/\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})\b/gi) ?? []
  return [...new Set(matches.map((match) => match.replace(/\s+/g, ' ').trim()))].slice(0, 5)
}

function normalizeForDuplicate(content: string): string {
  return content.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function approvalTopic(value: string): string {
  const lower = value.toLowerCase()
  if (lower.includes('refund')) return 'refund'
  if (lower.includes('discount') || lower.includes('pricing')) return 'discount'
  if (lower.includes('customer record') || lower.includes('customer data')) return 'customer-data'
  if (lower.includes('vendor')) return 'vendor'
  if (lower.includes('incident')) return 'incident'
  if (lower.includes('production') || lower.includes('rollback')) return 'production-change'
  if (lower.includes('compensation') || lower.includes('offer')) return 'compensation'
  return lower.split(/\s+/).slice(0, 6).join(' ')
}

function unreadableReason(name: string): string {
  const extension = extname(name).toLowerCase()
  if (UNREADABLE_EXTENSIONS.has(extension)) {
    return `Unsupported ${extension || 'binary'} file; OCR/manual review is required.`
  }
  return 'File is unsupported or too large to read as text.'
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.floor(value)
}

function canonicalPathRank(path: string): number {
  return /\b(copy|duplicate|old|archive|backup)\b/i.test(path) ? 1 : 0
}
