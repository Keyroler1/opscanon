import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  'target',
  'vendor',
  '.venv',
  '__pycache__'
])

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.yaml',
  '.yml',
  '.toml',
  '.txt',
  '.py',
  '.sh',
  '.env',
  '.example',
  '.sample'
])

export interface FileEntry {
  absolutePath: string
  relativePath: string
  name: string
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function walkFiles(rootPath: string): Promise<FileEntry[]> {
  const files: FileEntry[] = []

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(absolutePath)
        }
        continue
      }

      if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: relative(rootPath, absolutePath).replaceAll('\\', '/'),
          name: entry.name
        })
      }
    }
  }

  await walk(rootPath)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

export function isTextFile(path: string): boolean {
  const lower = path.toLowerCase()
  if (basename(lower).startsWith('.env')) {
    return true
  }

  return [...TEXT_EXTENSIONS].some((extension) => lower.endsWith(extension))
}

export async function readTextFile(path: string, maxBytes = 1_000_000): Promise<string> {
  const fileStat = await stat(path)
  if (fileStat.size > maxBytes) {
    return ''
  }

  return readFile(path, 'utf8')
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}
