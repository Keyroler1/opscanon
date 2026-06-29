import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { crawlBrainSources } from './crawler.js'
import { hash } from './ingest.js'
import {
  initializeBrain,
  readBrainConnectorManifest,
  writeBrainConnectorManifest
} from './io.js'
import type {
  BrainConnectResult,
  BrainConnector,
  BrainConnectorManifest,
  BrainConnectorMode,
  BrainSourceType
} from './types.js'

export interface BrainConnectOptions {
  consent?: string
  mode?: BrainConnectorMode
  sourceAdapter?: string
  maxFiles?: number
  maxBytesPerFile?: number
}

export async function connectBrainSource(
  provider: BrainSourceType,
  sourcePath: string,
  brainDir: string,
  options: BrainConnectOptions = {}
): Promise<BrainConnectResult> {
  const consent = options.consent?.trim()
  if (!consent) {
    throw new Error('brain connect requires --consent so connected company exports are explicit and auditable.')
  }

  const absolutePath = resolve(sourcePath)
  await assertReadablePath(absolutePath)
  await initializeBrain(brainDir)

  const sourceAdapter = options.sourceAdapter ?? `${provider}-export`
  const mode = options.mode ?? 'export-folder'
  const now = new Date().toISOString()
  const id = connectorId(provider, absolutePath, sourceAdapter)
  const existing = (await readBrainConnectorManifest(brainDir)).connectors.find((connector) => connector.id === id)
  const connector: BrainConnector = {
    id,
    provider,
    mode,
    path: absolutePath,
    sourceAdapter,
    consent,
    enabled: true,
    registeredAt: existing?.registeredAt ?? now,
    lastSyncedAt: now,
    maxFiles: options.maxFiles,
    maxBytesPerFile: options.maxBytesPerFile
  }

  const crawl = await crawlBrainSources(absolutePath, brainDir, {
    sourceType: provider,
    sourceAdapter,
    consent,
    allCompanyFiles: true,
    maxFiles: options.maxFiles,
    maxBytesPerFile: options.maxBytesPerFile,
    replaceExistingForScope: true
  })

  await upsertBrainConnector(brainDir, connector)

  return { connector, crawl }
}

export async function updateBrainConnectorSyncTime(brainDir: string, connectorIdToUpdate: string, syncedAt: string): Promise<void> {
  const manifest = await readBrainConnectorManifest(brainDir)
  await writeBrainConnectorManifest(brainDir, {
    version: 1,
    connectors: manifest.connectors.map((connector) => connector.id === connectorIdToUpdate
      ? { ...connector, lastSyncedAt: syncedAt }
      : connector)
  })
}

export function connectorId(provider: BrainSourceType, absolutePath: string, sourceAdapter: string): string {
  return `connector_${hash(`${provider}:${absolutePath}:${sourceAdapter}`).slice(0, 16)}`
}

async function upsertBrainConnector(brainDir: string, connector: BrainConnector): Promise<void> {
  const manifest = await readBrainConnectorManifest(brainDir)
  await writeBrainConnectorManifest(brainDir, upsertConnector(manifest, connector))
}

function upsertConnector(manifest: BrainConnectorManifest, connector: BrainConnector): BrainConnectorManifest {
  const connectors = manifest.connectors.filter((candidate) => candidate.id !== connector.id)
  return {
    version: 1,
    connectors: [...connectors, connector].sort((a, b) => a.provider.localeCompare(b.provider) || a.path.localeCompare(b.path))
  }
}

async function assertReadablePath(path: string): Promise<void> {
  const pathStat = await stat(path)
  if (!pathStat.isDirectory() && !pathStat.isFile()) {
    throw new Error(`Connected source path is neither a file nor directory: ${path}`)
  }
}
