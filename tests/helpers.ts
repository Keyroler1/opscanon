import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

export async function makeTempDir(prefix: string): Promise<string> {
  const dir = join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(dir, { recursive: true })
  return dir
}

export async function copyFixture(name: string, target: string): Promise<string> {
  const source = join(process.cwd(), 'tests', 'fixtures', name)
  const destination = join(target, name)
  await cp(source, destination, { recursive: true })
  return destination
}

export async function listFiles(root: string): Promise<string[]> {
  const result: string[] = []

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else {
        result.push(relative(root, fullPath).replaceAll('\\', '/'))
      }
    }
  }

  if ((await stat(root)).isDirectory()) {
    await walk(root)
  }

  return result.sort()
}

export async function removeTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}
