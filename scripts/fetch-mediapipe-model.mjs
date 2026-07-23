import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';
const output = resolve('models/pose_landmarker_full.task');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (await exists(output)) {
  console.log(`Model already exists: ${output}`);
  process.exit(0);
}

await mkdir(dirname(output), { recursive: true });

console.log(`Downloading ${modelUrl}`);
const response = await fetch(modelUrl);
if (!response.ok || !response.body) {
  throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
}

await pipeline(response.body, createWriteStream(output));
console.log(`Saved ${output}`);
