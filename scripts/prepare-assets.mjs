import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const source = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
const wasmSource = 'node_modules/@mediapipe/tasks-vision/wasm'
const wasmDestination = 'public/wasm'
const modelDestination = 'public/models/pose_landmarker_full.task'

await mkdir(wasmDestination, { recursive: true })
await mkdir('public/models', { recursive: true })
for (const name of await readdir(wasmSource)) {
  await copyFile(join(wasmSource, name), join(wasmDestination, name))
}

let existing = false
try {
  existing = (await stat(modelDestination)).size > 1_000_000
} catch {
  // First setup downloads the official model.
}
if (!existing) {
  const response = await fetch(source)
  if (!response.ok) throw new Error(`Official model download failed: HTTP ${response.status}`)
  await writeFile(modelDestination, Buffer.from(await response.arrayBuffer()))
}
console.log('MediaPipe WASM and official Pose Landmarker Full model are ready in public/.')
