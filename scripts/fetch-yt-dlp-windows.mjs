import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '../resources')
const file = join(dir, 'yt-dlp.exe')
const version = '2026.10.26'
const digest = 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const local = await readFile(file).catch((error) => {
  if (error.code !== 'ENOENT') throw error
})
if (!local || sha256(local) !== digest) {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/yt-dlp.exe`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`yt-dlp download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== digest) throw new Error('yt-dlp.exe SHA-256 mismatch')
  await mkdir(dir, { recursive: true })
  await writeFile(file, bytes)
}
console.log(`yt-dlp.exe ${version} verified: ${digest}`)
