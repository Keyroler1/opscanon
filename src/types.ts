export type Severity = 'info' | 'low' | 'medium' | 'high'

export interface Finding {
  code: string
  title: string
  severity: Severity
  message: string
  path?: string
  recommendation: string
}

export interface RepoSignals {
  rootPath: string
  repoName: string
  filesScanned: number
  languages: string[]
  manifests: string[]
  docsFiles: string[]
  hasReadme: boolean
  hasAgentInstructions: boolean
  hasSetupDocs: boolean
  hasUsageDocs: boolean
  hasAgentDocs: boolean
  hasCi: boolean
  ciFiles: string[]
  testCommands: string[]
  buildCommands: string[]
  lintCommands: string[]
  hasCli: boolean
  cliEntrypoints: string[]
  hasOpenApi: boolean
  openApiFiles: string[]
  hasApiDocs: boolean
  hasMcpDependency: boolean
  mcpConfigFiles: string[]
  envExampleFiles: string[]
  secretFindings: Finding[]
  findings: Finding[]
}

export interface McpScanResult {
  target: string
  targetType: 'config' | 'command'
  riskScore: number
  findings: Finding[]
}

export interface ScoreCategory {
  score: number
  weight: number
  findings: Finding[]
}

export interface AuditReport {
  tool: 'repohandoff'
  version: string
  generatedAt: string
  repo: {
    name: string
    path: string
  }
  overallScore: number
  categories: {
    agentSetupDocs: ScoreCategory
    machineInterfaces: ScoreCategory
    repoContextQuality: ScoreCategory
    evalReproducibility: ScoreCategory
    mcpSecurityBoundaries: ScoreCategory
  }
  topFixes: Finding[]
  signals: Omit<RepoSignals, 'rootPath' | 'secretFindings'>
}

export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
  env: NodeJS.ProcessEnv
}
