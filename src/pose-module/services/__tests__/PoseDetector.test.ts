import {
	CORE_JOINT_LANDMARK_INDEX,
	createReplayViewCoordinator,
	FOOT_JOINT_LANDMARK_INDEX,
	toSkeleton,
} from '../PoseDetector';

describe('PoseDetector lower-foot mapping', () => {
	it('keeps the MediaPipe lower-foot indices explicit', () => {
		expect(CORE_JOINT_LANDMARK_INDEX.leftAnkle).toBe(27);
		expect(CORE_JOINT_LANDMARK_INDEX.rightAnkle).toBe(28);
		expect(FOOT_JOINT_LANDMARK_INDEX).toEqual({
			leftHeel: 29,
			rightHeel: 30,
			leftFootIndex: 31,
			rightFootIndex: 32,
		});
	});

	it('places foot coordinates, confidence, and world values beside the rendered skeleton', () => {
		const landmarks = Array.from({ length: 33 }, (_, index) => ({
			x: index / 100,
			y: index / 50,
			z: -index / 1000,
			visibility: index === 31 ? 0.8 : 0.9,
		}));
		const result = {
			results: [{ landmarks: [landmarks], worldLandmarks: [landmarks] }],
		};
		const coordinator = {
			getFrameDims: () => ({ width: 100, height: 100 }),
			convertPoint: (_dims: unknown, landmark: { x: number; y: number }) => ({ x: landmark.x * 100, y: landmark.y * 100 }),
		};

		const frame = toSkeleton(result as never, coordinator as never);

		expect(frame?.skeleton.leftAnkle).toEqual({ x: 27, y: 54 });
		expect(frame?.feet?.skeleton.leftHeel.x).toBeCloseTo(29);
		expect(frame?.feet?.skeleton.leftHeel.y).toBeCloseTo(58);
		expect(frame?.feet?.skeleton.rightFootIndex).toEqual({ x: 32, y: 64 });
		expect(frame?.feet?.visibility.leftFootIndex).toBe(0.8);
		expect(frame?.feet?.world?.rightHeel).toEqual({ x: 0.3, y: 0.6, z: -0.03 });
	});

	it('letterboxes replay landmarks with the same contain geometry as the video player', () => {
		const coordinator = createReplayViewCoordinator(390, 844);
		const dims = coordinator.getFrameDims({ inputImageWidth: 1080, inputImageHeight: 1920 } as never);
		const center = coordinator.convertPoint(dims, { x: 0.5, y: 0.5 });

		expect(dims).toEqual({ width: 1080, height: 1920 });
		expect(center.x).toBeCloseTo(195);
		expect(center.y).toBeCloseTo(422);
	});
});
