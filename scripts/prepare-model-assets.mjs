// Runs as a "pre" hook before every dev server and build (predev,
// predev:https, predev:model-test, predev:real, prebuild in package.json).
// It restores the packed model/vendor assets, checks the ONNX model against
// the vendor kit's published checksum, then splits the verified model into
// chunks the app can serve from public/models/pulih-model1-v4/. Doing this on
// every run means the served model is always freshly re-verified against the
// vendor kit rather than trusting whatever was left in public/ from before.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kitRoot = join(projectRoot, 'vendor', 'PULIH_Model1_v4_FP16_Web_Kit')
const modelRoot = join(kitRoot, 'model')
const outputRoot = join(projectRoot, 'public', 'models', 'pulih-model1-v4')
const modelName = 'efficientnet_v2_s_oe_v4_31class_web_fp16.onnx'
// Same reasoning as the packing script: stay under Cloudflare Pages' static
// file size limit. The browser-side model loader reassembles these chunks.
const chunkBytes = 20 * 1024 * 1024

// Make sure the vendor kit files (including the model) actually exist on
// disk before we try to read them below. restore-runtime-assets.mjs
// unpacks them from assets/runtime-packed/ if they're missing or stale.
await restoreRuntimeAssets()

const checksumLines = (await readFile(join(kitRoot, 'checksums.sha256'), 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
const expectedLine = checksumLines.find((line) => line.endsWith(`model/${modelName}`))
if (!expectedLine) throw new Error(`Missing checksum for ${modelName}`)
const expectedSha256 = expectedLine.split(/\s+/)[0]

// Fail loudly rather than silently serving a corrupted or swapped-out model
// file. A bad model would fail quietly at inference time otherwise, giving
// wrong species predictions instead of an obvious build error.
const model = await readFile(join(modelRoot, modelName))
const actualSha256 = createHash('sha256').update(model).digest('hex')
if (actualSha256 !== expectedSha256) {
  throw new Error(`PULIH model checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`)
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const runtimeFiles = [
  'class_catalog.json',
  'inference_config.json',
  'open_set_rejection_config_v1.json',
  'species_31.json',
]
await Promise.all(runtimeFiles.map((name) => cp(join(modelRoot, name), join(outputRoot, name))))

const chunks = []
for (let offset = 0, index = 0; offset < model.length; offset += chunkBytes, index += 1) {
  const name = `${modelName}.part-${String(index).padStart(3, '0')}`
  const part = model.subarray(offset, Math.min(offset + chunkBytes, model.length))
  await writeFile(join(outputRoot, name), part)
  chunks.push({ name, bytes: part.length })
}

const runtimeManifest = {
  schemaVersion: 'invatrace.pulih-model-runtime.v1',
  modelVersion: 'oe_v4_31class_web_fp16',
  modelFile: modelName,
  sha256: actualSha256,
  bytes: model.length,
  chunks,
  sourceKit: relative(projectRoot, kitRoot),
}
await writeFile(
  join(outputRoot, 'runtime-manifest.json'),
  `${JSON.stringify(runtimeManifest, null, 2)}\n`,
)

console.log(`Prepared ${chunks.length} verified PULIH model chunks (${model.length} bytes).`)
