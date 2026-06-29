export function stripMarkdownFrontmatter(content: string): string {
  const normalized = content.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? normalized.slice(match[0].length) : content
}
