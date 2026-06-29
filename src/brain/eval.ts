import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathExists } from '../utils/files.js'
import {
  readBrainSources,
  readBrainWorkflowIndex
} from './io.js'
import type { BrainEvalCheck, BrainEvalReport } from './types.js'

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{16,}\b/,
  /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*[^ \n\r]+/i
]

export async function writeBrainEvalReport(brainDir: string): Promise<BrainEvalReport> {
  const report = await evaluateBrain(brainDir)
  await writeFile(join(brainDir, 'brain-eval-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(join(brainDir, 'brain-eval-report.md'), renderBrainEvalReport(report), 'utf8')
  return report
}

export async function evaluateBrain(brainDir: string): Promise<BrainEvalReport> {
  const sources = await readBrainSources(brainDir)
  const workflows = (await readBrainWorkflowIndex(brainDir)).workflows
  const skillsDir = join(brainDir, 'skills')
  const skillNames = await listSkillNames(skillsDir)
  const skillTexts = await Promise.all(skillNames.map((name) => readFile(join(skillsDir, name), 'utf8')))
  const unresolved = await readOptional(join(brainDir, 'unresolved-questions.md'))
  const actionBoundaries = await readOptional(join(brainDir, 'action-boundaries.md'))
  const generatedText = [
    ...sources.map((source) => source.content),
    ...skillTexts,
    unresolved,
    actionBoundaries
  ].join('\n')

  const checks: BrainEvalCheck[] = [
    check('source-citations', 'Source citations', workflows.every((workflow) => workflow.sourceIds.length > 0), `${workflows.length} workflow(s) include source IDs.`),
    check('secret-redaction', 'Secret redaction', !SECRET_PATTERNS.some((pattern) => pattern.test(generatedText)), 'Generated brain artifacts do not contain obvious secret patterns.'),
    check('approval-boundaries', 'Approval boundaries', /Requires Human Approval/i.test(actionBoundaries), 'Action boundary report includes approval-gated section.'),
    check('unknown-handling', 'Unknown handling', /Unresolved Questions/i.test(unresolved), 'Unresolved questions artifact exists.'),
    check('skill-contracts', 'Skill contracts', skillTexts.filter((text) => /## Stop Conditions/i.test(text) && /## Output Format/i.test(text)).length >= Math.max(0, workflows.length), 'Workflow skills include stop conditions and output format.'),
    check('metadata-skill-filter', 'Metadata skill filter', !skillNames.some((name) => /^(original-path|detected-owner|output-)/.test(name)), 'No metadata-derived workflow skills were generated.')
  ]
  const failed = checks.some((item) => item.status === 'fail')
  const warned = checks.some((item) => item.status === 'warn')
  return {
    generatedAt: new Date().toISOString(),
    brainDir,
    status: failed ? 'fail' : warned ? 'warn' : 'pass',
    checks
  }
}

function check(id: string, label: string, passed: boolean, message: string): BrainEvalCheck {
  return {
    id,
    label,
    status: passed ? 'pass' : 'fail',
    message
  }
}

async function listSkillNames(skillsDir: string): Promise<string[]> {
  if (!(await pathExists(skillsDir))) {
    return []
  }
  return (await readdir(skillsDir)).filter((name) => name.endsWith('.md')).sort()
}

async function readOptional(path: string): Promise<string> {
  return (await pathExists(path)) ? readFile(path, 'utf8') : ''
}

function renderBrainEvalReport(report: BrainEvalReport): string {
  const rows = report.checks.map((item) => `| ${item.label} | ${item.status} | ${item.message} |`).join('\n')
  return `# Company Brain Eval

Status: ${report.status}

| Check | Status | Evidence |
|---|---|---|
${rows}
`
}
