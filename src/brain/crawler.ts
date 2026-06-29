import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { isTextFile, readTextFile } from '../utils/files.js'
import { redactSecrets } from '../utils/redaction.js'
import { hash } from './ingest.js'
import { initializeBrain, readBrainCrawlManifest, readBrainSources, writeBrainCrawlManifest, writeBrainSources } from './io.js'
import type {
  BrainCrawlResult,
  BrainCrawlScan,
  BrainCrawlSkipReason,
  BrainSourceRecord,
  BrainSourceType
} from './types.js'

const DEFAULT_MAX_FILES = 25_000
const DEFAULT_MAX_BYTES_PER_FILE = 500_000
const MAX_SKIP_SAMPLES = 100

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  'target',
  'vendor',
  '.venv',
  '__pycache__',
  '.terraform',
  '.turbo'
])

interface CrawlFile {
  absolutePath: string
  relativePath: string
  name: string
  bytes: number
  lastModified: string
}

interface CrawlSkip {
  path: string
  reason: BrainCrawlSkipReason
}

export interface BrainCrawlerOptions {
  sourceType?: BrainSourceType
  sourceAdapter?: string
  consent?: string
  allCompanyFiles?: boolean
  dryRun?: boolean
  maxFiles?: number
  maxBytesPerFile?: number
  replaceExistingForScope?: boolean
}

export async function crawlBrainSources(rootPath: string, brainDir: string, options: BrainCrawlerOptions = {}): Promise<BrainCrawlResult> {
  const consent = options.consent?.trim()
  if (!consent) {
    throw new Error('brain crawl requires --consent so broad company-file access is explicit and auditable.')
  }

  const absoluteRootPath = resolve(rootPath)
  const maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES)
  const maxBytesPerFile = positiveInteger(options.maxBytesPerFile, DEFAULT_MAX_BYTES_PER_FILE)
  const sourceType = options.sourceType ?? 'other'
  const sourceAdapter = options.sourceAdapter ?? 'local-filesystem'
  const scannedAt = new Date().toISOString()
  const scanId = `crawl_${hash(`${absoluteRootPath}:${consent}:${scannedAt}`).slice(0, 16)}`
  const skipped: CrawlSkip[] = []
  const eligibleFiles = await discoverEligibleFiles(absoluteRootPath, { maxFiles, maxBytesPerFile, skipped })

  if (options.dryRun) {
    return resultFromScan(brainDir, {
      scanId,
      rootPath: absoluteRootPath,
      sourceType,
      sourceAdapter,
      consent,
      mode: 'local-filesystem',
      allCompanyFiles: Boolean(options.allCompanyFiles),
      dryRun: true,
      scannedAt,
      maxFiles,
      maxBytesPerFile,
      filesDiscovered: eligibleFiles.filesDiscovered,
      filesEligible: eligibleFiles.files.length,
      filesSkipped: skipped.length,
      sourcesAdded: 0,
      sourcesSkipped: 0,
      sourceCount: 0,
      redactedSources: 0,
      skippedByReason: skippedByReason(skipped),
      skippedSamples: skipped.slice(0, MAX_SKIP_SAMPLES)
    })
  }

  await initializeBrain(brainDir)
  const existing = await readBrainSources(brainDir)
  const scopedExisting = options.replaceExistingForScope
    ? existing.filter((source) => !sourceMatchesCrawlScope(source, { rootPath: absoluteRootPath, sourceType, sourceAdapter }))
    : existing
  const existingIds = new Set(scopedExisting.map((source) => source.id))
  const nextSources: BrainSourceRecord[] = [...scopedExisting]
  let sourcesAdded = 0
  let sourcesSkipped = 0
  let redactedSources = 0

  for (const file of eligibleFiles.files) {
    try {
      const rawContent = await readTextFile(file.absolutePath, maxBytesPerFile)
      if (!rawContent.trim()) {
        skipped.push({ path: file.relativePath, reason: 'empty' })
        sourcesSkipped += 1
        continue
      }

      const content = redactSecrets(rawContent)
      const contentHash = hash(content)
      const id = `src_${hash(`${sourceAdapter}:${sourceType}:${file.relativePath}:${contentHash}`).slice(0, 16)}`
      if (existingIds.has(id)) {
        skipped.push({ path: file.relativePath, reason: 'duplicate' })
        sourcesSkipped += 1
        continue
      }

      const record: BrainSourceRecord = {
        id,
        sourceType,
        title: inferTitle(content, file.name),
        path: file.absolutePath,
        content,
        contentHash,
        ingestedAt: scannedAt,
        redacted: content !== rawContent,
        metadata: {
          relativePath: file.relativePath,
          bytes: Buffer.byteLength(content, 'utf8'),
          lastModified: file.lastModified,
          sourceAdapter,
          crawl: {
            scanId,
            rootPath: absoluteRootPath,
            consent,
            mode: 'local-filesystem',
            allCompanyFiles: Boolean(options.allCompanyFiles),
            crawledAt: scannedAt
          }
        }
      }

      nextSources.push(record)
      existingIds.add(id)
      sourcesAdded += 1
      if (record.redacted) {
        redactedSources += 1
      }
    } catch {
      skipped.push({ path: file.relativePath, reason: 'read-error' })
      sourcesSkipped += 1
    }
  }

  await writeBrainSources(brainDir, nextSources)
  const scan: BrainCrawlScan = {
    scanId,
    rootPath: absoluteRootPath,
    sourceType,
    sourceAdapter,
    consent,
    mode: 'local-filesystem',
    allCompanyFiles: Boolean(options.allCompanyFiles),
    dryRun: false,
    scannedAt,
    maxFiles,
    maxBytesPerFile,
    filesDiscovered: eligibleFiles.filesDiscovered,
    filesEligible: eligibleFiles.files.length,
    filesSkipped: skipped.length,
    sourcesAdded,
    sourcesSkipped,
    sourceCount: nextSources.length,
    redactedSources,
    skippedByReason: skippedByReason(skipped),
    skippedSamples: skipped.slice(0, MAX_SKIP_SAMPLES)
  }
  const manifest = await readBrainCrawlManifest(brainDir)
  await writeBrainCrawlManifest(brainDir, {
    version: 1,
    scans: [...manifest.scans, scan]
  })

  return resultFromScan(brainDir, scan)
}

async function discoverEligibleFiles(rootPath: string, options: {
  maxFiles: number
  maxBytesPerFile: number
  skipped: CrawlSkip[]
}): Promise<{ files: CrawlFile[]; filesDiscovered: number }> {
  const rootStat = await stat(rootPath)
  const files: CrawlFile[] = []
  let filesDiscovered = 0

  async function considerFile(absolutePath: string, rootForRelativePath: string): Promise<void> {
    const relativePath = relative(rootForRelativePath, absolutePath).replaceAll('\\', '/') || basename(absolutePath)
    filesDiscovered += 1

    if (files.length >= options.maxFiles) {
      options.skipped.push({ path: relativePath, reason: 'file-limit' })
      return
    }

    if (!isTextFile(absolutePath)) {
      options.skipped.push({ path: relativePath, reason: 'unsupported-type' })
      return
    }

    const fileStat = await stat(absolutePath)
    if (fileStat.size > options.maxBytesPerFile) {
      options.skipped.push({ path: relativePath, reason: 'too-large' })
      return
    }

    files.push({
      absolutePath,
      relativePath,
      name: basename(absolutePath),
      bytes: fileStat.size,
      lastModified: fileStat.mtime.toISOString()
    })
  }

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name)
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          options.skipped.push({
            path: relative(rootPath, absolutePath).replaceAll('\\', '/'),
            reason: 'ignored-directory'
          })
          continue
        }
        await walk(absolutePath)
        continue
      }

      if (entry.isFile()) {
        await considerFile(absolutePath, rootPath)
      }
    }
  }

  if (rootStat.isDirectory()) {
    await walk(rootPath)
  } else if (rootStat.isFile()) {
    await considerFile(rootPath, rootPath)
  }

  return {
    files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    filesDiscovered
  }
}

function resultFromScan(brainDir: string, scan: BrainCrawlScan): BrainCrawlResult {
  return {
    brainDir,
    scanId: scan.scanId,
    sourcesAdded: scan.sourcesAdded,
    sourcesSkipped: scan.sourcesSkipped,
    sourceCount: scan.sourceCount,
    filesDiscovered: scan.filesDiscovered,
    filesEligible: scan.filesEligible,
    filesSkipped: scan.filesSkipped,
    redactedSources: scan.redactedSources,
    skippedByReason: scan.skippedByReason
  }
}

function sourceMatchesCrawlScope(source: BrainSourceRecord, scope: {
  rootPath: string
  sourceType: BrainSourceType
  sourceAdapter: string
}): boolean {
  return source.sourceType === scope.sourceType
    && source.metadata.sourceAdapter === scope.sourceAdapter
    && source.metadata.crawl?.rootPath === scope.rootPath
}

function skippedByReason(skipped: CrawlSkip[]): Partial<Record<BrainCrawlSkipReason, number>> {
  const counts: Partial<Record<BrainCrawlSkipReason, number>> = {}
  for (const item of skipped) {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1
  }
  return counts
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.floor(value)
}

function inferTitle(content: string, fallbackName: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\uFEFF/, '').trim())
    .find((line) => /^#\s+/.test(line))
  if (heading) {
    return heading.replace(/^#\s+/, '').trim()
  }

  return fallbackName
}
