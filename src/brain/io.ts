import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathExists } from '../utils/files.js'
import type {
  BrainActionBoundaryReport,
  BrainConnectorManifest,
  BrainCrawlManifest,
  BrainFact,
  BrainFreshnessReport,
  BrainGraph,
  BrainSourceRecord,
  BrainWorkflowIndex
} from './types.js'

export function brainPaths(brainDir: string): {
  sources: string
  facts: string
  graph: string
  workflowsJson: string
  actionBoundaries: string
  workflows: string
  skills: string
  templates: string
  unresolved: string
  crawlManifest: string
  connectors: string
  freshnessReport: string
  freshnessJson: string
} {
  return {
    sources: join(brainDir, 'sources.jsonl'),
    facts: join(brainDir, 'facts.jsonl'),
    graph: join(brainDir, 'graph.json'),
    workflowsJson: join(brainDir, 'workflows.json'),
    actionBoundaries: join(brainDir, 'action-boundaries.md'),
    workflows: join(brainDir, 'workflows'),
    skills: join(brainDir, 'skills'),
    templates: join(brainDir, 'templates'),
    unresolved: join(brainDir, 'unresolved-questions.md'),
    crawlManifest: join(brainDir, 'crawl-manifest.json'),
    connectors: join(brainDir, 'connectors.json'),
    freshnessReport: join(brainDir, 'freshness-report.md'),
    freshnessJson: join(brainDir, 'freshness-report.json')
  }
}

export async function initializeBrain(brainDir: string): Promise<void> {
  const paths = brainPaths(brainDir)
  await mkdir(brainDir, { recursive: true })
  await mkdir(paths.workflows, { recursive: true })
  await mkdir(paths.skills, { recursive: true })
  await mkdir(paths.templates, { recursive: true })
  await writeIfMissing(paths.sources, '')
  await writeIfMissing(paths.facts, '')
  await writeIfMissing(paths.graph, `${JSON.stringify({ generatedAt: new Date(0).toISOString(), entities: [], relations: [] }, null, 2)}\n`)
  await writeIfMissing(paths.workflowsJson, `${JSON.stringify({ generatedAt: new Date(0).toISOString(), workflows: [] }, null, 2)}\n`)
  await writeIfMissing(paths.connectors, `${JSON.stringify({ version: 1, connectors: [] }, null, 2)}\n`)
  await writeIfMissing(paths.unresolved, '# Unresolved Questions\n\n- Confirm source coverage before agents act on sensitive workflows.\n')
  await writeBrainTemplates(paths.templates)
}

export async function readBrainSources(brainDir: string): Promise<BrainSourceRecord[]> {
  return readJsonl<BrainSourceRecord>(brainPaths(brainDir).sources)
}

export async function writeBrainSources(brainDir: string, sources: BrainSourceRecord[]): Promise<void> {
  await writeJsonl(brainPaths(brainDir).sources, sources)
}

export async function readBrainFacts(brainDir: string): Promise<BrainFact[]> {
  return readJsonl<BrainFact>(brainPaths(brainDir).facts)
}

export async function writeBrainFacts(brainDir: string, facts: BrainFact[]): Promise<void> {
  await writeJsonl(brainPaths(brainDir).facts, facts)
}

export async function readBrainGraph(brainDir: string): Promise<BrainGraph> {
  const graphPath = brainPaths(brainDir).graph
  if (!(await pathExists(graphPath))) {
    return { generatedAt: new Date(0).toISOString(), entities: [], relations: [] }
  }
  return JSON.parse(await readFile(graphPath, 'utf8')) as BrainGraph
}

export async function writeBrainGraph(brainDir: string, graph: BrainGraph): Promise<void> {
  await writeFile(brainPaths(brainDir).graph, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
}

export async function readBrainWorkflowIndex(brainDir: string): Promise<BrainWorkflowIndex> {
  const workflowPath = brainPaths(brainDir).workflowsJson
  if (!(await pathExists(workflowPath))) {
    return { generatedAt: new Date(0).toISOString(), workflows: [] }
  }
  return JSON.parse(await readFile(workflowPath, 'utf8')) as BrainWorkflowIndex
}

export async function writeBrainWorkflowIndex(brainDir: string, workflows: BrainWorkflowIndex): Promise<void> {
  await writeFile(brainPaths(brainDir).workflowsJson, `${JSON.stringify(workflows, null, 2)}\n`, 'utf8')
}

export async function writeBrainActionBoundaryReport(brainDir: string, report: BrainActionBoundaryReport): Promise<void> {
  await writeFile(join(brainDir, 'action-boundaries.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export async function readBrainCrawlManifest(brainDir: string): Promise<BrainCrawlManifest> {
  const manifestPath = brainPaths(brainDir).crawlManifest
  if (!(await pathExists(manifestPath))) {
    return { version: 1, scans: [] }
  }
  return JSON.parse(await readFile(manifestPath, 'utf8')) as BrainCrawlManifest
}

export async function writeBrainCrawlManifest(brainDir: string, manifest: BrainCrawlManifest): Promise<void> {
  await writeFile(brainPaths(brainDir).crawlManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function readBrainConnectorManifest(brainDir: string): Promise<BrainConnectorManifest> {
  const connectorsPath = brainPaths(brainDir).connectors
  if (!(await pathExists(connectorsPath))) {
    return { version: 1, connectors: [] }
  }
  return JSON.parse(await readFile(connectorsPath, 'utf8')) as BrainConnectorManifest
}

export async function writeBrainConnectorManifest(brainDir: string, manifest: BrainConnectorManifest): Promise<void> {
  await writeFile(brainPaths(brainDir).connectors, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function writeBrainFreshnessArtifacts(brainDir: string, report: BrainFreshnessReport, markdown: string): Promise<void> {
  const paths = brainPaths(brainDir)
  await writeFile(paths.freshnessJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(paths.freshnessReport, markdown, 'utf8')
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  if (!(await pathExists(path))) {
    await writeFile(path, content, 'utf8')
  }
}

async function writeBrainTemplates(templatesDir: string): Promise<void> {
  await writeIfMissing(join(templatesDir, 'company-profile.template.md'), `# Company Profile

Company:
Mission:
Primary customers:
Core products:
What agents should know first:
`)
  await writeIfMissing(join(templatesDir, 'decision-log.template.md'), `# Decision Log

## YYYY-MM-DD

Decision:
Reason:
Owner:
Impacted products/customers:
Review date:
`)
  await writeIfMissing(join(templatesDir, 'agent-boundaries.template.md'), `# Agent Boundaries

Agents may do without approval:
- Read public/internal documentation.
- Summarize source-cited context.

Agents require human approval before:
- Changing customer data.
- Posting externally.
- Modifying production systems.
- Spending money or changing billing.
`)
  await writeIfMissing(join(templatesDir, 'source-adapters.md'), `# Source Adapters

Use these folders or exports to teach the company brain what the company knows.

- Markdown/local folders: SilverBullet, Obsidian, plain docs, Docusaurus, MkDocs.
- Wiki exports: Notion, Confluence, Outline, BookStack, Wiki.js, GitBook.
- Work exports: GitHub, Linear, Jira, Slack, support tickets, CRM notes.
- Drive exports: Google Drive, SharePoint, OneDrive.

Run:

\`\`\`bash
opscanon prepare ./raw-company-export --source docs --out ai-ready-pack --ocr-text ./ocr-output --dashboard
opscanon review ai-ready-pack
opscanon approve ai-ready-pack --out approved-pack
opscanon build --prepared approved-pack --out company-brain
opscanon connect notion ./notion-export --consent "approved-by-owner" --out company-brain
opscanon github owner/repo --issues 10 --out company-brain
opscanon crawl ./company-files --source docs --consent "approved-by-owner" --out company-brain
opscanon refresh --brain company-brain --build
opscanon freshness --brain company-brain
opscanon score --brain company-brain
opscanon eval --brain company-brain
\`\`\`
`)
}

async function readJsonl<T>(path: string): Promise<T[]> {
  if (!(await pathExists(path))) {
    return []
  }

  const content = await readFile(path, 'utf8')
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

async function writeJsonl<T>(path: string, rows: T[]): Promise<void> {
  const body = rows.map((row) => JSON.stringify(row)).join('\n')
  await writeFile(path, body ? `${body}\n` : '', 'utf8')
}
