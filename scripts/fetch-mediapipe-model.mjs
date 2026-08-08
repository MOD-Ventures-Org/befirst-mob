import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const tier = process.argv[2] ?? 'full';
if (!['lite', 'full', 'heavy'].includes(tier)) {
  throw new Error(`Unknown pose model tier: ${tier}. Use lite, full, or heavy.`);
}

const filename = `pose_landmarker_${tier}.task`;
const modelUrl = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${tier}/float16/latest/${filename}`;
const output = resolve('models', filename);
// Heavy is a developer benchmark asset. Keeping it in Android's debug source
// set prevents release bundles from growing by the extra model size.
const androidOutput = resolve(tier === 'heavy' ? 'android/app/src/debug/assets' : 'android/app/src/main/assets', filename);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(output))) {
  await mkdir(dirname(output), { recursive: true });

  console.log(`Downloading ${modelUrl}`);
  const response = await fetch(modelUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download model: ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(output));
  console.log(`Saved ${output}`);
} else {
  console.log(`Model already exists: ${output}`);
}

// Android packages the selected source-set asset. iOS's Debug-only Xcode copy
// phase reads the same models/ path, so both benchmark builds load this file.
await mkdir(dirname(androidOutput), { recursive: true });
await copyFile(output, androidOutput);
console.log(`Bundled Android asset: ${androidOutput}`);
