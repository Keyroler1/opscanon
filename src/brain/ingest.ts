import { createHash } from 'node:crypto'
import { basename, relative, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { isTextFile, readTextFile, walkFiles } from '../utils/files.js'
import { redactSecrets } from '../utils/redaction.js'
import { initializeBrain, readBrainSources, writeBrainSources } from './io.js'
import type { BrainIngestResult, BrainSourceRecord, BrainSourceType } from './types.js'

export interface BrainIngestOptions {
  sourceType?: BrainSourceType
}

export async function ingestBrainSource(sourcePath: string, brainDir: string, options: BrainIngestOptions = {}): Promise<BrainIngestResult> {
  await initializeBrain(brainDir)

  const absoluteSourcePath = resolve(sourcePath)
  const sourceStat = await stat(absoluteSourcePath)
  const files = sourceStat.isDirectory()
    ? (await walkFiles(absoluteSourcePath)).filter((file) => isTextFile(file.absolutePath))
    : [{
        absolutePath: absoluteSourcePath,
        relativePath: basename(absoluteSourcePath),
        name: basename(absoluteSourcePath)
      }]

  const existing = await readBrainSources(brainDir)
  const existingIds = new Set(existing.map((source) => source.id))
  const nextSources: BrainSourceRecord[] = [...existing]
  let sourcesAdded = 0
  let sourcesSkipped = 0

  for (const file of files) {
    const rawContent = await readTextFile(file.absolutePath, 500_000)
    if (!rawContent.trim()) {
      sourcesSkipped += 1
      continue
    }

    const content = redactSecrets(rawContent)
    const fileStat = await stat(file.absolutePath)
    const contentHash = hash(content)
    const relativePath = sourceStat.isDirectory()
      ? relative(absoluteSourcePath, file.absolutePath).replaceAll('\\', '/')
      : file.relativePath
    const id = `src_${hash(`${options.sourceType ?? 'other'}:${relativePath}:${contentHash}`).slice(0, 16)}`

    if (existingIds.has(id)) {
      sourcesSkipped += 1
      continue
    }

    const record: BrainSourceRecord = {
      id,
      sourceType: options.sourceType ?? 'other',
      title: inferTitle(content, file.name),
      path: file.absolutePath,
      content,
      contentHash,
      ingestedAt: new Date().toISOString(),
      redacted: content !== rawContent,
      metadata: {
        relativePath,
        bytes: Buffer.byteLength(content, 'utf8'),
        lastModified: fileStat.mtime.toISOString()
      }
    }
    nextSources.push(record)
    existingIds.add(id)
    sourcesAdded += 1
  }

  await writeBrainSources(brainDir, nextSources)

  return {
    brainDir,
    sourcesAdded,
    sourcesSkipped,
    sourceCount: nextSources.length
  }
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

export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
