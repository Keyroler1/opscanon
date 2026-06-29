import { readFile } from 'node:fs/promises'
import { brainPaths, readBrainFacts, readBrainSources } from './io.js'
import type { BrainAnswer, BrainFact, BrainSourceRecord } from './types.js'
import { rankFacts } from './search.js'

export async function askBrain(brainDir: string, question: string): Promise<BrainAnswer> {
  const facts = await readBrainFacts(brainDir)
  const sources = await readBrainSources(brainDir)
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const ranked = rankFacts(facts, question).slice(0, 8)
  const citations = collectCitations(ranked, sourceById)
  const unresolvedQuestions = await readUnresolvedQuestions(brainDir)

  const answer = [
    `Question: ${question}`,
    '',
    ranked.length ? 'Source-cited answer:' : 'No compiled facts matched this question yet.',
    ...ranked.map((fact, index) => `${index + 1}. ${fact.claim} [${citationLabel(fact, sourceById)}]`),
    '',
    'Unresolved gaps:',
    ...unresolvedQuestions.slice(0, 5).map((gap) => `- ${gap}`)
  ].join('\n')

  return {
    question,
    answer,
    citations,
    unresolvedQuestions
  }
}

async function readUnresolvedQuestions(brainDir: string): Promise<string[]> {
  try {
    const content = await readFile(brainPaths(brainDir).unresolved, 'utf8')
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim())
  } catch {
    return ['Build the company brain before asking questions.']
  }
}

function collectCitations(facts: BrainFact[], sourceById: Map<string, BrainSourceRecord>): BrainAnswer['citations'] {
  const citations = new Map<string, BrainAnswer['citations'][number]>()
  for (const fact of facts) {
    for (const sourceId of fact.sourceIds) {
      const source = sourceById.get(sourceId)
      if (source) {
        citations.set(source.id, {
          id: source.id,
          title: source.title,
          path: source.path
        })
      }
    }
  }
  return [...citations.values()]
}

function citationLabel(fact: BrainFact, sourceById: Map<string, BrainSourceRecord>): string {
  return fact.sourceIds
    .map((sourceId) => sourceById.get(sourceId)?.title)
    .filter(Boolean)
    .join(', ') || 'unknown source'
}
