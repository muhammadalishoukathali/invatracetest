// Manual dev step (`npm run pack:assets`), not part of the dev/build pipeline.
// Takes the large binary assets that would otherwise sit as raw files in the
// repo (reference photos, logos, the ONNX model) and gzips + hex-encodes them
// into small text chunks under assets/runtime-packed/, one manifest.json plus
// a set of .hex part files. Git and GitHub handle text diffs of hex much
// better than they handle re-committing multi-megabyte binaries every time an
// asset changes, and it keeps the raw binaries out of git history entirely.
// restore-runtime-assets.mjs is the inverse of this and runs automatically
// before dev/build to put the real files back on disk.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packedRoot = join(projectRoot, 'assets', 'runtime-packed')
// Keep each part comfortably under common host file-size limits (e.g.
// Cloudflare Pages' 25 MiB cap) once hex-encoding roughly doubles it.
const packedPartBytes = 20 * 1024 * 1024

const digest = (value) => createHash('sha256').update(value).digest('hex')

// The reference photo set grows over time, so list it from disk rather than
// hardcoding filenames here.
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

// Compress and chunk each source file, recording checksums for every part
// and the whole so restore-runtime-assets.mjs can verify integrity later.
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
