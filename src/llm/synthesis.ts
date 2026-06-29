import type { AuditReport } from '../types.js'

interface ResponsesApiResult {
  output_text?: string
  output?: Array<{
    content?: Array<{
      text?: string
    }>
  }>
}

export async function synthesizeAgentReadinessNotes(
  report: AuditReport,
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return undefined
  }

  const model = env.AI_REPO_READINESS_OPENAI_MODEL ?? 'gpt-4.1-mini'
  const prompt = [
    'You are helping improve a software repository for AI coding agents.',
    'Summarize the most important OpsCanon repo readiness fixes in under 180 words.',
    'Do not include secrets, credentials, or token values.',
    '',
    JSON.stringify({
      score: report.overallScore,
      categories: Object.fromEntries(Object.entries(report.categories).map(([key, value]) => [key, value.score])),
      topFixes: report.topFixes.map((fix) => ({
        title: fix.title,
        severity: fix.severity,
        recommendation: fix.recommendation
      }))
    })
  ].join('\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: prompt
    })
  })

  if (!response.ok) {
    return undefined
  }

  const data = (await response.json()) as ResponsesApiResult
  return extractText(data)?.trim()
}

function extractText(data: ResponsesApiResult): string | undefined {
  if (data.output_text) {
    return data.output_text
  }

  return data.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .filter((text): text is string => Boolean(text))
    .join('\n')
}
