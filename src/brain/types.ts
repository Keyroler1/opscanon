export type BrainSourceType =
  | 'repo'
  | 'docs'
  | 'wiki'
  | 'notion'
  | 'confluence'
  | 'drive'
  | 'sharepoint'
  | 'github'
  | 'linear'
  | 'jira'
  | 'tickets'
  | 'transcripts'
  | 'notes'
  | 'slack'
  | 'support'
  | 'crm'
  | 'other'

export type BrainFactCategory =
  | 'company'
  | 'product'
  | 'customer'
  | 'team'
  | 'decision'
  | 'policy'
  | 'workflow'
  | 'priority'
  | 'engineering'
  | 'security'
  | 'open-question'
  | 'general'

export interface BrainSourceRecord {
  id: string
  sourceType: BrainSourceType
  title: string
  path: string
  url?: string
  content: string
  contentHash: string
  ingestedAt: string
  redacted: boolean
  metadata: {
    relativePath: string
    bytes: number
    lastModified?: string
    sourceAdapter?: string
    crawl?: {
      scanId: string
      rootPath: string
      consent: string
      mode: 'local-filesystem'
      allCompanyFiles: boolean
      crawledAt: string
    }
  }
}

export interface BrainFact {
  id: string
  claim: string
  category: BrainFactCategory
  sourceIds: string[]
  subjects: string[]
  confidence: number
  status: 'active'
  lastSeen: string
}

export interface BrainEntity {
  id: string
  type: 'company' | 'person' | 'team' | 'product' | 'customer' | 'repo' | 'workflow' | 'tool' | 'policy'
  name: string
  sourceIds: string[]
}

export interface BrainRelation {
  from: string
  to: string
  type: 'mentions' | 'owns' | 'serves' | 'implements' | 'governs' | 'requires' | 'decided'
  sourceIds: string[]
}

export interface BrainGraph {
  generatedAt: string
  entities: BrainEntity[]
  relations: BrainRelation[]
}

export interface BrainBuildResult {
  brainDir: string
  sourceCount: number
  factCount: number
  entityCount: number
  relationCount: number
  workflowCount: number
  qualityScore?: number
}

export interface BrainIngestResult {
  brainDir: string
  sourcesAdded: number
  sourcesSkipped: number
  sourceCount: number
}

export type BrainCrawlSkipReason =
  | 'ignored-directory'
  | 'unsupported-type'
  | 'too-large'
  | 'empty'
  | 'duplicate'
  | 'file-limit'
  | 'read-error'

export interface BrainCrawlScan {
  scanId: string
  rootPath: string
  sourceType: BrainSourceType
  sourceAdapter: string
  consent: string
  mode: 'local-filesystem'
  allCompanyFiles: boolean
  dryRun: boolean
  scannedAt: string
  maxFiles: number
  maxBytesPerFile: number
  filesDiscovered: number
  filesEligible: number
  filesSkipped: number
  sourcesAdded: number
  sourcesSkipped: number
  sourceCount: number
  redactedSources: number
  skippedByReason: Partial<Record<BrainCrawlSkipReason, number>>
  skippedSamples: Array<{
    path: string
    reason: BrainCrawlSkipReason
  }>
}

export interface BrainCrawlManifest {
  version: 1
  scans: BrainCrawlScan[]
}

export interface BrainCrawlResult extends BrainIngestResult {
  scanId: string
  filesDiscovered: number
  filesEligible: number
  filesSkipped: number
  redactedSources: number
  skippedByReason: Partial<Record<BrainCrawlSkipReason, number>>
}

export type BrainWorkflowRiskLevel = 'read-only' | 'approval-required' | 'human-owned'

export interface BrainWorkflowStep {
  order: number
  text: string
  sourceIds: string[]
  requiresApproval: boolean
  approvalReason?: string
  actor?: string
  system?: string
}

export interface BrainWorkflow {
  id: string
  slug: string
  title: string
  summary: string
  sourceIds: string[]
  triggers: string[]
  owners: string[]
  systems: string[]
  inputs: string[]
  outputs: string[]
  decisionRules: string[]
  exceptions: string[]
  steps: BrainWorkflowStep[]
  allowedWithoutApproval: string[]
  requiresApproval: string[]
  unknowns: string[]
  riskLevel: BrainWorkflowRiskLevel
  lastSeen: string
}

export interface BrainWorkflowIndex {
  generatedAt: string
  workflows: BrainWorkflow[]
}

export interface BrainOperatingModel {
  generatedAt: string
  procedures: BrainWorkflow[]
  summary: {
    procedureCount: number
    ownerCount: number
    systemCount: number
    approvalGateCount: number
    humanOwnedCount: number
  }
  gaps: string[]
}

export interface BrainActionBoundary {
  action: string
  rule: string
  requiresApproval: boolean
  sourceIds: string[]
}

export interface BrainActionBoundaryReport {
  generatedAt: string
  defaultMode: 'read-only'
  boundaries: BrainActionBoundary[]
  unresolved: string[]
}

export type BrainConnectorMode = 'export-folder' | 'sync-folder'

export interface BrainConnector {
  id: string
  provider: BrainSourceType
  mode: BrainConnectorMode
  path: string
  sourceAdapter: string
  consent: string
  enabled: boolean
  registeredAt: string
  lastSyncedAt?: string
  maxFiles?: number
  maxBytesPerFile?: number
}

export interface BrainConnectorManifest {
  version: 1
  connectors: BrainConnector[]
}

export interface BrainConnectResult {
  connector: BrainConnector
  crawl: BrainCrawlResult
}

export type BrainFreshnessStatus = 'fresh' | 'stale' | 'missing'

export interface BrainFreshnessItem {
  id: string
  label: string
  sourceType: BrainSourceType
  sourceAdapter: string
  rootPath?: string
  latestSeen?: string
  ageDays?: number
  status: BrainFreshnessStatus
  recommendation: string
}

export interface BrainFreshnessReport {
  generatedAt: string
  maxAgeDays: number
  status: BrainFreshnessStatus
  sourceCount: number
  staleCount: number
  missingCount: number
  items: BrainFreshnessItem[]
}

export interface BrainRefreshResult {
  brainDir: string
  refreshedScopes: number
  failedScopes: number
  sourcesAdded: number
  sourcesSkipped: number
  sourceCount: number
  built: boolean
  failures: Array<{
    rootPath: string
    reason: string
  }>
}

export type BrainPreparedDocumentStatus = 'compile' | 'review' | 'exclude'

export type BrainPreparedDocumentClassification =
  | 'procedure'
  | 'policy'
  | 'decision'
  | 'meeting-notes'
  | 'customer-evidence'
  | 'system-docs'
  | 'duplicate'
  | 'stale'
  | 'unreadable'
  | 'noise'
  | 'secret-redacted'
  | 'ocr-converted'
  | 'conflict'

export interface BrainPreparedDocument {
  id: string
  relativePath: string
  originalPath: string
  cleanedPath?: string
  title: string
  contentHash?: string
  normalizedHash?: string
  bytes: number
  lastModified?: string
  detectedOwner?: string
  detectedDates: string[]
  sourceType: BrainSourceType
  classifications: BrainPreparedDocumentClassification[]
  qualityScore: number
  status: BrainPreparedDocumentStatus
  reasons: string[]
  duplicateOf?: string
  redacted: boolean
  stale: boolean
}

export interface BrainPrepareIssue {
  severity: 'info' | 'warning' | 'error'
  documentId?: string
  path?: string
  message: string
  recommendation: string
}

export interface BrainPrepareReport {
  generatedAt: string
  inputPath: string
  packDir: string
  sourceType: BrainSourceType
  minQualityScore: number
  maxAgeDays: number
  totalFiles: number
  cleanedDocuments: number
  reviewItems: number
  duplicateItems: number
  staleItems: number
  unreadableItems: number
  noiseItems: number
  documents: BrainPreparedDocument[]
  issues: BrainPrepareIssue[]
}

export interface BrainPrepareResult {
  packDir: string
  totalFiles: number
  cleanedDocuments: number
  reviewItems: number
  duplicateItems: number
  staleItems: number
  unreadableItems: number
  noiseItems: number
}

export interface BrainPrepareManifest {
  version: 1
  generatedAt: string
  inputPath: string
  packDir: string
  safeToBuild: boolean
  packQualityScore: number
  counts: {
    totalFiles: number
    compileReady: number
    review: number
    duplicates: number
    stale: number
    unreadable: number
    noise: number
    conflicts: number
  }
  artifacts: string[]
  nextCommands: string[]
}

export type BrainReviewDecisionValue =
  | 'needs-review'
  | 'approve-current'
  | 'approve-with-corrections'
  | 'reject'
  | 'needs-ocr'

export interface BrainReviewDecision {
  documentId: string
  path: string
  title: string
  currentStatus: BrainPreparedDocumentStatus
  classifications: BrainPreparedDocumentClassification[]
  qualityScore: number
  decision: BrainReviewDecisionValue
  allowedDecisions: BrainReviewDecisionValue[]
  reviewer: string
  notes: string
  correctedContentPath?: string
}

export interface BrainReviewDecisionFile {
  version: 1
  generatedAt: string
  packDir: string
  decisions: BrainReviewDecision[]
}

export interface BrainReviewResult {
  packDir: string
  decisionCount: number
  decisionsPath: string
}

export interface BrainApproveResult {
  packDir: string
  approvedPackDir: string
  approvedDocuments: number
  rejectedDocuments: number
}

export interface BrainQualityCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  score: number
  maxScore: number
  message: string
}

export interface BrainQualityReport {
  generatedAt: string
  brainDir: string
  score: number
  maxScore: 100
  status: 'pass' | 'warn' | 'fail'
  checks: BrainQualityCheck[]
}

export interface BrainEvalCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

export interface BrainEvalReport {
  generatedAt: string
  brainDir: string
  status: 'pass' | 'warn' | 'fail'
  checks: BrainEvalCheck[]
}

export interface BrainAnswer {
  question: string
  answer: string
  citations: Array<{
    id: string
    title: string
    path: string
  }>
  unresolvedQuestions: string[]
}

export interface BrainSearchResult {
  id: string
  title: string
  url: string
  text: string
  metadata: Record<string, unknown>
}
