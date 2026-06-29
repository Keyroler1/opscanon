#!/usr/bin/env node
import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { askBrain } from './brain/ask.js'
import { buildBrain } from './brain/compiler.js'
import { connectBrainSource } from './brain/connectors.js'
import { crawlBrainSources } from './brain/crawler.js'
import { createOpsCanonDemo } from './brain/demo.js'
import { writeBrainEvalReport } from './brain/eval.js'
import { refreshBrainSources, writeBrainFreshnessReport } from './brain/freshness.js'
import { importGitHubRepository } from './brain/github.js'
import { initializeBrain } from './brain/io.js'
import { ingestBrainSource } from './brain/ingest.js'
import { renderMcpDryRun, serveBrainMcpStdio } from './brain/mcp-server.js'
import { prepareBrainKnowledge } from './brain/prepare.js'
import { writeBrainQualityReport } from './brain/quality.js'
import { approveBrainPreparedPack, createBrainReviewWorkspace } from './brain/review.js'
import type { BrainSourceType } from './brain/types.js'
import { generateAgentPack, scanDetectedMcpTargets } from './generate/pack.js'
import { synthesizeAgentReadinessNotes } from './llm/synthesis.js'
import { renderJsonReport } from './reporters/json.js'
import { renderMarkdownReport, renderMcpMarkdown } from './reporters/markdown.js'
import { scanMcpTarget } from './scanners/mcp-scanner.js'
import { scanRepository } from './scanners/repo-scanner.js'
import { calculateScorecard, reportOutputPaths } from './scoring.js'
import type { AuditReport, CliIo } from './types.js'
import { pathExists } from './utils/files.js'

const DEFAULT_IO: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env
}

interface ParsedOptions {
  flags: Map<string, string | boolean>
  positionals: string[]
}

const BRAIN_COMMANDS = new Set([
  'init',
  'ingest',
  'crawl',
  'prepare',
  'review',
  'approve',
  'connect',
  'github',
  'build',
  'score',
  'eval',
  'refresh',
  'freshness',
  'ask',
  'serve-mcp'
])

export async function runCli(args: string[], io: CliIo = DEFAULT_IO): Promise<number> {
  try {
    const [command, ...rest] = args
    if (!command || command === '--help' || command === '-h') {
      io.stdout(renderHelp())
      return 0
    }

    if (command === 'audit') {
      return await runAudit(rest, io)
    }

    if (command === 'generate') {
      return await runGenerate(rest, io)
    }

    if (command === 'check-mcp') {
      return await runCheckMcp(rest, io)
    }

    if (command === 'ci') {
      return await runCi(rest, io)
    }

    if (command === 'demo') {
      return await runDemo(rest, io)
    }

    if (command === 'repo') {
      return await runRepo(rest, io)
    }

    if (command === 'brain') {
      return await runBrain(rest, io)
    }

    if (BRAIN_COMMANDS.has(command)) {
      return await runBrain([command, ...rest], io)
    }

    io.stderr(`Unknown command: ${command}\n\n${renderHelp()}`)
    return 1
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

async function runBrain(args: string[], io: CliIo): Promise<number> {
  const [subcommand, ...rest] = args
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(renderBrainHelp())
    return 0
  }

  if (subcommand === 'init') {
    const options = parseOptions(rest)
    const brainDir = resolve(String(options.flags.get('out') ?? options.flags.get('brain') ?? 'company-brain'))
    await initializeBrain(brainDir)
    io.stdout(`Initialized company brain at ${brainDir}\n`)
    return 0
  }

  if (subcommand === 'ingest') {
    const options = parseOptions(rest)
    const sourcePath = options.positionals[0]
    if (!sourcePath) {
      throw new Error('brain ingest requires a file or directory path.')
    }

    const brainDir = resolve(String(options.flags.get('out') ?? options.flags.get('brain') ?? 'company-brain'))
    const sourceType = String(options.flags.get('source') ?? 'other')
    const result = await ingestBrainSource(resolve(sourcePath), brainDir, { sourceType: normalizeBrainSourceType(sourceType) })
    io.stdout(`Ingested ${result.sourcesAdded} source(s) into ${brainDir}; skipped ${result.sourcesSkipped}; total ${result.sourceCount}.\n`)
    return 0
  }

  if (subcommand === 'crawl') {
    const options = parseOptions(rest)
    const rootPath = options.positionals[0]
    if (!rootPath) {
      throw new Error('brain crawl requires a file or directory path.')
    }

    const brainDir = resolve(String(options.flags.get('out') ?? options.flags.get('brain') ?? 'company-brain'))
    const consent = options.flags.get('consent')
    const result = await crawlBrainSources(resolve(rootPath), brainDir, {
      sourceType: normalizeBrainSourceType(String(options.flags.get('source') ?? 'other')),
      sourceAdapter: String(options.flags.get('adapter') ?? 'local-filesystem'),
      consent: typeof consent === 'string' ? consent : undefined,
      allCompanyFiles: options.flags.has('all-company-files'),
      dryRun: options.flags.has('dry-run'),
      maxFiles: parsePositiveIntegerFlag(options.flags.get('max-files')),
      maxBytesPerFile: parsePositiveIntegerFlag(options.flags.get('max-bytes') ?? options.flags.get('max-bytes-per-file'))
    })
    io.stdout([
      `Crawled ${rootPath} into ${brainDir}`,
      `Consent: ${typeof consent === 'string' ? consent : '(missing)'}`,
      `Scan: ${result.scanId}`,
      `Eligible files: ${result.filesEligible}; skipped files: ${result.filesSkipped}`,
      `Sources added: ${result.sourcesAdded}; skipped sources: ${result.sourcesSkipped}; total ${result.sourceCount}`,
      `Redacted sources: ${result.redactedSources}`,
      options.flags.has('dry-run') ? 'Dry run: no source records or crawl manifest were written.' : 'Audit manifest: crawl-manifest.json'
    ].join('\n') + '\n')
    return 0
  }

  if (subcommand === 'prepare') {
    const options = parseOptions(rest)
    const sourcePath = options.positionals[0]
    if (!sourcePath) {
      throw new Error('brain prepare requires a raw file or directory path.')
    }

    const packDir = resolve(String(options.flags.get('out') ?? 'ai-ready-pack'))
    const ocrTextPath = typeof options.flags.get('ocr-text') === 'string' ? resolve(String(options.flags.get('ocr-text'))) : undefined
    if (ocrTextPath && !(await pathExists(ocrTextPath))) {
      throw new Error(`OCR text folder does not exist: ${ocrTextPath}`)
    }
    const result = await prepareBrainKnowledge(resolve(sourcePath), packDir, {
      sourceType: normalizeBrainSourceType(String(options.flags.get('source') ?? 'docs')),
      maxAgeDays: parsePositiveIntegerFlag(options.flags.get('max-age-days')),
      minQualityScore: parsePositiveIntegerFlag(options.flags.get('min-score')),
      maxBytesPerFile: parsePositiveIntegerFlag(options.flags.get('max-bytes') ?? options.flags.get('max-bytes-per-file')),
      ocrTextPath,
      dashboard: options.flags.has('dashboard')
    })
    io.stdout([
      `Prepared AI-ready knowledge pack at ${result.packDir}`,
      `Files: ${result.totalFiles}`,
      `Cleaned: ${result.cleanedDocuments}`,
      `Review: ${result.reviewItems}`,
      `Duplicates: ${result.duplicateItems}`,
      `Stale: ${result.staleItems}`,
      `Unreadable: ${result.unreadableItems}`,
      'Next: review human-review-queue.md, then run opscanon review <pack>, opscanon approve <pack>, and opscanon build --prepared approved-pack --out company-brain'
    ].join('\n') + '\n')
    return 0
  }

  if (subcommand === 'review') {
    const options = parseOptions(rest)
    const packPath = options.positionals[0]
    if (!packPath) {
      throw new Error('brain review requires an ai-ready pack path.')
    }

    const result = await createBrainReviewWorkspace(resolve(packPath))
    io.stdout(`Prepared review workspace at ${result.packDir}\n`)
    io.stdout(`Review decisions: ${result.decisionCount}; file: ${result.decisionsPath}\n`)
    return 0
  }

  if (subcommand === 'approve') {
    const options = parseOptions(rest)
    const packPath = options.positionals[0]
    if (!packPath) {
      throw new Error('brain approve requires an ai-ready pack path.')
    }

    const approvedPackDir = resolve(String(options.flags.get('out') ?? 'approved-pack'))
    const result = await approveBrainPreparedPack(resolve(packPath), approvedPackDir, {
      decisionsPath: typeof options.flags.get('decisions') === 'string' ? String(options.flags.get('decisions')) : undefined
    })
    io.stdout(`Approved AI-ready pack at ${result.approvedPackDir}\n`)
    io.stdout(`Approved documents: ${result.approvedDocuments}; rejected documents: ${result.rejectedDocuments}\n`)
    return 0
  }

  if (subcommand === 'connect') {
    const options = parseOptions(rest)
    const provider = options.positionals[0]
    const sourcePath = options.positionals[1]
    if (!provider || !sourcePath) {
      throw new Error('brain connect requires a provider and an export/sync folder path.')
    }

    const brainDir = resolve(String(options.flags.get('out') ?? options.flags.get('brain') ?? 'company-brain'))
    const consent = options.flags.get('consent')
    const result = await connectBrainSource(normalizeBrainSourceType(provider), resolve(sourcePath), brainDir, {
      consent: typeof consent === 'string' ? consent : undefined,
      sourceAdapter: typeof options.flags.get('adapter') === 'string' ? String(options.flags.get('adapter')) : undefined,
      mode: normalizeConnectorMode(String(options.flags.get('mode') ?? 'export-folder')),
      maxFiles: parsePositiveIntegerFlag(options.flags.get('max-files')),
      maxBytesPerFile: parsePositiveIntegerFlag(options.flags.get('max-bytes') ?? options.flags.get('max-bytes-per-file'))
    })
    io.stdout([
      `Connected ${result.connector.provider} ${result.connector.mode} source at ${result.connector.path}`,
      `Adapter: ${result.connector.sourceAdapter}`,
      `Sources added: ${result.crawl.sourcesAdded}; skipped sources: ${result.crawl.sourcesSkipped}; total ${result.crawl.sourceCount}`,
      'Connector manifest: connectors.json'
    ].join('\n') + '\n')
    return 0
  }

  if (subcommand === 'github') {
    const options = parseOptions(rest)
    const repo = options.positionals[0]
    if (!repo) {
      throw new Error('brain github requires a repository in owner/name format.')
    }

    const brainDir = resolve(String(options.flags.get('out') ?? options.flags.get('brain') ?? 'company-brain'))
    const result = await importGitHubRepository(repo, brainDir, {
      token: io.env.GITHUB_TOKEN,
      includeIssues: parsePositiveIntegerFlag(options.flags.get('issues'))
    })
    io.stdout(`Imported GitHub repository ${result.repo} into ${brainDir}\n`)
    io.stdout(`Sources added: ${result.sourcesAdded}; skipped: ${result.sourcesSkipped}; total: ${result.sourceCount}\n`)
    return 0
  }

  if (subcommand === 'build') {
    const options = parseOptions(rest)
    const brainDir = resolve(String(options.flags.get('out') ?? options.flags.get('brain') ?? 'company-brain'))
    const preparedPack = options.flags.get('prepared')
    if (typeof preparedPack === 'string') {
      const sourceType = normalizeBrainSourceType(String(options.flags.get('source') ?? 'docs'))
      const cleanedSourcesPath = await requirePreparedCleanedSources(resolve(preparedPack))
      const ingestResult = await ingestBrainSource(cleanedSourcesPath, brainDir, { sourceType })
      io.stdout(`Loaded ${ingestResult.sourcesAdded} prepared source(s) from ${cleanedSourcesPath}; skipped ${ingestResult.sourcesSkipped}.\n`)
    }
    const result = await buildBrain(brainDir)
    io.stdout(`Built company brain at ${brainDir}\n`)
    io.stdout(`Sources: ${result.sourceCount}; facts: ${result.factCount}; entities: ${result.entityCount}; relations: ${result.relationCount}; workflows: ${result.workflowCount}\n`)
    if (typeof result.qualityScore === 'number') {
      io.stdout(`Company Brain Score: ${result.qualityScore}/100\n`)
    }
    return 0
  }

  if (subcommand === 'score') {
    const options = parseOptions(rest)
    const brainDir = resolve(String(options.flags.get('brain') ?? options.flags.get('out') ?? 'company-brain'))
    const report = await writeBrainQualityReport(brainDir)
    io.stdout(`Company Brain Score: ${report.score}/100 (${report.status})\n`)
    io.stdout(`Wrote brain-quality-report.md and brain-quality-report.json in ${brainDir}\n`)
    return report.status === 'fail' ? 2 : 0
  }

  if (subcommand === 'eval') {
    const options = parseOptions(rest)
    const brainDir = resolve(String(options.flags.get('brain') ?? options.flags.get('out') ?? 'company-brain'))
    const report = await writeBrainEvalReport(brainDir)
    io.stdout(`Company brain eval: ${report.status}\n`)
    io.stdout(`Wrote brain-eval-report.md and brain-eval-report.json in ${brainDir}\n`)
    return report.status === 'fail' ? 2 : 0
  }

  if (subcommand === 'refresh') {
    const options = parseOptions(rest)
    const brainDir = resolve(String(options.flags.get('brain') ?? options.flags.get('out') ?? 'company-brain'))
    const result = await refreshBrainSources(brainDir, { buildAfter: options.flags.has('build') })
    const scopeWord = result.refreshedScopes === 1 ? 'scope' : 'scopes'
    io.stdout([
      `Refreshed ${result.refreshedScopes} company-brain source ${scopeWord} in ${brainDir}`,
      `Sources added: ${result.sourcesAdded}; skipped sources: ${result.sourcesSkipped}; total ${result.sourceCount}`,
      `Build: ${result.built ? 'yes' : 'no'}`,
      'Freshness report: freshness-report.md'
    ].join('\n') + '\n')
    if (result.failures.length > 0) {
      io.stderr(result.failures.map((failure) => `Refresh failed for ${failure.rootPath}: ${failure.reason}`).join('\n') + '\n')
      return 1
    }
    return 0
  }

  if (subcommand === 'freshness') {
    const options = parseOptions(rest)
    const brainDir = resolve(String(options.flags.get('brain') ?? options.flags.get('out') ?? 'company-brain'))
    const report = await writeBrainFreshnessReport(brainDir, {
      maxAgeDays: parsePositiveIntegerFlag(options.flags.get('max-age-days'))
    })
    io.stdout(`Company brain freshness: ${report.status}; wrote freshness-report.md and freshness-report.json in ${brainDir}\n`)
    return 0
  }

  if (subcommand === 'ask') {
    const options = parseOptions(rest)
    const question = options.positionals.join(' ').trim()
    if (!question) {
      throw new Error('brain ask requires a question.')
    }

    const brainDir = resolve(String(options.flags.get('brain') ?? options.flags.get('out') ?? 'company-brain'))
    const answer = await askBrain(brainDir, question)
    io.stdout(options.flags.has('json') ? `${JSON.stringify(answer, null, 2)}\n` : `${answer.answer}\n`)
    return 0
  }

  if (subcommand === 'serve-mcp') {
    const options = parseOptions(rest)
    const brainDir = resolve(String(options.flags.get('brain') ?? options.flags.get('out') ?? 'company-brain'))
    if (options.flags.has('dry-run')) {
      io.stdout(renderMcpDryRun(brainDir))
      return 0
    }

    await serveBrainMcpStdio(brainDir)
    return 0
  }

  io.stderr(`Unknown brain command: ${subcommand}\n\n${renderBrainHelp()}`)
  return 1
}

async function runRepo(args: string[], io: CliIo): Promise<number> {
  const [subcommand, ...rest] = args
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    io.stdout(renderRepoHelp())
    return 0
  }

  if (subcommand === 'audit') {
    return await runAudit(rest, io)
  }

  if (subcommand === 'generate') {
    return await runGenerate(rest, io)
  }

  if (subcommand === 'check-mcp') {
    return await runCheckMcp(rest, io)
  }

  io.stderr(`Unknown repo command: ${subcommand}\n\n${renderRepoHelp()}`)
  return 1
}

async function runDemo(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const outDir = resolve(String(options.flags.get('out') ?? 'opscanon-demo'))
  const result = await createOpsCanonDemo(outDir)
  io.stdout([
    `OpsCanon demo created at ${result.rootDir}`,
    `Prepared pack: ${result.preparedPackDir}`,
    `Approved pack: ${result.approvedPackDir}`,
    `Company brain: ${result.brainDir}`,
    `Cleaned documents: ${result.prepared.cleanedDocuments}; review items: ${result.prepared.reviewItems}`,
    `Workflows: ${result.build.workflowCount}; Company Brain Score: ${result.quality.score}/100 (${result.quality.status})`,
    `Eval: ${result.evalReport.status}`,
    'Open ai-ready-pack/review-dashboard.html for the static review dashboard.'
  ].join('\n') + '\n')
  return 0
}

async function runAudit(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const repoPath = resolve(options.positionals[0] ?? '.')
  const signals = await scanRepository(repoPath)
  const mcpResults = await scanDetectedMcpTargets(repoPath, signals)
  const report = calculateScorecard(signals, mcpResults)
  const llmSummary = options.flags.has('llm') ? await synthesizeAgentReadinessNotes(report, io.env) : undefined
  const markdown = appendLlmSummary(renderMarkdownReport(report, mcpResults), llmSummary)

  io.stdout(options.flags.has('json') ? renderJsonReport(report) : markdown)
  return report.overallScore >= 50 ? 0 : 2
}

async function runGenerate(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const repoPath = resolve(options.positionals[0] ?? '.')
  const outDir = resolve(String(options.flags.get('out') ?? 'opscanon-repo-pack'))
  const signals = await scanRepository(repoPath)
  const mcpResults = await scanDetectedMcpTargets(repoPath, signals)
  const report = calculateScorecard(signals, mcpResults)
  const llmSummary = options.flags.has('llm') ? await synthesizeAgentReadinessNotes(report, io.env) : undefined
  const result = await generateAgentPack(repoPath, outDir, { llmSummary })

  io.stdout(`Generated OpsCanon repo readiness pack at ${outDir}\n`)
  io.stdout(`Overall score: ${result.report.overallScore}/100\n`)
  return 0
}

async function runCheckMcp(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const target = options.positionals.join(' ')
  if (!target) {
    throw new Error('check-mcp requires a config path or command string.')
  }

  const result = await scanMcpTarget(target)
  io.stdout(options.flags.has('json') ? `${JSON.stringify(result, null, 2)}\n` : renderMcpMarkdown([result]))
  return result.riskScore >= 70 ? 2 : 0
}

async function runCi(args: string[], io: CliIo): Promise<number> {
  const options = parseOptions(args)
  const repoPath = resolve(options.positionals[0] ?? '.')
  const outDir = resolve(String(options.flags.get('out') ?? 'opscanon-artifacts'))
  const signals = await scanRepository(repoPath)
  const mcpResults = await scanDetectedMcpTargets(repoPath, signals)
  const report = calculateScorecard(signals, mcpResults)
  const llmSummary = options.flags.has('llm') ? await synthesizeAgentReadinessNotes(report, io.env) : undefined
  const markdown = appendLlmSummary(renderMarkdownReport(report, mcpResults), llmSummary)
  const outputPaths = reportOutputPaths(outDir)

  await mkdir(outDir, { recursive: true })
  await writeFile(outputPaths.markdown, markdown, 'utf8')
  await writeFile(outputPaths.json, renderJsonReport(report), 'utf8')

  if (io.env.GITHUB_STEP_SUMMARY) {
    await appendFile(io.env.GITHUB_STEP_SUMMARY, `\n${markdown}\n`, 'utf8')
  }

  if (options.flags.has('comment')) {
    await maybeCommentOnPullRequest(report, markdown, io)
  }

  io.stdout(`Wrote OpsCanon CI artifacts to ${outDir}\n`)
  return report.overallScore >= 50 ? 0 : 2
}

async function maybeCommentOnPullRequest(report: AuditReport, markdown: string, io: CliIo): Promise<void> {
  const token = io.env.GITHUB_TOKEN
  const repository = io.env.GITHUB_REPOSITORY
  const pullRequestNumber = io.env.GITHUB_REF_NAME?.match(/^(\d+)\/merge$/)?.[1] ?? io.env.OPSCANON_PR_NUMBER ?? io.env.AI_REPO_READINESS_PR_NUMBER

  if (!token || !repository || !pullRequestNumber) {
    io.stderr('Skipping PR comment because GITHUB_TOKEN, GITHUB_REPOSITORY, or PR number is missing.\n')
    return
  }

  const body = [
    `## OpsCanon repo readiness score: ${report.overallScore}/100`,
    '',
    markdown.length > 50_000 ? markdown.slice(0, 50_000) : markdown
  ].join('\n')

  const response = await fetch(`https://api.github.com/repos/${repository}/issues/${pullRequestNumber}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    },
    body: JSON.stringify({ body })
  })

  if (!response.ok) {
    io.stderr(`Skipping PR comment because GitHub returned HTTP ${response.status}.\n`)
  }
}

function parseOptions(args: string[]): ParsedOptions {
  const flags = new Map<string, string | boolean>()
  const positionals: string[] = []
  const valueFlags = new Set(['out', 'source', 'brain', 'consent', 'adapter', 'mode', 'max-files', 'max-bytes', 'max-bytes-per-file', 'max-age-days', 'min-score', 'prepared', 'ocr-text', 'decisions', 'issues'])

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    if (inlineValue !== undefined) {
      flags.set(rawName, inlineValue)
      continue
    }

    const next = args[index + 1]
    if (next && !next.startsWith('--') && valueFlags.has(rawName)) {
      flags.set(rawName, next)
      index += 1
    } else {
      flags.set(rawName, true)
    }
  }

  return { flags, positionals }
}

async function requirePreparedCleanedSources(preparedPackDir: string): Promise<string> {
  const cleanedSourcesPath = resolve(preparedPackDir, 'cleaned-sources')
  if (!(await pathExists(cleanedSourcesPath))) {
    throw new Error(`Prepared pack has no cleaned sources at ${cleanedSourcesPath}. Run opscanon prepare/review/approve first, or point --prepared at a valid ai-ready pack.`)
  }

  if (!(await hasAnyFile(cleanedSourcesPath))) {
    throw new Error(`Prepared pack has no cleaned sources at ${cleanedSourcesPath}. Approve source material or lower the prepare threshold before building.`)
  }

  return cleanedSourcesPath
}

async function hasAnyFile(path: string): Promise<boolean> {
  const entries = await readdir(path, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile()) {
      return true
    }

    if (entry.isDirectory() && await hasAnyFile(join(path, entry.name))) {
      return true
    }
  }

  return false
}

function normalizeConnectorMode(value: string): 'export-folder' | 'sync-folder' {
  return value === 'sync-folder' ? 'sync-folder' : 'export-folder'
}

function normalizeBrainSourceType(value: string): BrainSourceType {
  const allowed: BrainSourceType[] = [
    'repo',
    'docs',
    'wiki',
    'notion',
    'confluence',
    'drive',
    'sharepoint',
    'github',
    'linear',
    'jira',
    'tickets',
    'transcripts',
    'notes',
    'slack',
    'support',
    'crm',
    'other'
  ]
  return allowed.includes(value as BrainSourceType) ? value as BrainSourceType : 'other'
}

function parsePositiveIntegerFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function renderHelp(): string {
  return `OpsCanon

Turn messy company knowledge into verified agent skills.

OpsCanon cleans fragmented docs, routes uncertainty to humans, and compiles approved operating knowledge into source-cited skills and MCP-ready company brains.

Usage:
  opscanon prepare ./raw-company-export --out ai-ready-pack --ocr-text ./ocr-output --dashboard
  opscanon review ai-ready-pack
  opscanon approve ai-ready-pack --out approved-pack
  opscanon build --prepared approved-pack --out company-brain
  opscanon score --brain company-brain
  opscanon eval --brain company-brain
  opscanon serve-mcp --brain company-brain
  opscanon demo --out opscanon-demo
  opscanon repo audit <path> [--json]
  opscanon repo generate <path> --out opscanon-repo-pack [--llm]
  opscanon repo check-mcp <command-or-config> [--json]
  opscanon ci [path] [--out opscanon-artifacts] [--comment] [--llm]

Notes:
  Company-brain commands are first class; the legacy "brain" namespace still works.
  Repo readiness is still available under "opscanon repo".
  demo creates a complete local sample with raw docs, ai-ready pack, approved pack, dashboard, brain, eval, and MCP dry run.
  ci writes opscanon-report.md and opscanon-report.json.
  --llm uses OPENAI_API_KEY when present; it is never required.
`
}

function renderRepoHelp(): string {
  return `OpsCanon Repo Readiness

Usage:
  opscanon repo audit <path> [--json]
  opscanon repo generate <path> --out opscanon-repo-pack [--llm]
  opscanon repo check-mcp <command-or-config> [--json]

Notes:
  repo audit is read-only and prints to stdout.
  repo generate writes only to the selected output folder.
  repo check-mcp scans MCP command/config surfaces for risky auth, vague schemas, and missing boundaries.
`
}

function renderBrainHelp(): string {
  return `OpsCanon Company Brain

Usage:
  opscanon init [--out company-brain]
  opscanon ingest <path> [--source docs|repo|notion|confluence|drive|sharepoint|github|linear|jira|slack|crm|other] [--out company-brain]
  opscanon crawl <path> --consent "approved-by-owner" [--source docs|notion|confluence|drive|github|linear|jira|other] [--out company-brain]
  opscanon prepare <raw-path> [--source docs|tickets|slack|crm|other] [--out ai-ready-pack] [--min-score 70] [--max-age-days 730] [--ocr-text ocr-output] [--dashboard]
  opscanon review <ai-ready-pack>
  opscanon approve <ai-ready-pack> [--decisions review-decisions.json] [--out approved-pack]
  opscanon connect <provider> <export-or-sync-folder> --consent "approved-by-owner" [--mode export-folder|sync-folder] [--out company-brain]
  opscanon github <owner/repo> [--issues 10] [--out company-brain]
  opscanon refresh [--brain company-brain] [--build]
  opscanon freshness [--brain company-brain] [--max-age-days 30]
  opscanon build [--prepared ai-ready-pack] [--out company-brain]
  opscanon score [--brain company-brain]
  opscanon eval [--brain company-brain]
  opscanon ask <question> [--brain company-brain] [--json]
  opscanon serve-mcp [--brain company-brain] [--dry-run]

Notes:
  ingest reads local text files, redacts likely secrets, and stores source records.
  crawl recursively scans company-approved files, redacts secrets, and writes crawl-manifest.json.
  prepare turns messy folders into an AI-ready pack with quality reports, dashboard, OCR queue, review decisions, and cleaned sources.
  review creates or refreshes the structured human review workspace.
  approve applies human decisions and writes an approved pack for build.
  connect registers an exported or synced tool folder for later refresh without storing SaaS tokens.
  github imports public or token-authenticated GitHub repo metadata, README, and optional issues without storing tokens.
  refresh re-runs approved crawl/connector scopes and replaces stale records for those scopes.
  freshness writes freshness-report.md and freshness-report.json.
  build writes company-profile.md, operating-model.md/json, workflows, skills, facts.jsonl, graph.json, and brain quality reports.
  score reruns the company brain quality score.
  eval verifies citations, redaction, approval boundaries, unknown handling, and skill contracts.
  serve-mcp exposes read-only company-brain tools over stdio.
  Legacy compatibility still works: ai-repo-readiness brain <command> and company-brain <command>.
`
}

function appendLlmSummary(markdown: string, llmSummary: string | undefined): string {
  if (!llmSummary) {
    return markdown
  }

  return `${markdown}
## Optional LLM Synthesis

${llmSummary}
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rawArgs = process.argv.slice(2)
  const invokedAs = basename(process.argv[1])
  const args = invokedAs.includes('company-brain') && rawArgs[0] !== 'brain'
    ? ['brain', ...rawArgs]
    : rawArgs
  const exitCode = await runCli(args)
  process.exitCode = exitCode
}
