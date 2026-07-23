# Running This Pose Module In Expo

This folder is now set up as a minimal Expo development-build app around the
existing `src/pose-module` code.

## Why a development build

This module uses native camera/frame-processor code through
`react-native-mediapipe`, `react-native-vision-camera`, Skia, Reanimated, and
Worklets. It will not run in plain Expo Go. Build a dev client instead.

## First run

```bash
pnpm install
pnpm run fetch:model
pnpm ios
```

For Android:

```bash
pnpm install
pnpm run fetch:model
pnpm android
```

After the dev build is installed once, start Metro with:

```bash
pnpm start
```

## Required model

The pose detector expects this file:

```text
models/pose_landmarker_full.task
```

`pnpm run fetch:model` downloads the official MediaPipe full pose-landmarker
bundle to that path.

The app passes `pose_landmarker_full.task` to the native MediaPipe module. On
iOS the file must be present in Copy Bundle Resources; on Android it must be in
`android/app/src/main/assets`. The local Expo config plugin
`plugins/with-mediapipe-model.js` keeps those native resources in sync when
prebuilding.

## Notes

- Use a physical device. Camera pose tracking is not useful on the iOS simulator
  and is unreliable on emulators.
- If Expo complains about Node 25, switch to Node 22 LTS for this project.
- The mini-game screens reference image/audio/font assets that were not included
  in the extracted source. The shell app intentionally mounts only the core
  push-up tracker.
- The public `react-native-mediapipe` package is old. If native build errors
  appear there, the original app may have used a private fork of that package.
