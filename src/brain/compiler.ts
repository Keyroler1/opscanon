import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  initializeBrain,
  readBrainCrawlManifest,
  readBrainSources,
  writeBrainActionBoundaryReport,
  writeBrainFacts,
  writeBrainGraph,
  writeBrainWorkflowIndex
} from './io.js'
import { hash } from './ingest.js'
import { stripMarkdownFrontmatter } from './markdown.js'
import { writeBrainQualityReport } from './quality.js'
import type { BrainBuildResult, BrainCrawlManifest, BrainEntity, BrainFact, BrainFactCategory, BrainGraph, BrainRelation, BrainSourceRecord } from './types.js'
import {
  buildActionBoundaryReport,
  buildOperatingModel,
  buildWorkflowIndex,
  extractWorkflows,
  renderActionBoundariesMarkdown,
  renderOperatingModelMarkdown,
  renderWorkflowMarkdown,
  renderWorkflowSkill
} from './workflows.js'

const IMPORTANT_TERMS = [
  'agent',
  'approval',
  'company',
  'compensation',
  'controller',
  'crm',
  'customer',
  'decision',
  'discount',
  'finance',
  'greenhouse',
  'goal',
  'hiring',
  'hubspot',
  'input',
  'intake',
  'interview',
  'invoice',
  'lead',
  'mission',
  'mcp',
  'offer',
  'output',
  'owner',
  'policy',
  'pricing',
  'priority',
  'product',
  'qualification',
  'quickbooks',
  'recruiter',
  'refund',
  'repo',
  'sales',
  'security',
  'sdr',
  'system',
  'support',
  'vendor',
  'workflow'
]

export async function buildBrain(brainDir: string): Promise<BrainBuildResult> {
  await initializeBrain(brainDir)
  const sources = await readBrainSources(brainDir)
  const facts = dedupeFacts(sources.flatMap(extractFactsFromSource))
  const graph = buildGraph(sources, facts)
  const workflows = extractWorkflows(sources, facts)

  await writeBrainFacts(brainDir, facts)
  await writeBrainGraph(brainDir, graph)
  await writeArtifacts(brainDir, sources, facts, graph, workflows)
  const qualityReport = await writeBrainQualityReport(brainDir)

  return {
    brainDir,
    sourceCount: sources.length,
    factCount: facts.length,
    entityCount: graph.entities.length,
    relationCount: graph.relations.length,
    workflowCount: workflows.length,
    qualityScore: qualityReport.score
  }
}

export function extractFactsFromSource(source: BrainSourceRecord): BrainFact[] {
  const facts: BrainFact[] = []
  const lines = stripMarkdownFrontmatter(source.content).split(/\r?\n/)
  let currentHeading = source.title

  for (const rawLine of lines) {
    const trimmed = rawLine.replace(/^\uFEFF/, '').trim()
    if (!trimmed || trimmed.startsWith('```')) {
      continue
    }

    if (/^#{1,4}\s+/.test(trimmed)) {
      currentHeading = trimmed.replace(/^#{1,4}\s+/, '').trim()
      facts.push(createFact(source, currentHeading, categorize(currentHeading), [currentHeading]))
      continue
    }

    const normalized = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim()
    if (!shouldKeepLine(normalized)) {
      continue
    }

    const claim = normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized
    facts.push(createFact(source, claim, categorize(`${currentHeading} ${claim}`), extractSubjects(`${currentHeading} ${claim}`)))
  }

  return facts
}

function createFact(source: BrainSourceRecord, claim: string, category: BrainFactCategory, subjects: string[]): BrainFact {
  return {
    id: `fact_${hash(`${source.id}:${claim}`).slice(0, 16)}`,
    claim,
    category,
    sourceIds: [source.id],
    subjects,
    confidence: 0.78,
    status: 'active',
    lastSeen: source.ingestedAt
  }
}

function shouldKeepLine(line: string): boolean {
  if (line.length < 12 || line.includes('[REDACTED]')) {
    return false
  }

  if (/^[A-Z0-9_]+\s*=/.test(line)) {
    return false
  }

  const lower = line.toLowerCase()
  return IMPORTANT_TERMS.some((term) => lower.includes(term)) || /^(decision|reason|owner|customers?)\s*:/i.test(line)
}

function categorize(value: string): BrainFactCategory {
  const lower = value.toLowerCase()
  if (lower.includes('decision') || lower.startsWith('reason:')) return 'decision'
  if (lower.includes('customer') || lower.includes('users are') || lower.includes('buyers')) return 'customer'
  if (lower.includes('product') || lower.includes('builds') || lower.includes('helps')) return 'product'
  if (lower.includes('approval') || lower.includes('policy') || lower.includes('require')) return 'policy'
  if (lower.includes('workflow') || lower.includes('playbook') || lower.includes('process')) return 'workflow'
  if (lower.includes('priority') || lower.includes('goal') || lower.includes('mission')) return 'priority'
  if (lower.includes('repo') || lower.includes('mcp') || lower.includes('engineering')) return 'engineering'
  if (lower.includes('security') || lower.includes('secret') || lower.includes('permission')) return 'security'
  if (lower.includes('team') || lower.includes('owner:') || lower.includes('founder')) return 'team'
  if (lower.includes('company') || lower.includes('mission')) return 'company'
  return 'general'
}

function extractSubjects(value: string): string[] {
  const subjects = new Set<string>()
  for (const match of value.matchAll(/\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,4}\b/g)) {
    const subject = match[0].trim()
    if (!['Decision', 'Reason', 'Owner', 'Current Priorities', 'Operating Principles'].includes(subject)) {
      subjects.add(subject)
    }
  }
  return [...subjects].slice(0, 8)
}

function dedupeFacts(facts: BrainFact[]): BrainFact[] {
  const seen = new Set<string>()
  const result: BrainFact[] = []
  for (const fact of facts) {
    const key = `${fact.category}:${fact.claim.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(fact)
    }
  }
  return result
}

function buildGraph(sources: BrainSourceRecord[], facts: BrainFact[]): BrainGraph {
  const entityMap = new Map<string, BrainEntity>()
  const relations: BrainRelation[] = []

  for (const source of sources) {
    const sourceEntity = makeEntity('tool', source.title, [source.id])
    entityMap.set(sourceEntity.id, mergeEntity(entityMap.get(sourceEntity.id), sourceEntity))
  }

  for (const fact of facts) {
    for (const subject of fact.subjects) {
      const entity = makeEntity(entityTypeForFact(fact.category), subject, fact.sourceIds)
      entityMap.set(entity.id, mergeEntity(entityMap.get(entity.id), entity))
      relations.push({
        from: entity.id,
        to: fact.id,
        type: relationTypeForFact(fact.category),
        sourceIds: fact.sourceIds
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    entities: [...entityMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    relations
  }
}

function makeEntity(type: BrainEntity['type'], name: string, sourceIds: string[]): BrainEntity {
  return {
    id: `entity_${hash(`${type}:${name.toLowerCase()}`).slice(0, 16)}`,
    type,
    name,
    sourceIds
  }
}

function mergeEntity(existing: BrainEntity | undefined, next: BrainEntity): BrainEntity {
  if (!existing) {
    return next
  }

  return {
    ...existing,
    sourceIds: [...new Set([...existing.sourceIds, ...next.sourceIds])]
  }
}

function entityTypeForFact(category: BrainFactCategory): BrainEntity['type'] {
  if (category === 'customer') return 'customer'
  if (category === 'product') return 'product'
  if (category === 'team') return 'team'
  if (category === 'workflow') return 'workflow'
  if (category === 'policy') return 'policy'
  return 'company'
}

function relationTypeForFact(category: BrainFactCategory): BrainRelation['type'] {
  if (category === 'customer') return 'serves'
  if (category === 'product' || category === 'engineering') return 'implements'
  if (category === 'policy' || category === 'security') return 'governs'
  if (category === 'decision') return 'decided'
  if (category === 'workflow') return 'requires'
  return 'mentions'
}

async function writeArtifacts(brainDir: string, sources: BrainSourceRecord[], facts: BrainFact[], graph: BrainGraph, workflows = extractWorkflows(sources, facts)): Promise<void> {
  const crawlManifest = await readBrainCrawlManifest(brainDir)
  const workflowIndex = buildWorkflowIndex(workflows)
  const operatingModel = buildOperatingModel(workflows)
  const boundaryReport = buildActionBoundaryReport(workflows, facts)
  await mkdir(join(brainDir, 'workflows'), { recursive: true })
  await mkdir(join(brainDir, 'skills'), { recursive: true })

  await writeBrainWorkflowIndex(brainDir, workflowIndex)
  await writeBrainActionBoundaryReport(brainDir, boundaryReport)
  await writeFile(join(brainDir, 'operating-model.json'), `${JSON.stringify(operatingModel, null, 2)}\n`, 'utf8')
  await writeFile(join(brainDir, 'operating-model.md'), renderOperatingModelMarkdown(operatingModel, sources), 'utf8')
  await writeFile(join(brainDir, 'company-profile.md'), renderArtifact('Company Profile', facts, sources, ['company', 'product', 'customer', 'priority', 'general']), 'utf8')
  await writeFile(join(brainDir, 'source-coverage.md'), renderSourceCoverage(sources, crawlManifest), 'utf8')
  await writeFile(join(brainDir, 'operating-principles.md'), renderArtifact('Operating Principles', facts, sources, ['policy', 'security']), 'utf8')
  await writeFile(join(brainDir, 'product-map.md'), renderArtifact('Product Map', facts, sources, ['product', 'engineering']), 'utf8')
  await writeFile(join(brainDir, 'customer-map.md'), renderArtifact('Customer Map', facts, sources, ['customer']), 'utf8')
  await writeFile(join(brainDir, 'team-map.md'), renderArtifact('Team Map', facts, sources, ['team']), 'utf8')
  await writeFile(join(brainDir, 'decision-log.md'), renderArtifact('Decision Log', facts, sources, ['decision']), 'utf8')
  await writeFile(join(brainDir, 'workflows', 'agent-operating-playbook.md'), renderArtifact('Agent Operating Playbook', facts, sources, ['workflow', 'policy', 'security']), 'utf8')
  for (const workflow of workflows) {
    await writeFile(join(brainDir, 'workflows', `${workflow.slug}.md`), renderWorkflowMarkdown(workflow, sources), 'utf8')
    await writeFile(join(brainDir, 'skills', `${workflow.slug}.md`), renderWorkflowSkill(workflow, sources), 'utf8')
  }
  await writeFile(join(brainDir, 'skills', 'company-context.md'), renderSkill(facts, sources), 'utf8')
  await writeFile(join(brainDir, 'action-boundaries.md'), renderActionBoundariesMarkdown(boundaryReport, sources), 'utf8')
  await writeFile(join(brainDir, 'mcp-review.md'), renderMcpReview(), 'utf8')
  await writeFile(join(brainDir, 'unresolved-questions.md'), renderUnresolvedQuestions(facts, graph), 'utf8')
}

function renderSourceCoverage(sources: BrainSourceRecord[], crawlManifest: BrainCrawlManifest): string {
  const byType = countBy(sources, (source) => source.sourceType)
  const byAdapter = countBy(sources, (source) => source.metadata.sourceAdapter ?? 'manual-ingest')
  const redactedCount = sources.filter((source) => source.redacted).length
  const latestIngest = sources
    .map((source) => source.ingestedAt)
    .sort()
    .at(-1) ?? 'none'
  const typeLines = entriesByCount(byType).map(([type, count]) => `- ${type}: ${count}`).join('\n') || '- No sources ingested yet.'
  const adapterLines = entriesByCount(byAdapter).map(([adapter, count]) => `- ${adapter}: ${count}`).join('\n') || '- No adapters used yet.'
  const scanLines = crawlManifest.scans.length
    ? crawlManifest.scans.slice(-20).map((scan) => [
        `- ${scan.scannedAt} ${scan.sourceType} via ${scan.sourceAdapter}`,
        `  - root: ${scan.rootPath}`,
        `  - consent: ${scan.consent}`,
        `  - files: ${scan.filesEligible} eligible, ${scan.filesSkipped} skipped`,
        `  - sources: ${scan.sourcesAdded} added, ${scan.sourcesSkipped} skipped`
      ].join('\n')).join('\n')
    : '- No permissioned crawler scans recorded yet.'

  return `# Source Coverage

This file shows what the company brain has actually seen. Treat missing sources as missing knowledge.

## Summary

- Sources: ${sources.length}
- Sources with redactions: ${redactedCount}
- Latest ingest: ${latestIngest}

## Source Types

${typeLines}

## Source Adapters

${adapterLines}

## Permissioned Crawler Scans

${scanLines}

## Recommended Human Source Routes

- Markdown/local folders: SilverBullet, Obsidian, plain docs, Docusaurus, MkDocs.
- Wiki exports: Notion, Confluence, Outline, BookStack, Wiki.js, GitBook.
- Work exports: GitHub, Linear, Jira, Slack, support tickets, CRM notes.
- Drive exports: Google Drive, SharePoint, OneDrive.

Run broad crawls only with explicit company-owner approval:

\`\`\`bash
opscanon crawl ./company-files --source docs --consent "approved-by-owner" --out company-brain
\`\`\`
`
}

function renderArtifact(title: string, facts: BrainFact[], sources: BrainSourceRecord[], categories: BrainFactCategory[]): string {
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const relevant = facts.filter((fact) => categories.includes(fact.category)).slice(0, 40)
  const body = relevant.length
    ? relevant.map((fact) => `- ${fact.claim} (${citationForFact(fact, sourceById)})`).join('\n')
    : '- No source-cited facts found yet.'

  return `# ${title}

${body}
`
}

function renderSkill(facts: BrainFact[], sources: BrainSourceRecord[]): string {
  return `---
name: company-context
description: Load source-cited company context, operating principles, decisions, and workflows before helping this company.
---

# Company Context

Use this skill when an agent needs to understand what the company does, who it serves, how it works, and what boundaries apply before taking action.

## Core Context

${renderArtifact('Core Context', facts, sources, ['company', 'product', 'customer', 'policy', 'decision']).replace(/^# Core Context\n\n/, '')}
`
}

function renderMcpReview(): string {
  return `# MCP Review

Read-only MCP is the default surface for the company brain v1.

Recommended tools:
- search
- fetch
- get_company_profile
- get_operating_model
- get_workflow
- get_action_boundaries
- get_freshness
- get_project_context
- get_recent_decisions

Write actions should require explicit human approval in a later version.
`
}

function renderUnresolvedQuestions(facts: BrainFact[], graph: BrainGraph): string {
  const categories = new Set(facts.map((fact) => fact.category))
  const questions = [
    !categories.has('team') ? 'Who owns each product, workflow, and customer-facing policy?' : undefined,
    !categories.has('customer') ? 'Which customer segments and named customers should agents prioritize?' : undefined,
    !categories.has('policy') ? 'Which actions require human approval before an agent proceeds?' : undefined,
    graph.entities.length === 0 ? 'Which people, products, customers, repos, and tools are canonical entities?' : undefined,
    'Which sources are stale, incomplete, or missing from this compiled brain?'
  ].filter((question): question is string => Boolean(question))

  return `# Unresolved Questions

${questions.map((question) => `- ${question}`).join('\n')}
`
}

function citationForFact(fact: BrainFact, sourceById: Map<string, BrainSourceRecord>): string {
  return fact.sourceIds
    .map((sourceId) => sourceById.get(sourceId))
    .filter((source): source is BrainSourceRecord => Boolean(source))
    .map((source) => `source: ${source.title}`)
    .join(', ')
}

function countBy<T>(values: T[], keyForValue: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = keyForValue(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function entriesByCount(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}
