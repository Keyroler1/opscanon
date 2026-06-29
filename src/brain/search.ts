import type { BrainFact, BrainSearchResult, BrainSourceRecord } from './types.js'

export function rankFacts(facts: BrainFact[], query: string): BrainFact[] {
  const terms = tokenize(query)
  return facts
    .map((fact) => ({ fact, score: scoreFact(fact, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.fact.claim.localeCompare(b.fact.claim))
    .map((entry) => entry.fact)
}

export function factToSearchResult(fact: BrainFact, sources: BrainSourceRecord[]): BrainSearchResult {
  const sourceIds = new Set(fact.sourceIds)
  const source = sources.find((candidate) => sourceIds.has(candidate.id))
  return {
    id: fact.id,
    title: titleForClaim(fact.claim),
    url: source ? `file://${source.path}` : `brain://facts/${fact.id}`,
    text: fact.claim,
    metadata: {
      category: fact.category,
      sourceIds: fact.sourceIds,
      subjects: fact.subjects
    }
  }
}

export function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])]
}

function scoreFact(fact: BrainFact, terms: string[]): number {
  const haystack = `${fact.claim} ${fact.category} ${fact.subjects.join(' ')}`.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length > 5 ? 3 : 1
    }
  }
  if (fact.category === 'policy' || fact.category === 'decision') {
    score += 1
  }
  return score
}

function titleForClaim(claim: string): string {
  const compact = claim.replace(/^(decision|reason|owner|customers?)\s*:\s*/i, '').trim()
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact
}
