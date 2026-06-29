import { stat } from 'node:fs/promises'
import { buildBrain } from './compiler.js'
import { updateBrainConnectorSyncTime } from './connectors.js'
import { crawlBrainSources } from './crawler.js'
import {
  initializeBrain,
  readBrainConnectorManifest,
  readBrainCrawlManifest,
  readBrainSources,
  writeBrainFreshnessArtifacts
} from './io.js'
import type {
  BrainConnector,
  BrainCrawlScan,
  BrainFreshnessItem,
  BrainFreshnessReport,
  BrainFreshnessStatus,
  BrainRefreshResult,
  BrainSourceRecord,
  BrainSourceType
} from './types.js'

const DEFAULT_MAX_AGE_DAYS = 30

interface FreshnessOptions {
  maxAgeDays?: number
}

interface RefreshOptions {
  buildAfter?: boolean
}

interface RefreshScope {
  rootPath: string
  sourceType: BrainSourceType
  sourceAdapter: string
  consent: string
  allCompanyFiles: boolean
  maxFiles: number
  maxBytesPerFile: number
  connectorId?: string
}

export async function writeBrainFreshnessReport(brainDir: string, options: FreshnessOptions = {}): Promise<BrainFreshnessReport> {
  await initializeBrain(brainDir)
  const report = await evaluateBrainFreshness(brainDir, options)
  await writeBrainFreshnessArtifacts(brainDir, report, renderFreshnessReport(report))
  return report
}

export async function evaluateBrainFreshness(brainDir: string, options: FreshnessOptions = {}): Promise<BrainFreshnessReport> {
  const maxAgeDays = positiveInteger(options.maxAgeDays, DEFAULT_MAX_AGE_DAYS)
  const [sources, crawlManifest, connectorManifest] = await Promise.all([
    readBrainSources(brainDir),
    readBrainCrawlManifest(brainDir),
    readBrainConnectorManifest(brainDir)
  ])
  const sourceItems = itemsFromSources(sources, maxAgeDays)
  const connectorItems = connectorManifest.connectors
    .filter((connector) => connector.enabled)
    .map((connector) => itemFromConnector(connector, sources, maxAgeDays))
  const scanItems = latestScans(crawlManifest.scans)
    .filter((scan) => !sourceItems.some((item) => item.rootPath === scan.rootPath && item.sourceAdapter === scan.sourceAdapter))
    .map((scan) => itemFromScan(scan, maxAgeDays))
  const items = mergeItems([...sourceItems, ...connectorItems, ...scanItems])
  const staleCount = items.filter((item) => item.status === 'stale').length
  const missingCount = items.filter((item) => item.status === 'missing').length
  const status: BrainFreshnessStatus = missingCount > 0 || items.length === 0
    ? 'missing'
    : staleCount > 0 ? 'stale' : 'fresh'

  return {
    generatedAt: new Date().toISOString(),
    maxAgeDays,
    status,
    sourceCount: sources.length,
    staleCount,
    missingCount,
    items
  }
}

export async function refreshBrainSources(brainDir: string, options: RefreshOptions = {}): Promise<BrainRefreshResult> {
  await initializeBrain(brainDir)
  const [crawlManifest, connectorManifest] = await Promise.all([
    readBrainCrawlManifest(brainDir),
    readBrainConnectorManifest(brainDir)
  ])
  const scopes = refreshScopes(crawlManifest.scans, connectorManifest.connectors)
  const failures: BrainRefreshResult['failures'] = []
  let refreshedScopes = 0
  let sourcesAdded = 0
  let sourcesSkipped = 0
  let sourceCount = (await readBrainSources(brainDir)).length

  for (const scope of scopes) {
    try {
      await assertReadable(scope.rootPath)
      const crawl = await crawlBrainSources(scope.rootPath, brainDir, {
        sourceType: scope.sourceType,
        sourceAdapter: scope.sourceAdapter,
        consent: scope.consent,
        allCompanyFiles: scope.allCompanyFiles,
        maxFiles: scope.maxFiles,
        maxBytesPerFile: scope.maxBytesPerFile,
        replaceExistingForScope: true
      })
      refreshedScopes += 1
      sourcesAdded += crawl.sourcesAdded
      sourcesSkipped += crawl.sourcesSkipped
      sourceCount = crawl.sourceCount
      if (scope.connectorId) {
        await updateBrainConnectorSyncTime(brainDir, scope.connectorId, new Date().toISOString())
      }
    } catch (caught) {
      failures.push({
        rootPath: scope.rootPath,
        reason: caught instanceof Error ? caught.message : String(caught)
      })
    }
  }

  let built = false
  if (options.buildAfter && failures.length === 0) {
    await buildBrain(brainDir)
    built = true
  }

  await writeBrainFreshnessReport(brainDir)

  return {
    brainDir,
    refreshedScopes,
    failedScopes: failures.length,
    sourcesAdded,
    sourcesSkipped,
    sourceCount,
    built,
    failures
  }
}

export function renderFreshnessReport(report: BrainFreshnessReport): string {
  const itemLines = report.items.length > 0
    ? report.items.map((item) => [
        `- ${item.label}: ${item.status}`,
        `  - source: ${item.sourceType} via ${item.sourceAdapter}`,
        item.rootPath ? `  - root: ${item.rootPath}` : undefined,
        item.latestSeen ? `  - latest seen: ${item.latestSeen}` : '  - latest seen: none',
        item.ageDays !== undefined ? `  - age: ${item.ageDays} day(s)` : undefined,
        `  - recommendation: ${item.recommendation}`
      ].filter(Boolean).join('\n')).join('\n')
    : '- No tracked sources found yet.'

  return `# Freshness Report

Status: ${report.status}

Generated: ${report.generatedAt}
Max source age: ${report.maxAgeDays} day(s)

## Summary

- Sources: ${report.sourceCount}
- Stale scopes: ${report.staleCount}
- Missing scopes: ${report.missingCount}

## Tracked Source Scopes

${itemLines}
`
}

function refreshScopes(scans: BrainCrawlScan[], connectors: BrainConnector[]): RefreshScope[] {
  const scopes = new Map<string, RefreshScope>()

  for (const scan of scans.filter((candidate) => !candidate.dryRun)) {
    const scope: RefreshScope = {
      rootPath: scan.rootPath,
      sourceType: scan.sourceType,
      sourceAdapter: scan.sourceAdapter,
      consent: scan.consent,
      allCompanyFiles: scan.allCompanyFiles,
      maxFiles: scan.maxFiles,
      maxBytesPerFile: scan.maxBytesPerFile
    }
    scopes.set(scopeKey(scope.rootPath, scope.sourceType, scope.sourceAdapter), scope)
  }

  for (const connector of connectors.filter((candidate) => candidate.enabled)) {
    const scope: RefreshScope = {
      rootPath: connector.path,
      sourceType: connector.provider,
      sourceAdapter: connector.sourceAdapter,
      consent: connector.consent,
      allCompanyFiles: true,
      maxFiles: connector.maxFiles ?? 25_000,
      maxBytesPerFile: connector.maxBytesPerFile ?? 500_000,
      connectorId: connector.id
    }
    scopes.set(scopeKey(scope.rootPath, scope.sourceType, scope.sourceAdapter), scope)
  }

  return [...scopes.values()].sort((a, b) => a.rootPath.localeCompare(b.rootPath))
}

function itemsFromSources(sources: BrainSourceRecord[], maxAgeDays: number): BrainFreshnessItem[] {
  const grouped = new Map<string, BrainSourceRecord[]>()
  for (const source of sources) {
    const sourceAdapter = source.metadata.sourceAdapter ?? 'manual-ingest'
    const rootPath = source.metadata.crawl?.rootPath ?? source.path
    const key = scopeKey(rootPath, source.sourceType, sourceAdapter)
    grouped.set(key, [...(grouped.get(key) ?? []), source])
  }

  return [...grouped.entries()].map(([id, group]) => {
    const latestSeen = group
      .map((source) => source.metadata.lastModified ?? source.ingestedAt)
      .sort()
      .at(-1)
    const source = group[0]
    const ageDays = latestSeen ? ageInDays(latestSeen) : undefined
    const status = statusForAge(ageDays, maxAgeDays)
    const sourceAdapter = source?.metadata.sourceAdapter ?? 'manual-ingest'
    return {
      id,
      label: source?.metadata.crawl?.rootPath ?? source?.metadata.relativePath ?? source?.title ?? id,
      sourceType: source?.sourceType ?? 'other',
      sourceAdapter,
      rootPath: source?.metadata.crawl?.rootPath,
      latestSeen,
      ageDays,
      status,
      recommendation: recommendationForStatus(status)
    }
  })
}

function itemFromConnector(connector: BrainConnector, sources: BrainSourceRecord[], maxAgeDays: number): BrainFreshnessItem {
  const scopedSources = sources.filter((source) => source.sourceType === connector.provider
    && source.metadata.sourceAdapter === connector.sourceAdapter
    && source.metadata.crawl?.rootPath === connector.path)
  const latestSeen = scopedSources
    .map((source) => source.metadata.lastModified ?? source.ingestedAt)
    .sort()
    .at(-1) ?? connector.lastSyncedAt
  const ageDays = latestSeen ? ageInDays(latestSeen) : undefined
  const status = statusForAge(ageDays, maxAgeDays)
  return {
    id: connector.id,
    label: `${connector.provider} connector`,
    sourceType: connector.provider,
    sourceAdapter: connector.sourceAdapter,
    rootPath: connector.path,
    latestSeen,
    ageDays,
    status,
    recommendation: recommendationForStatus(status)
  }
}

function itemFromScan(scan: BrainCrawlScan, maxAgeDays: number): BrainFreshnessItem {
  const ageDays = ageInDays(scan.scannedAt)
  const status = statusForAge(ageDays, maxAgeDays)
  return {
    id: scan.scanId,
    label: scan.rootPath,
    sourceType: scan.sourceType,
    sourceAdapter: scan.sourceAdapter,
    rootPath: scan.rootPath,
    latestSeen: scan.scannedAt,
    ageDays,
    status,
    recommendation: recommendationForStatus(status)
  }
}

function latestScans(scans: BrainCrawlScan[]): BrainCrawlScan[] {
  const latest = new Map<string, BrainCrawlScan>()
  for (const scan of scans.filter((candidate) => !candidate.dryRun)) {
    latest.set(scopeKey(scan.rootPath, scan.sourceType, scan.sourceAdapter), scan)
  }
  return [...latest.values()]
}

function mergeItems(items: BrainFreshnessItem[]): BrainFreshnessItem[] {
  const merged = new Map<string, BrainFreshnessItem>()
  for (const item of items) {
    const key = scopeKey(item.rootPath ?? item.label, item.sourceType, item.sourceAdapter)
    const existing = merged.get(key)
    if (!existing || compareSeen(item.latestSeen, existing.latestSeen) >= 0) {
      merged.set(key, item)
    }
  }
  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function statusForAge(ageDays: number | undefined, maxAgeDays: number): BrainFreshnessStatus {
  if (ageDays === undefined) return 'missing'
  return ageDays > maxAgeDays ? 'stale' : 'fresh'
}

function recommendationForStatus(status: BrainFreshnessStatus): string {
  if (status === 'fresh') return 'No refresh needed under the configured max age.'
  if (status === 'stale') return 'Run brain refresh, or recrawl the source after confirming the source owner still approves access.'
  return 'Connect or crawl this source before agents rely on it.'
}

function ageInDays(timestamp: string): number {
  const elapsed = Date.now() - new Date(timestamp).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return 0
  }
  return Math.floor(elapsed / 86_400_000)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.floor(value)
}

function compareSeen(left: string | undefined, right: string | undefined): number {
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1
  return left.localeCompare(right)
}

function scopeKey(rootPath: string, sourceType: BrainSourceType, sourceAdapter: string): string {
  return `${rootPath}::${sourceType}::${sourceAdapter}`
}

async function assertReadable(path: string): Promise<void> {
  await stat(path)
}
