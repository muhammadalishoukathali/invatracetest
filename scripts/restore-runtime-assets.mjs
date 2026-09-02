import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Inverse of pack-runtime-assets.mjs: reads assets/runtime-packed/manifest.json
// and rebuilds the original binary files (logos, reference photos, the ONNX
// model) on disk. Not invoked directly by any package.json script, instead
// prepare-model-assets.mjs imports restoreRuntimeAssets() and runs it before
// every dev server start and build. It can also be run standalone with
// `node scripts/restore-runtime-assets.mjs` for debugging or manual restores.
const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = resolve(dirname(scriptPath), '..')
const manifestPath = resolve(projectRoot, 'assets', 'runtime-packed', 'manifest.json')

const digest = (value) => createHash('sha256').update(value).digest('hex')

// Guards against a manifest entry pointing outside the project (e.g. via
// `../../` path traversal) writing files somewhere it shouldn't.
function resolveInside(root, relativePath, label) {
  if (isAbsolute(relativePath)) throw new Error(`${label} must be relative: ${relativePath}`)
  const resolved = resolve(root, relativePath)
  const relation = relative(root, resolved)
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} leaves its allowed root: ${relativePath}`)
  }
  return resolved
}

// Lets restoreRuntimeAssets skip files that are already correct on disk
// instead of re-decompressing everything on every dev/build run.
async function matchesExpectedFile(path, expectedBytes, expectedSha256) {
  try {
    const value = await readFile(path)
    return value.length === expectedBytes && digest(value) === expectedSha256
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false
    throw error
  }
}

// Verifies and, if needed, rebuilds every asset listed in the packed
// manifest. outputRoot is overridable so tests or CI can restore into a
// scratch directory instead of the real project tree.
export async function restoreRuntimeAssets({ outputRoot = projectRoot } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 'invatrace.runtime-packed.v1' || !Array.isArray(manifest.assets)) {
    throw new Error('Unsupported runtime asset manifest.')
  }

  let restored = 0
  for (const asset of manifest.assets) {
    if (asset.compression !== 'gzip' || asset.encoding !== 'hex' || !Array.isArray(asset.parts)) {
      throw new Error(`Unsupported packing settings for ${asset.output}`)
    }

    const outputPath = resolveInside(outputRoot, asset.output, 'Runtime output path')
    if (await matchesExpectedFile(outputPath, asset.bytes, asset.sha256)) continue

    const compressedParts = []
    for (const part of asset.parts) {
      const packedPath = resolveInside(projectRoot, part.path, 'Packed asset path')
      const encoded = (await readFile(packedPath, 'ascii')).trim()
      if (encoded.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(encoded)) {
        throw new Error(`Packed asset is not valid hexadecimal text: ${part.path}`)
      }
      const compressedPart = Buffer.from(encoded, 'hex')
      if (compressedPart.length !== part.bytes || digest(compressedPart) !== part.sha256) {
        throw new Error(`Packed asset checksum mismatch: ${part.path}`)
      }
      compressedParts.push(compressedPart)
    }

    const value = gunzipSync(Buffer.concat(compressedParts))
    if (value.length !== asset.bytes || digest(value) !== asset.sha256) {
      throw new Error(`Restored asset checksum mismatch: ${asset.output}`)
    }

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, value)
    restored += 1
  }

  console.log(`Verified ${manifest.assets.length} runtime assets; restored ${restored}.`)
}

// Only run automatically when this file is executed directly (not when it's
// imported by prepare-model-assets.mjs), so importing it never has side effects.
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const outputFlag = process.argv.indexOf('--output-root')
  if (outputFlag !== -1 && !process.argv[outputFlag + 1]) {
    throw new Error('--output-root requires a path.')
  }
  const outputRoot = outputFlag === -1 ? projectRoot : resolve(process.argv[outputFlag + 1])
  await restoreRuntimeAssets({ outputRoot })
}
