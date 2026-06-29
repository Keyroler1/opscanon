import { initializeBrain, readBrainSources, writeBrainSources } from './io.js'
import { hash } from './ingest.js'
import type { BrainSourceRecord } from './types.js'

export interface BrainGitHubImportOptions {
  token?: string
  includeIssues?: number
  fetchImpl?: typeof fetch
}

export interface BrainGitHubImportResult {
  brainDir: string
  repo: string
  sourcesAdded: number
  sourcesSkipped: number
  sourceCount: number
}

interface GitHubRepoResponse {
  full_name: string
  description?: string
  html_url: string
  default_branch?: string
  language?: string
  topics?: string[]
}

interface GitHubReadmeResponse {
  name: string
  path: string
  html_url?: string
  content: string
  encoding: string
}

interface GitHubIssueResponse {
  number: number
  title: string
  state: string
  html_url: string
  body?: string
  user?: { login: string }
  labels?: Array<{ name: string }>
}

export async function importGitHubRepository(repo: string, brainDir: string, options: BrainGitHubImportOptions = {}): Promise<BrainGitHubImportResult> {
  const normalizedRepo = normalizeRepo(repo)
  const fetcher = options.fetchImpl ?? fetch
  await initializeBrain(brainDir)

  const repoInfo = await githubFetch<GitHubRepoResponse>(fetcher, `https://api.github.com/repos/${normalizedRepo}`, options.token)
  const readme = await githubFetch<GitHubReadmeResponse | undefined>(fetcher, `https://api.github.com/repos/${normalizedRepo}/readme`, options.token, true)
  const issues = options.includeIssues && options.includeIssues > 0
    ? await githubFetch<GitHubIssueResponse[]>(fetcher, `https://api.github.com/repos/${normalizedRepo}/issues?state=open&per_page=${Math.min(100, options.includeIssues)}`, options.token)
    : []

  const candidateSources = [
    repoSourceRecord(repoInfo),
    ...(readme ? [readmeSourceRecord(repoInfo, readme)] : []),
    ...issues.slice(0, options.includeIssues ?? 0).map((issue) => issueSourceRecord(repoInfo, issue))
  ]
  const existing = await readBrainSources(brainDir)
  const existingIds = new Set(existing.map((source) => source.id))
  const nextSources = [...existing]
  let sourcesAdded = 0
  let sourcesSkipped = 0

  for (const source of candidateSources) {
    if (existingIds.has(source.id)) {
      sourcesSkipped += 1
      continue
    }
    nextSources.push(source)
    existingIds.add(source.id)
    sourcesAdded += 1
  }

  await writeBrainSources(brainDir, nextSources)
  return {
    brainDir,
    repo: normalizedRepo,
    sourcesAdded,
    sourcesSkipped,
    sourceCount: nextSources.length
  }
}

function repoSourceRecord(repo: GitHubRepoResponse): BrainSourceRecord {
  const content = [
    `# ${repo.full_name}`,
    '',
    repo.description ? `Description: ${repo.description}` : '',
    `Repository: ${repo.html_url}`,
    repo.default_branch ? `Default branch: ${repo.default_branch}` : '',
    repo.language ? `Primary language: ${repo.language}` : '',
    repo.topics?.length ? `Topics: ${repo.topics.join(', ')}` : ''
  ].filter(Boolean).join('\n')
  return makeSource(`github:${repo.full_name}:metadata`, repo.full_name, repo.html_url, content, 'repo-metadata.md')
}

function readmeSourceRecord(repo: GitHubRepoResponse, readme: GitHubReadmeResponse): BrainSourceRecord {
  const decoded = readme.encoding === 'base64'
    ? Buffer.from(readme.content.replace(/\s+/g, ''), 'base64').toString('utf8')
    : readme.content
  return makeSource(`github:${repo.full_name}:readme:${readme.path}`, `${repo.full_name} README`, readme.html_url ?? repo.html_url, decoded, readme.path)
}

function issueSourceRecord(repo: GitHubRepoResponse, issue: GitHubIssueResponse): BrainSourceRecord {
  const content = [
    `# Issue #${issue.number}: ${issue.title}`,
    '',
    `State: ${issue.state}`,
    issue.user?.login ? `Author: ${issue.user.login}` : '',
    issue.labels?.length ? `Labels: ${issue.labels.map((label) => label.name).join(', ')}` : '',
    '',
    issue.body ?? ''
  ].filter(Boolean).join('\n')
  return makeSource(`github:${repo.full_name}:issue:${issue.number}`, `Issue #${issue.number}: ${issue.title}`, issue.html_url, content, `issues/${issue.number}.md`)
}

function makeSource(stableId: string, title: string, url: string, content: string, relativePath: string): BrainSourceRecord {
  const contentHash = hash(content)
  return {
    id: `src_${hash(`${stableId}:${contentHash}`).slice(0, 16)}`,
    sourceType: 'github',
    title,
    path: url,
    url,
    content,
    contentHash,
    ingestedAt: new Date().toISOString(),
    redacted: false,
    metadata: {
      relativePath: `github/${relativePath}`,
      bytes: Buffer.byteLength(content, 'utf8'),
      sourceAdapter: 'github-api'
    }
  }
}

async function githubFetch<T>(fetcher: typeof fetch, url: string, token: string | undefined, optional = false): Promise<T> {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'opscanon-company-brain',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })
  if (optional && response.status === 404) {
    return undefined as T
  }
  if (!response.ok) {
    throw new Error(`GitHub import failed for ${url}: HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

function normalizeRepo(repo: string): string {
  const match = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (!match) {
    throw new Error('brain github requires a repository in owner/name or https://github.com/owner/name format.')
  }
  return `${match[1]}/${match[2]}`
}
