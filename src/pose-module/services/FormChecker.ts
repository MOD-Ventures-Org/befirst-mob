import type { ExerciseConfig, FormViolation, JointAngles, JointStatus, Phase, Skeleton } from '../types';

// All joint keys from the Skeleton interface - used to build the default status map.
const SKELETON_JOINTS: (keyof Skeleton)[] = [
	'nose',
	'leftEye',
	'rightEye',
	'leftEar',
	'rightEar',
	'leftShoulder',
	'rightShoulder',
	'leftElbow',
	'rightElbow',
	'leftWrist',
	'rightWrist',
	'leftHip',
	'rightHip',
	'leftKnee',
	'rightKnee',
	'leftAnkle',
	'rightAnkle',
];

function buildDefaultJointStatus(): JointStatus {
	return Object.fromEntries(SKELETON_JOINTS.map(k => [k, 'inactive'])) as JointStatus;
}

export interface FormCheckResult {
	violations: FormViolation[];
	passedCodes: Set<string>; // Codes of rules that PASSED this frame
	jointStatus: JointStatus;
}

export class FormChecker {
	constructor(private config: ExerciseConfig) {}

	evaluate(phase: Phase, angles: JointAngles, skeleton: Skeleton): FormCheckResult {
		const activeRules = this.config.formRules.filter(r => r.activePhases.includes(phase));

		const violations: FormViolation[] = [];
		const jointStatus = buildDefaultJointStatus();
		const passedCodes = new Set<string>();

		for (const rule of activeRules) {
			const passing = rule.check(angles, skeleton);

			for (const joint of rule.joints) {
				if (!passing) {
					// A failing rule always marks the joint red
					jointStatus[joint] = 'fail';
				} else if (jointStatus[joint] === 'inactive') {
					// Only promote to pass if nothing has already failed this joint
					jointStatus[joint] = 'pass';
				}
			}

			if (!passing) {
				violations.push({
					code: rule.code,
					joints: rule.joints,
					phase,
					isCritical: rule.isCritical,
				});
			} else {
				passedCodes.add(rule.code);
			}
		}
		return { violations, passedCodes, jointStatus };
	}
}
