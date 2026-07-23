const fs = require('node:fs/promises');
const path = require('node:path');
const { IOSConfig, withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const MODEL_FILE = 'pose_landmarker_full.task';
const MODEL_SOURCE = path.join('models', MODEL_FILE);

function withMediapipeModel(config) {
  config = withXcodeProject(config, config => {
    const project = config.modResults;
    const modelPath = path.relative(config.modRequest.platformProjectRoot, path.join(config.modRequest.projectRoot, MODEL_SOURCE));

    IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'Resources');
    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: modelPath,
      groupName: 'Resources',
      project,
      isBuildFile: true,
      verbose: true,
    });

    return config;
  });

  config = withDangerousMod(config, [
    'android',
    async config => {
      const source = path.join(config.modRequest.projectRoot, MODEL_SOURCE);
      const target = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', MODEL_FILE);

      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);

      return config;
    },
  ]);

  return config;
}

module.exports = withMediapipeModel;
