import { basename, dirname } from 'node:path'
import type { Finding, RepoSignals } from '../types.js'
import { findSecretAssignments } from '../utils/redaction.js'
import { isTextFile, readTextFile, uniqueSorted, walkFiles } from '../utils/files.js'

interface PackageJson {
  bin?: string | Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const DOCUMENTATION_FILE_PATTERN = /(^|\/)(readme|docs?|guide|quickstart|contributing|agents|claude|runbook)[^/]*\.(md|mdx|txt)$/i
const OPENAPI_FILE_PATTERN = /(^|\/)(openapi|swagger)\.(ya?ml|json)$/i
const MCP_FILE_PATTERN = /(^|\/).*mcp.*\.(json|toml|ya?ml|md)$/i

export async function scanRepository(rootPath: string): Promise<RepoSignals> {
  const files = await walkFiles(rootPath)
  const textCache = new Map<string, string>()
  const findings: Finding[] = []
  const secretFindings: Finding[] = []

  async function readCached(relativePath: string, absolutePath: string): Promise<string> {
    if (!textCache.has(relativePath)) {
      textCache.set(relativePath, isTextFile(relativePath) ? await readTextFile(absolutePath) : '')
    }
    return textCache.get(relativePath) ?? ''
  }

  const docsFiles = files.filter((file) => DOCUMENTATION_FILE_PATTERN.test(file.relativePath)).map((file) => file.relativePath)
  const readme = files.find((file) => /^readme\.(md|mdx|txt)$/i.test(file.name))
  const agentsFile = files.find((file) => /(^|\/)(AGENTS|CLAUDE)\.md$/i.test(file.relativePath))
  const ciFiles = files
    .filter((file) => file.relativePath.startsWith('.github/workflows/') || file.relativePath === '.gitlab-ci.yml')
    .map((file) => file.relativePath)
  const openApiFiles = files.filter((file) => OPENAPI_FILE_PATTERN.test(file.relativePath)).map((file) => file.relativePath)
  const mcpConfigFiles = files.filter((file) => MCP_FILE_PATTERN.test(file.relativePath)).map((file) => file.relativePath)
  const envExampleFiles = files
    .filter((file) => /^\.env\.(example|sample)$/i.test(file.name) || /\.(env\.example|env\.sample)$/i.test(file.relativePath))
    .map((file) => file.relativePath)

  const packageFiles = files.filter((file) => file.name === 'package.json')
  const packageJsons = await Promise.all(packageFiles.map((file) => readPackageJson(file.relativePath, file.absolutePath)))
  const pyprojectFiles = files.filter((file) => file.name === 'pyproject.toml')
  const requirementsFiles = files.filter((file) => /^requirements.*\.txt$/i.test(file.name))
  const manifests = uniqueSorted([
    ...packageFiles.map((file) => file.relativePath),
    ...pyprojectFiles.map((file) => file.relativePath),
    ...requirementsFiles.map((file) => file.relativePath),
    ...files.filter((file) => file.name === 'Cargo.toml' || file.name === 'go.mod').map((file) => file.relativePath)
  ])

  const docsContent = await readRelevantDocs(files, readCached)
  const packageScripts = packageJsons.flatMap((entry) => Object.entries(entry.packageJson?.scripts ?? {}))
  const testCommands = uniqueSorted([
    ...packageScripts.filter(([name]) => /test|spec/i.test(name)).map(([, command]) => command),
    ...(await detectPythonTestCommands(requirementsFiles, pyprojectFiles, readCached, docsContent))
  ])
  const buildCommands = uniqueSorted(packageScripts.filter(([name]) => /build|compile/i.test(name)).map(([, command]) => command))
  const lintCommands = uniqueSorted(packageScripts.filter(([name]) => /lint|format/i.test(name)).map(([, command]) => command))
  const cliEntrypoints = uniqueSorted([
    ...packageJsons.flatMap((entry) => packageBins(entry.packageJson, entry.relativePath)),
    ...(await detectPythonScripts(pyprojectFiles, readCached)),
    ...(docsContent.match(/\b[a-z0-9][a-z0-9._-]+\s+--json\b/gi) ?? [])
  ])
  const hasMcpDependency = packageJsons.some((entry) => packageHasMcp(entry.packageJson)) || docsContent.toLowerCase().includes('model context protocol')

  for (const file of files) {
    if (!isTextFile(file.relativePath)) {
      continue
    }

    const content = await readCached(file.relativePath, file.absolutePath)
    for (const secret of findSecretAssignments(content)) {
      const finding: Finding = {
        code: 'secret.possible-hardcoded',
        title: 'Possible hardcoded secret',
        severity: 'high',
        message: `Potential secret assignment for "${secret.key}" found. The value was redacted from this report.`,
        path: file.relativePath,
        recommendation: 'Move secrets into environment variables or a secret manager and keep only placeholders in examples.'
      }
      secretFindings.push(finding)
      findings.push(finding)
    }
  }

  const hasSetupDocs = /setup|install|installation|getting started|quickstart/i.test(docsContent)
  const hasUsageDocs = /usage|example|cli|api|--json|curl|run/i.test(docsContent)
  const hasAgentDocs = Boolean(agentsFile) || /agent|codex|claude|mcp|machine-readable/i.test(docsContent)
  const hasApiDocs = openApiFiles.length > 0 || /api reference|endpoint|openapi|swagger/i.test(docsContent)
  const languages = detectLanguages(files, packageFiles, pyprojectFiles, requirementsFiles)

  addMissingFinding(findings, Boolean(readme), 'docs.missing-readme', 'Missing README', 'Add a README with setup, usage, and troubleshooting steps.')
  addMissingFinding(findings, hasSetupDocs, 'docs.missing-setup', 'Missing setup instructions', 'Document exact install and first-run commands.')
  addMissingFinding(findings, hasUsageDocs, 'docs.missing-usage', 'Missing usage examples', 'Add copy-pasteable human and machine-readable usage examples.')
  addMissingFinding(findings, hasAgentDocs, 'docs.missing-agent-instructions', 'Missing agent instructions', 'Add AGENTS.md or equivalent operating guidance for AI coding agents.')
  addMissingFinding(findings, cliEntrypoints.length > 0 || hasApiDocs || hasMcpDependency, 'interfaces.missing-machine-surface', 'Missing machine interface', 'Expose a CLI, API, OpenAPI spec, or MCP server that agents can use directly.')
  addMissingFinding(findings, testCommands.length > 0, 'evals.missing-tests', 'Missing test command', 'Add a documented test command agents can run before and after changes.')
  addMissingFinding(findings, ciFiles.length > 0, 'evals.missing-ci', 'Missing CI workflow', 'Add CI that runs test and build checks on pull requests.')
  addMissingFinding(findings, envExampleFiles.length > 0, 'security.missing-env-example', 'Missing env example', 'Add .env.example with placeholder names and no secret values.')
  if (hasMcpDependency && mcpConfigFiles.length === 0) {
    findings.push({
      code: 'mcp.missing-config',
      title: 'MCP dependency without reviewable config',
      severity: 'low',
      message: 'The repo depends on MCP packages but no MCP config file was detected.',
      recommendation: 'Add an example MCP config so agents and reviewers can inspect startup commands, env vars, and permissions.'
    })
  }

  return {
    rootPath,
    repoName: basename(rootPath),
    filesScanned: files.length,
    languages,
    manifests,
    docsFiles: uniqueSorted(docsFiles),
    hasReadme: Boolean(readme),
    hasAgentInstructions: Boolean(agentsFile),
    hasSetupDocs,
    hasUsageDocs,
    hasAgentDocs,
    hasCi: ciFiles.length > 0,
    ciFiles: uniqueSorted(ciFiles),
    testCommands,
    buildCommands,
    lintCommands,
    hasCli: cliEntrypoints.length > 0,
    cliEntrypoints,
    hasOpenApi: openApiFiles.length > 0,
    openApiFiles: uniqueSorted(openApiFiles),
    hasApiDocs,
    hasMcpDependency,
    mcpConfigFiles: uniqueSorted(mcpConfigFiles),
    envExampleFiles: uniqueSorted(envExampleFiles),
    secretFindings,
    findings
  }
}

async function readPackageJson(relativePath: string, absolutePath: string): Promise<{ relativePath: string; packageJson?: PackageJson }> {
  try {
    return { relativePath, packageJson: JSON.parse(await readTextFile(absolutePath)) as PackageJson }
  } catch {
    return { relativePath }
  }
}

async function readRelevantDocs(
  files: Array<{ relativePath: string; absolutePath: string }>,
  readCached: (relativePath: string, absolutePath: string) => Promise<string>
): Promise<string> {
  const docs = files.filter((file) => DOCUMENTATION_FILE_PATTERN.test(file.relativePath) || /^readme\./i.test(file.relativePath))
  const content = await Promise.all(docs.map((file) => readCached(file.relativePath, file.absolutePath)))
  return content.join('\n')
}

function packageBins(packageJson: PackageJson | undefined, relativePath: string): string[] {
  if (!packageJson?.bin) {
    return []
  }

  if (typeof packageJson.bin === 'string') {
    return [`${dirname(relativePath)}:${packageJson.bin}`]
  }

  return Object.keys(packageJson.bin)
}

function packageHasMcp(packageJson: PackageJson | undefined): boolean {
  const dependencyNames = Object.keys({
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  })

  return dependencyNames.some((name) => name.includes('modelcontextprotocol') || name.includes('mcp'))
}

async function detectPythonScripts(
  pyprojectFiles: Array<{ relativePath: string; absolutePath: string }>,
  readCached: (relativePath: string, absolutePath: string) => Promise<string>
): Promise<string[]> {
  const scripts: string[] = []
  for (const file of pyprojectFiles) {
    const content = await readCached(file.relativePath, file.absolutePath)
    const projectScriptsBlock = content.split(/\n(?=\[)/).find((block) => block.startsWith('[project.scripts]'))
    if (!projectScriptsBlock) {
      continue
    }

    for (const line of projectScriptsBlock.split('\n').slice(1)) {
      const match = line.match(/^([A-Za-z0-9_.-]+)\s*=/)
      if (match) {
        scripts.push(match[1])
      }
    }
  }

  return scripts
}

async function detectPythonTestCommands(
  requirementsFiles: Array<{ relativePath: string; absolutePath: string }>,
  pyprojectFiles: Array<{ relativePath: string; absolutePath: string }>,
  readCached: (relativePath: string, absolutePath: string) => Promise<string>,
  docsContent: string
): Promise<string[]> {
  const commands: string[] = []
  const requirements = await Promise.all(requirementsFiles.map((file) => readCached(file.relativePath, file.absolutePath)))
  const pyprojects = await Promise.all(pyprojectFiles.map((file) => readCached(file.relativePath, file.absolutePath)))
  const combined = [...requirements, ...pyprojects, docsContent].join('\n')

  if (/pytest/i.test(combined)) {
    commands.push('pytest')
  }

  if (/unittest/i.test(combined)) {
    commands.push('python -m unittest')
  }

  return commands
}

function detectLanguages(
  files: Array<{ relativePath: string }>,
  packageFiles: Array<unknown>,
  pyprojectFiles: Array<unknown>,
  requirementsFiles: Array<unknown>
): string[] {
  const languages = new Set<string>()
  if (packageFiles.length > 0 || files.some((file) => /\.(mjs|cjs|js|jsx)$/i.test(file.relativePath))) {
    languages.add('javascript')
  }
  if (files.some((file) => /\.(ts|tsx)$/i.test(file.relativePath))) {
    languages.add('typescript')
  }
  if (pyprojectFiles.length > 0 || requirementsFiles.length > 0 || files.some((file) => /\.py$/i.test(file.relativePath))) {
    languages.add('python')
  }
  if (files.some((file) => file.relativePath.endsWith('go.mod') || /\.go$/i.test(file.relativePath))) {
    languages.add('go')
  }
  if (files.some((file) => file.relativePath.endsWith('Cargo.toml') || /\.rs$/i.test(file.relativePath))) {
    languages.add('rust')
  }

  return [...languages].sort((a, b) => a.localeCompare(b))
}

function addMissingFinding(
  findings: Finding[],
  condition: boolean,
  code: string,
  title: string,
  recommendation: string
): void {
  if (condition) {
    return
  }

  findings.push({
    code,
    title,
    severity: 'medium',
    message: recommendation,
    recommendation
  })
}
