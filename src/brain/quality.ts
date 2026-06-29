import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathExists } from '../utils/files.js'
import {
  readBrainFacts,
  readBrainSources,
  readBrainWorkflowIndex
} from './io.js'
import type { BrainQualityCheck, BrainQualityReport, BrainWorkflow } from './types.js'

export async function writeBrainQualityReport(brainDir: string): Promise<BrainQualityReport> {
  const report = await scoreBrainQuality(brainDir)
  await writeFile(join(brainDir, 'brain-quality-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(join(brainDir, 'brain-quality-report.md'), renderBrainQualityReport(report), 'utf8')
  return report
}

export async function scoreBrainQuality(brainDir: string): Promise<BrainQualityReport> {
  const sources = await readBrainSources(brainDir)
  const facts = await readBrainFacts(brainDir)
  const workflows = (await readBrainWorkflowIndex(brainDir)).workflows
  const unresolvedText = await readOptional(join(brainDir, 'unresolved-questions.md'))
  const checks: BrainQualityCheck[] = [
    check('source-coverage', 'Source coverage', sources.length > 0 ? 15 : 0, 15, sources.length > 0 ? 'pass' : 'fail', `${sources.length} source(s) compiled.`),
    check('fact-coverage', 'Fact coverage', facts.length > 0 ? 10 : 0, 10, facts.length > 0 ? 'pass' : 'warn', `${facts.length} source-cited fact(s) compiled.`),
    check('workflow-coverage', 'Workflow coverage', workflows.length > 0 ? 20 : 0, 20, workflows.length > 0 ? 'pass' : 'warn', `${workflows.length} workflow(s) compiled.`),
    ratioCheck('workflow-owner-coverage', 'Workflow owner coverage', workflows, (workflow) => workflow.owners.length > 0, 15),
    ratioCheck('workflow-system-coverage', 'Workflow system coverage', workflows, (workflow) => workflow.systems.length > 0, 15),
    ratioCheck('workflow-output-coverage', 'Workflow output coverage', workflows, (workflow) => workflow.outputs.length > 0, 10),
    ratioCheck('approval-boundary-coverage', 'Approval boundary coverage', workflows, (workflow) => workflow.requiresApproval.length > 0, 10),
    check('unresolved-question-load', 'Unresolved question load', unresolvedQuestionScore(unresolvedText), 5, unresolvedQuestionScore(unresolvedText) >= 4 ? 'pass' : 'warn', unresolvedQuestionMessage(unresolvedText))
  ]
  const score = Math.round(checks.reduce((total, item) => total + item.score, 0))
  return {
    generatedAt: new Date().toISOString(),
    brainDir,
    score,
    maxScore: 100,
    status: score >= 75 ? 'pass' : score >= 50 ? 'warn' : 'fail',
    checks
  }
}

function ratioCheck(id: string, label: string, workflows: BrainWorkflow[], predicate: (workflow: BrainWorkflow) => boolean, maxScore: number): BrainQualityCheck {
  if (workflows.length === 0) {
    return check(id, label, 0, maxScore, 'warn', 'No workflows compiled yet.')
  }
  const passing = workflows.filter(predicate).length
  const ratio = passing / workflows.length
  const score = Math.round(maxScore * ratio)
  return check(id, label, score, maxScore, ratio >= 0.8 ? 'pass' : ratio >= 0.5 ? 'warn' : 'fail', `${passing}/${workflows.length} workflows satisfy this check.`)
}

function unresolvedQuestionScore(text: string): number {
  const count = text.split(/\r?\n/).filter((line) => /^-\s+/.test(line) && !/No unresolved/i.test(line)).length
  if (count <= 2) return 5
  if (count <= 6) return 3
  return 1
}

function unresolvedQuestionMessage(text: string): string {
  const count = text.split(/\r?\n/).filter((line) => /^-\s+/.test(line) && !/No unresolved/i.test(line)).length
  return `${count} unresolved question(s) found.`
}

function check(id: string, label: string, score: number, maxScore: number, status: BrainQualityCheck['status'], message: string): BrainQualityCheck {
  return { id, label, status, score, maxScore, message }
}

async function readOptional(path: string): Promise<string> {
  return (await pathExists(path)) ? readFile(path, 'utf8') : ''
}

function renderBrainQualityReport(report: BrainQualityReport): string {
  const rows = report.checks.map((item) => `| ${item.label} | ${item.status} | ${item.score}/${item.maxScore} | ${item.message} |`).join('\n')
  return `# Company Brain Quality

Company Brain Score: ${report.score}/100

Status: ${report.status}

| Check | Status | Score | Evidence |
|---|---|---:|---|
${rows}
`
}
