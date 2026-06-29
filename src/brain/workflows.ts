import { hash } from './ingest.js'
import { stripMarkdownFrontmatter } from './markdown.js'
import type {
  BrainActionBoundary,
  BrainActionBoundaryReport,
  BrainFact,
  BrainOperatingModel,
  BrainSourceRecord,
  BrainWorkflow,
  BrainWorkflowIndex,
  BrainWorkflowStep
} from './types.js'

const PROCEDURE_MARKERS = [
  'workflow',
  'process',
  'procedure',
  'playbook',
  'runbook',
  'sop',
  'standard operating procedure',
  'checklist',
  'operating',
  'manual',
  'review',
  'intake',
  'handoff',
  'qualification',
  'onboarding',
  'close',
  'triage',
  'approval',
  'exception',
  'escalation',
  'launch',
  'release',
  'interview',
  'audit',
  'planning',
  'support',
  'refund',
  'pricing exception',
  'incident',
  'customer record',
  'billing',
  'rollback'
]

const ACTION_PATTERNS = [
  'approves?',
  'checks?',
  'classif(?:y|ies)',
  'closes?',
  'creates?',
  'escalates?',
  'gathers?',
  'intakes?',
  'notifies?',
  'opens?',
  'prepares?',
  'reconciles?',
  'reviews?',
  'routes?',
  'sends?',
  'shares?',
  'submits?',
  'summarizes?',
  'triages?',
  'updates?',
  'validates?',
  'verifies?'
]

const ACTION_VERB_REGEX = new RegExp(`\\b(?:${ACTION_PATTERNS.join('|')})\\b`, 'i')

const ACTOR_TERMS = [
  'Account lead',
  'AE',
  'CEO',
  'CFO',
  'Compliance owner',
  'Controller',
  'CSM',
  'CTO',
  'Engineer',
  'Engineers',
  'Finance lead',
  'Hiring manager',
  'Interviewers',
  'Legal owner',
  'Manager',
  'People lead',
  'Product manager',
  'Recruiter',
  'SDR',
  'Security owner',
  'Support agent',
  'Support agents',
  'VP Sales'
]

const SYSTEM_TERMS = [
  'Asana',
  'Confluence',
  'CRM',
  'Datadog',
  'Drive',
  'GitHub',
  'Greenhouse',
  'HubSpot',
  'Intercom',
  'Jira',
  'Linear',
  'Notion',
  'QuickBooks',
  'Salesforce',
  'ServiceNow',
  'SharePoint',
  'Slack',
  'Stripe',
  'Zendesk',
  'vendor'
]

const SENSITIVE_ACTION_TERMS = [
  'billing',
  'books',
  'compensation',
  'credential',
  'credentials',
  'customer record',
  'customer data',
  'discount',
  'external',
  'finance',
  'offer',
  'pricing',
  'refund',
  'production',
  'rollback',
  'delete',
  'modify',
  'change',
  'send',
  'post'
]

interface SourceSection {
  heading: string
  source: BrainSourceRecord
  lines: string[]
}

export function extractWorkflows(sources: BrainSourceRecord[], facts: BrainFact[] = []): BrainWorkflow[] {
  const workflows = new Map<string, BrainWorkflow>()

  for (const section of sources.flatMap(sectionsFromSource)) {
    if (!isWorkflowCandidate(section)) {
      continue
    }

    const title = inferWorkflowTitle(section)
    const slug = slugify(title)
    const existing = workflows.get(slug)
    const workflow = workflowFromSection(section, title, slug, sources)
    if (!workflow) {
      continue
    }

    const sourceIds = existing
      ? [...new Set([...existing.sourceIds, ...workflow.sourceIds])]
      : workflow.sourceIds
    const mergedSteps = existing
      ? dedupeSteps([...existing.steps, ...workflow.steps]).map((step, index) => ({ ...step, order: index + 1 }))
      : workflow.steps
    const allowedWithoutApproval = allowedLines(mergedSteps)
    const requiresApproval = approvalLines(mergedSteps)
    const mergedLines = mergedSteps.map((step) => step.text)

    workflows.set(slug, {
      ...workflow,
      sourceIds,
      summary: summarizeWorkflow(title, mergedSteps),
      triggers: inferTriggers(`${section.heading}\n${section.lines.join('\n')}`),
      owners: dedupeText([...(existing?.owners ?? []), ...workflow.owners, ...inferOwners(mergedLines)]),
      systems: dedupeText([...(existing?.systems ?? []), ...workflow.systems, ...inferSystems(mergedLines)]),
      inputs: dedupeText([...(existing?.inputs ?? []), ...workflow.inputs, ...inferInputs(mergedLines)]),
      outputs: dedupeText([...(existing?.outputs ?? []), ...workflow.outputs, ...inferOutputs(mergedLines)]),
      decisionRules: dedupeText([...(existing?.decisionRules ?? []), ...workflow.decisionRules, ...inferDecisionRules(mergedLines)]),
      exceptions: dedupeText([...(existing?.exceptions ?? []), ...workflow.exceptions, ...inferExceptions(mergedLines)]),
      steps: mergedSteps,
      allowedWithoutApproval,
      requiresApproval,
      unknowns: unknownsForWorkflow(mergedSteps, requiresApproval),
      riskLevel: riskLevelForWorkflow(mergedSteps),
      lastSeen: latestTimestamp(sourceIds, sources)
    })
  }

  const workflowSourceIds = new Set([...workflows.values()].flatMap((workflow) => workflow.sourceIds))
  const factOnlyWorkflows = workflowFactsToFallbacks(facts, sources, workflows, workflowSourceIds)
  for (const workflow of factOnlyWorkflows) {
    workflows.set(workflow.slug, workflow)
  }

  return [...workflows.values()].sort((a, b) => a.title.localeCompare(b.title))
}

export function buildWorkflowIndex(workflows: BrainWorkflow[]): BrainWorkflowIndex {
  return {
    generatedAt: new Date().toISOString(),
    workflows
  }
}

export function buildOperatingModel(workflows: BrainWorkflow[]): BrainOperatingModel {
  const owners = new Set(workflows.flatMap((workflow) => workflow.owners))
  const systems = new Set(workflows.flatMap((workflow) => workflow.systems))
  return {
    generatedAt: new Date().toISOString(),
    procedures: workflows,
    summary: {
      procedureCount: workflows.length,
      ownerCount: owners.size,
      systemCount: systems.size,
      approvalGateCount: workflows.reduce((total, workflow) => total + workflow.requiresApproval.length, 0),
      humanOwnedCount: workflows.filter((workflow) => workflow.riskLevel === 'human-owned').length
    },
    gaps: operatingModelGaps(workflows)
  }
}

export function buildActionBoundaryReport(workflows: BrainWorkflow[], facts: BrainFact[]): BrainActionBoundaryReport {
  const boundaries: BrainActionBoundary[] = [
    {
      action: 'read and summarize source-cited company context',
      rule: 'Allowed without approval when the agent cites source records and does not change external systems.',
      requiresApproval: false,
      sourceIds: []
    },
    {
      action: 'changing customer records',
      rule: 'Requires human approval before changing customer records, billing, refunds, pricing, or production systems.',
      requiresApproval: true,
      sourceIds: []
    }
  ]

  for (const workflow of workflows) {
    for (const step of workflow.steps.filter((candidate) => candidate.requiresApproval)) {
      boundaries.push({
        action: step.text,
        rule: step.approvalReason ?? 'Human approval is required by the source-cited workflow.',
        requiresApproval: true,
        sourceIds: step.sourceIds
      })
    }
  }

  for (const fact of facts.filter((candidate) => ['policy', 'security'].includes(candidate.category))) {
    const lower = fact.claim.toLowerCase()
    if (lower.includes('approval') || lower.includes('must not') || lower.includes('permission')) {
      boundaries.push({
        action: fact.claim,
        rule: 'Human approval is required by policy evidence.',
        requiresApproval: true,
        sourceIds: fact.sourceIds
      })
    }
  }

  const deduped = dedupeBoundaries(boundaries)
  return {
    generatedAt: new Date().toISOString(),
    defaultMode: 'read-only',
    boundaries: deduped,
    unresolved: [
      'Confirm owners for each sensitive workflow.',
      'Confirm which systems agents may write to after approval.',
      'Confirm escalation contacts for missing or conflicting policy evidence.'
    ]
  }
}

export function renderWorkflowMarkdown(workflow: BrainWorkflow, sources: BrainSourceRecord[]): string {
  return `# ${workflow.title}

${workflow.summary}

## Source Status

- Risk level: ${workflow.riskLevel}
- Sources: ${workflow.sourceIds.map((sourceId) => sourceTitle(sourceId, sources)).join(', ')}
- Last seen: ${workflow.lastSeen}

## Triggers

${renderList(workflow.triggers)}

## Owners

${renderList(workflow.owners)}

## Systems Touched

${renderList(workflow.systems)}

## Inputs

${renderList(workflow.inputs)}

## Outputs

${renderList(workflow.outputs)}

## Decision Rules

${renderList(workflow.decisionRules)}

## Exceptions

${renderList(workflow.exceptions)}

## Agent Procedure

${workflow.steps.map((step) => `${step.order}. ${step.text}${step.requiresApproval ? ' [approval required]' : ''}`).join('\n')}

## Allowed Without Approval

${renderList(workflow.allowedWithoutApproval)}

## Requires Human Approval

${renderList(workflow.requiresApproval)}

## Unknowns To Resolve

${renderList(workflow.unknowns)}
`
}

export function renderWorkflowSkill(workflow: BrainWorkflow, sources: BrainSourceRecord[]): string {
  return `---
name: ${workflow.slug}
description: Execute the source-cited ${workflow.title} workflow safely with approval gates.
---

# ${workflow.title}

Use this skill when an agent needs to help with ${workflow.title.toLowerCase()} for this company.

## Required Source Checks

- Read this skill.
- Read the cited workflow file: workflows/${workflow.slug}.md.
- Search the company brain for newer decisions or policies about: ${workflow.triggers.join(', ') || workflow.title}.
- If source evidence conflicts, stop and ask a human which policy is current.

## Agent Procedure

${workflow.steps.map((step) => `${step.order}. ${step.text}${step.requiresApproval ? ' Before doing this, get explicit human approval.' : ''}`).join('\n')}

## Required Inputs

${renderList(workflow.inputs.length ? workflow.inputs : ['A user request, the cited workflow source, and any customer/system identifiers needed for read-only analysis.'])}

## Owners

${renderList(workflow.owners)}

## Systems Touched

${renderList(workflow.systems)}

## Inputs

${renderList(workflow.inputs)}

## Outputs

${renderList(workflow.outputs)}

## Decision Rules

${renderList(workflow.decisionRules)}

## Exceptions

${renderList(workflow.exceptions)}

## Allowed Without Approval

${renderList(workflow.allowedWithoutApproval)}

## Requires Human Approval

${renderList(workflow.requiresApproval)}

## Stop Conditions

- Stop if source evidence conflicts or the current source freshness is unclear.
- Stop if the requested action would change customer, billing, production, security, or external systems without explicit human approval.
- Stop if required inputs, owners, or approval gates are missing.
- Stop if the user asks the agent to bypass a policy or approval boundary.

## Output Format

- State what evidence was used.
- State the recommended next action.
- State whether the next action is read-only or approval-gated.
- Never write to customer, billing, production, or external systems unless the workflow explicitly allows it and a human approves.

## Citations

${workflow.sourceIds.map((sourceId) => `- ${sourceTitle(sourceId, sources)}`).join('\n')}
`
}

export function renderOperatingModelMarkdown(model: BrainOperatingModel, sources: BrainSourceRecord[]): string {
  const procedureLines = model.procedures.length
    ? model.procedures.map((procedure) => [
        `## ${procedure.title}`,
        '',
        procedure.summary,
        '',
        `- Risk level: ${procedure.riskLevel}`,
        `- Owners: ${procedure.owners.join(', ') || 'Unknown'}`,
        `- Systems: ${procedure.systems.join(', ') || 'None found'}`,
        `- Triggers: ${procedure.triggers.join(', ') || 'None found'}`,
        `- Outputs: ${procedure.outputs.join(', ') || 'None found'}`,
        `- Approval gates: ${procedure.requiresApproval.length}`,
        `- Sources: ${procedure.sourceIds.map((sourceId) => sourceTitle(sourceId, sources)).join(', ')}`
      ].join('\n')).join('\n\n')
    : 'No source-cited operating procedures found yet.'

  return `# Operating Model

This is the source-cited map of how the company works. It is compiled from discovered procedures, not a fixed list of example workflows.

## Summary

- Procedures: ${model.summary.procedureCount}
- Owners: ${model.summary.ownerCount}
- Systems: ${model.summary.systemCount}
- Approval gates: ${model.summary.approvalGateCount}
- Human-owned procedures: ${model.summary.humanOwnedCount}

## Procedures

${procedureLines}

## Gaps

${renderList(model.gaps)}
`
}

export function renderActionBoundariesMarkdown(report: BrainActionBoundaryReport, sources: BrainSourceRecord[]): string {
  const allowed = report.boundaries.filter((boundary) => !boundary.requiresApproval)
  const approval = report.boundaries.filter((boundary) => boundary.requiresApproval)

  return `# Action Boundaries

Default mode: ${report.defaultMode}

Agents should treat this file as the safety layer between company knowledge and automation.

## Allowed Without Approval

${allowed.map((boundary) => `- ${boundary.action}: ${boundary.rule}`).join('\n') || '- No allowed actions found.'}

## Requires Human Approval

${approval.map((boundary) => `- ${boundary.action}: ${boundary.rule}${boundary.sourceIds.length ? ` (${boundary.sourceIds.map((sourceId) => sourceTitle(sourceId, sources)).join(', ')})` : ''}`).join('\n') || '- No approval-gated actions found.'}

## Unresolved

${renderList(report.unresolved)}
`
}

function sectionsFromSource(source: BrainSourceRecord): SourceSection[] {
  const sections: SourceSection[] = []
  let current: SourceSection = { heading: source.title, source, lines: [] }

  for (const rawLine of stripMarkdownFrontmatter(source.content).split(/\r?\n/)) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    const heading = line.match(/^#{1,4}\s+(.+)$/)
    if (heading) {
      if (current.lines.length > 0) {
        sections.push(current)
      }
      current = { heading: heading[1]?.trim() ?? source.title, source, lines: [] }
      continue
    }

    if (line && !line.startsWith('```')) {
      current.lines.push(line)
    }
  }

  if (current.lines.length > 0) {
    sections.push(current)
  }

  return sections
}

function isWorkflowCandidate(section: SourceSection): boolean {
  const value = `${section.heading}\n${section.lines.join('\n')}`.toLowerCase()
  if (PROCEDURE_MARKERS.some((keyword) => value.includes(keyword))) {
    return true
  }

  const actionableLines = section.lines
    .map(normalizeStepLine)
    .filter((line) => isActionableWorkflowLine(line)).length
  const hasTriggerOrOutput = /\b(when|if|after|before|output|result|done|complete|closed)\b/i.test(value)
  const hasBoundary = /\b(require|approval|must|do not|never|owner|lead|manager)\b/i.test(value)
  return actionableLines >= 2 && (hasTriggerOrOutput || hasBoundary)
}

function inferWorkflowTitle(section: SourceSection): string {
  const value = `${section.heading}\n${section.lines.join('\n')}`.toLowerCase()
  if (value.includes('refund')) return 'Refund Handling'
  if (value.includes('pricing exception')) return 'Pricing Exception Handling'
  if (value.includes('incident')) return 'Incident Response'
  if (value.includes('customer record')) return 'Customer Record Handling'
  if (value.includes('billing')) return 'Billing Change Handling'
  if (value.includes('escalation')) return 'Escalation Handling'

  const cleaned = titleCase(section.heading.replace(/\b(workflow|process|procedure|playbook|runbook|sop|checklist)\b/gi, '').trim())
  return cleaned || 'Operational Workflow'
}

function extractWorkflowSteps(section: SourceSection): BrainWorkflowStep[] {
  const lines = section.lines
    .map(normalizeStepLine)
    .filter((line) => line.length >= 12 && line.length <= 500)
    .filter((line) => isActionableWorkflowLine(line))

  return dedupeText(lines).slice(0, 16).map((line, index) => ({
    order: index + 1,
    text: line,
    sourceIds: [section.source.id],
    requiresApproval: requiresApprovalForLine(line),
    approvalReason: requiresApprovalForLine(line) ? approvalReasonForLine(line) : undefined,
    actor: inferActor(line),
    system: inferSystems([line])[0]
  }))
}

function normalizeStepLine(line: string): string {
  return line
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isActionableWorkflowLine(line: string): boolean {
  const lower = line.toLowerCase()
  return ACTION_VERB_REGEX.test(line)
    || /\b(agent|customer|lead|manager|owner|controller|recruiter|interviewer|engineer|sdr|csm|ae|approval|must|should|may|requires?|do not|output|when|if|before|after)\b/i.test(lower)
}

function requiresApprovalForLine(line: string): boolean {
  const lower = line.toLowerCase()
  if (/(requires?|required).{0,40}approval|approval.{0,40}(requires?|required)|ask a human|human before|must not|do not|never|without approval|commander approval/.test(lower)) {
    return true
  }

  return SENSITIVE_ACTION_TERMS.some((term) => lower.includes(term))
    && /(change|modify|delete|post|send|rollback|refund|pricing exception|billing)/.test(lower)
}

function approvalReasonForLine(line: string): string {
  const lower = line.toLowerCase()
  const owner = approvalOwnerFromLine(line)
  if (owner) return `${owner} approval is required by source evidence.`
  if (lower.includes('founder')) return 'Founder approval is required by source evidence.'
  if (lower.includes('incident commander')) return 'Incident commander approval is required by source evidence.'
  if (lower.includes('billing')) return 'Billing changes require human approval.'
  if (lower.includes('customer record')) return 'Customer record changes require human approval.'
  if (lower.includes('production') || lower.includes('rollback')) return 'Production changes require human approval.'
  return 'Human approval is required by source evidence.'
}

function inferOwners(lines: string[]): string[] {
  const owners = new Set<string>()
  for (const line of lines) {
    const actor = inferActor(line)
    if (actor) {
      owners.add(actor)
    }

    const approvalOwner = approvalOwnerFromLine(line)
    if (approvalOwner) {
      owners.add(approvalOwner)
    }
  }
  return [...owners].slice(0, 12)
}

function inferActor(line: string): string | undefined {
  for (const actor of ACTOR_TERMS) {
    if (new RegExp(`\\b${escapeRegExp(actor)}\\b`, 'i').test(line)) {
      return canonicalActor(actor)
    }
  }

  const leading = line.match(/^([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]+){0,3})\s+(?:approves?|checks?|classif(?:y|ies)|closes?|creates?|escalates?|gathers?|notifies?|opens?|prepares?|reconciles?|reviews?|routes?|sends?|shares?|submits?|summarizes?|triages?|updates?|validates?|verifies?)\b/)
  return leading?.[1]
}

function approvalOwnerFromLine(line: string): string | undefined {
  const match = line.match(/\brequires?\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]+){0,3}|VP\s+[A-Z][A-Za-z]+|People lead|Finance lead|Security owner|Controller|Manager|Founder|Incident commander)\s+approval\b/i)
    ?? line.match(/\b([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]+){0,3}|VP\s+[A-Z][A-Za-z]+|People lead|Finance lead|Security owner|Controller|Manager|Founder|Incident commander)\s+approves?\b/i)
  if (!match?.[1]) {
    return undefined
  }
  return canonicalActor(match[1])
}

function inferSystems(lines: string[]): string[] {
  const systems = new Set<string>()
  for (const line of lines) {
    for (const system of SYSTEM_TERMS) {
      if (new RegExp(`\\b${escapeRegExp(system)}\\b`, 'i').test(line)) {
        systems.add(system)
      }
    }
  }
  return [...systems].slice(0, 12)
}

function inferInputs(lines: string[]): string[] {
  return dedupeText(lines
    .filter((line) => /\b(input|intake|request|lead|case|ticket|vendor|customer|invoice|role)\b/i.test(line))
    .map((line) => line.replace(/[.!?]$/, '')))
    .slice(0, 8)
}

function inferOutputs(lines: string[]): string[] {
  return dedupeText(lines
    .filter((line) => /\b(output|result|produces?|creates?|recommendation|report|checklist|opportunity|decision|approved|rejected|closed)\b/i.test(line))
    .map((line) => line.replace(/^output:\s*/i, '').replace(/[.!?]$/, '')))
    .slice(0, 8)
}

function inferDecisionRules(lines: string[]): string[] {
  return dedupeText(lines
    .filter((line) => /\b(require|approval|approve|if|when|before|after|within|must|should|do not|never|above|below|only)\b/i.test(line))
    .map((line) => line.replace(/[.!?]$/, '.')))
    .slice(0, 12)
}

function inferExceptions(lines: string[]): string[] {
  return dedupeText(lines
    .filter((line) => /\b(exception|except|unless|do not|never|must not|without approval|rejected|open risk)\b/i.test(line))
    .map((line) => line.replace(/[.!?]$/, '.')))
    .slice(0, 8)
}

function operatingModelGaps(workflows: BrainWorkflow[]): string[] {
  const gaps = []
  if (workflows.some((workflow) => workflow.owners.length === 0)) {
    gaps.push('Some procedures are missing an explicit owner.')
  }
  if (workflows.some((workflow) => workflow.systems.length === 0)) {
    gaps.push('Some procedures do not name the system of record.')
  }
  if (workflows.some((workflow) => workflow.outputs.length === 0)) {
    gaps.push('Some procedures do not define the expected output.')
  }
  if (workflows.some((workflow) => workflow.requiresApproval.length === 0)) {
    gaps.push('Some procedures have no explicit approval boundary.')
  }
  return gaps.length > 0 ? gaps : ['No operating-model gaps detected from current source evidence.']
}

function allowedLines(steps: BrainWorkflowStep[]): string[] {
  const allowed = steps
    .filter((step) => !step.requiresApproval)
    .map((step) => step.text)

  return allowed.length > 0
    ? dedupeText(allowed).slice(0, 8)
    : ['Read source material, summarize evidence, and prepare a cited recommendation.']
}

function approvalLines(steps: BrainWorkflowStep[]): string[] {
  const approval = steps
    .filter((step) => step.requiresApproval)
    .map((step) => step.text)

  return approval.length > 0
    ? dedupeText(approval).slice(0, 10)
    : ['No explicit approval rule found; keep actions read-only until an owner confirms the boundary.']
}

function unknownsForWorkflow(steps: BrainWorkflowStep[], requiresApproval: string[]): string[] {
  const unknowns = []
  if (!steps.some((step) => /owner|founder|commander|manager|lead|controller|recruiter|sdr|engineer|vp/i.test(step.text))) {
    unknowns.push('Who owns final approval for this workflow?')
  }
  if (requiresApproval.some((line) => line.startsWith('No explicit approval'))) {
    unknowns.push('Which actions are approved for automation versus human-owned?')
  }
  return unknowns.length > 0 ? unknowns : ['No open workflow questions detected from current source evidence.']
}

function riskLevelForWorkflow(steps: BrainWorkflowStep[]): BrainWorkflow['riskLevel'] {
  if (steps.some((step) => /must not|do not|never|without approval/i.test(step.text))) return 'human-owned'
  if (steps.some((step) => step.requiresApproval)) return 'approval-required'
  return 'read-only'
}

function summarizeWorkflow(title: string, steps: BrainWorkflowStep[]): string {
  const approvalCount = steps.filter((step) => step.requiresApproval).length
  return `${title} was compiled from source evidence into ${steps.length} operating step(s), with ${approvalCount} approval-gated step(s).`
}

function inferTriggers(value: string): string[] {
  const lower = value.toLowerCase()
  const explicit = value
    .split(/\r?\n/)
    .map(normalizeStepLine)
    .filter((line) => /^(when|if|after|before)\b/i.test(line))
    .map((line) => line.replace(/[.!?]$/, ''))
  const markers = PROCEDURE_MARKERS.filter((keyword) => lower.includes(keyword))
  return dedupeText([...explicit, ...markers]).slice(0, 8)
}

function latestTimestamp(sourceIds: string[], sources: BrainSourceRecord[]): string {
  return sources
    .filter((source) => sourceIds.includes(source.id))
    .map((source) => source.metadata.lastModified ?? source.ingestedAt)
    .sort()
    .at(-1) ?? new Date(0).toISOString()
}

function dedupeSteps(steps: BrainWorkflowStep[]): BrainWorkflowStep[] {
  const seen = new Set<string>()
  const result: BrainWorkflowStep[] = []
  for (const step of steps) {
    const key = step.text.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(step)
    }
  }
  return result
}

function dedupeText(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    const key = normalized.toLowerCase()
    if (normalized && !seen.has(key)) {
      seen.add(key)
      result.push(normalized)
    }
  }
  return result
}

function dedupeBoundaries(boundaries: BrainActionBoundary[]): BrainActionBoundary[] {
  const seen = new Set<string>()
  const result: BrainActionBoundary[] = []
  for (const boundary of boundaries) {
    const key = `${boundary.requiresApproval}:${boundary.action.toLowerCase()}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(boundary)
    }
  }
  return result
}

function workflowFactsToFallbacks(facts: BrainFact[], sources: BrainSourceRecord[], existing: Map<string, BrainWorkflow>, coveredSourceIds: Set<string>): BrainWorkflow[] {
  return facts
    .filter((fact) => fact.category === 'workflow' && fact.claim.length > 12)
    .filter((fact) => !fact.sourceIds.some((sourceId) => coveredSourceIds.has(sourceId)) || hasExplicitWorkflowMarker(fact.claim))
    .map((fact) => {
      const title = inferFallbackWorkflowTitle(fact.claim)
      const slug = slugify(title)
      if (existing.has(slug)) {
        return undefined
      }
      const step: BrainWorkflowStep = {
        order: 1,
        text: fact.claim,
        sourceIds: fact.sourceIds,
        requiresApproval: requiresApprovalForLine(fact.claim),
        approvalReason: requiresApprovalForLine(fact.claim) ? approvalReasonForLine(fact.claim) : undefined,
        actor: inferActor(fact.claim),
        system: inferSystems([fact.claim])[0]
      }
      return {
        id: `workflow_${hash(slug).slice(0, 16)}`,
        slug,
        title,
        summary: summarizeWorkflow(title, [step]),
        sourceIds: fact.sourceIds,
        triggers: inferTriggers(fact.claim),
        owners: inferOwners([fact.claim]),
        systems: inferSystems([fact.claim]),
        inputs: inferInputs([fact.claim]),
        outputs: inferOutputs([fact.claim]),
        decisionRules: inferDecisionRules([fact.claim]),
        exceptions: inferExceptions([fact.claim]),
        steps: [step],
        allowedWithoutApproval: allowedLines([step]),
        requiresApproval: approvalLines([step]),
        unknowns: unknownsForWorkflow([step], approvalLines([step])),
        riskLevel: riskLevelForWorkflow([step]),
        lastSeen: latestTimestamp(fact.sourceIds, sources)
      }
    })
    .filter((workflow): workflow is BrainWorkflow => Boolean(workflow))
}

function hasExplicitWorkflowMarker(value: string): boolean {
  return /\b(workflow|process|procedure|playbook|runbook|sop|standard operating procedure)\b/i.test(value)
}

function workflowFromSection(section: SourceSection, title: string, slug: string, sources: BrainSourceRecord[]): BrainWorkflow | undefined {
  const steps = extractWorkflowSteps(section)
  if (steps.length === 0) {
    return undefined
  }

  const lines = section.lines.map(normalizeStepLine)
  const sourceIds = [section.source.id]
  return {
    id: `workflow_${hash(slug).slice(0, 16)}`,
    slug,
    title,
    summary: summarizeWorkflow(title, steps),
    sourceIds,
    triggers: inferTriggers(`${section.heading}\n${section.lines.join('\n')}`),
    owners: inferOwners(lines),
    systems: inferSystems(lines),
    inputs: inferInputs(lines),
    outputs: inferOutputs(lines),
    decisionRules: inferDecisionRules(lines),
    exceptions: inferExceptions(lines),
    steps,
    allowedWithoutApproval: allowedLines(steps),
    requiresApproval: approvalLines(steps),
    unknowns: unknownsForWorkflow(steps, approvalLines(steps)),
    riskLevel: riskLevelForWorkflow(steps),
    lastSeen: latestTimestamp(sourceIds, sources)
  }
}

function inferFallbackWorkflowTitle(claim: string): string {
  const section: SourceSection = {
    heading: claim,
    lines: [claim],
    source: {
      id: 'fallback',
      sourceType: 'other',
      title: claim,
      path: '',
      content: claim,
      contentHash: '',
      ingestedAt: new Date(0).toISOString(),
      redacted: false,
      metadata: { relativePath: '', bytes: 0 }
    }
  }
  return inferWorkflowTitle(section)
}

function sourceTitle(sourceId: string, sources: BrainSourceRecord[]): string {
  const source = sources.find((candidate) => candidate.id === sourceId)
  return source ? `${source.title} (${source.metadata.relativePath})` : sourceId
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- None found.'
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ')
}

function canonicalActor(value: string): string {
  if (/^sdr$/i.test(value)) return 'SDR'
  if (/^ae$/i.test(value)) return 'AE'
  if (/^csm$/i.test(value)) return 'CSM'
  if (/^vp\s+sales$/i.test(value)) return 'VP Sales'
  return titleCase(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'workflow'
}
