import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packedRoot = join(projectRoot, 'assets', 'runtime-packed')
const packedPartBytes = 20 * 1024 * 1024

const digest = (value) => createHash('sha256').update(value).digest('hex')

const referenceRoot = join(projectRoot, 'public', 'reference-images')
const referenceImages = (await readdir(referenceRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && ['.jpg', '.jpeg', '.png'].includes(extname(entry.name).toLowerCase()))
  .map((entry) => `public/reference-images/${entry.name}`)
  .sort()

const sourcePaths = [
  'public/invatrace-logo-192.png',
  'public/invatrace-logo-512.png',
  ...referenceImages,
  'vendor/PULIH_Model1_v4_FP16_Web_Kit/model/efficientnet_v2_s_oe_v4_31class_web_fp16.onnx',
]

await rm(packedRoot, { recursive: true, force: true })

const assets = []
for (const sourcePath of sourcePaths) {
  const source = await readFile(join(projectRoot, sourcePath))
  const compressed = gzipSync(source, { level: 9, mtime: 0 })
  const parts = []

  for (let offset = 0, index = 0; offset < compressed.length; offset += packedPartBytes, index += 1) {
    const part = compressed.subarray(offset, Math.min(offset + packedPartBytes, compressed.length))
    const partPath = `assets/runtime-packed/${sourcePath}.gz.part-${String(index).padStart(3, '0')}.hex`
    const absolutePartPath = join(projectRoot, partPath)
    await mkdir(dirname(absolutePartPath), { recursive: true })
    await writeFile(absolutePartPath, `${part.toString('hex')}\n`, 'ascii')
    parts.push({
      path: partPath,
      bytes: part.length,
      sha256: digest(part),
    })
  }

  assets.push({
    output: sourcePath,
    bytes: source.length,
    sha256: digest(source),
    compression: 'gzip',
    encoding: 'hex',
    parts,
  })
}

const manifest = {
  schemaVersion: 'invatrace.runtime-packed.v1',
  assets,
}
await writeFile(
  join(packedRoot, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)

const packedBytes = assets.flatMap((asset) => asset.parts).reduce((total, part) => total + part.bytes, 0)
console.log(
  `Packed ${assets.length} runtime assets (${sourcePaths.length} sources, ${packedBytes} compressed bytes) in ${relative(projectRoot, packedRoot)}.`,
)
