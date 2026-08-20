import {
	CORE_JOINT_LANDMARK_INDEX,
	createReplayViewCoordinator,
	FOOT_JOINT_LANDMARK_INDEX,
	normalizeSkeletonToVisibleView,
	toSkeleton,
} from '../PoseDetector';
import { isSquatBodyInFrame } from '../../squats/squatMetrics';
import type { JointVisibility, Skeleton } from '../../types';

function skeletonAt(x: number, y: number): Skeleton {
	return Object.fromEntries(
		Object.keys(CORE_JOINT_LANDMARK_INDEX).map(joint => [joint, { x, y }]),
	) as unknown as Skeleton;
}

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

	it('recovers visible view dimensions from centered cover cropping', () => {
		const results = { inputImageWidth: 720, inputImageHeight: 1280 } as never;
		const coordinator = {
			getFrameDims: () => ({ width: 720, height: 1280 }),
			convertPoint: (_dims: unknown, point: { x: number; y: number }) => ({
				x: -42.375 + point.x * 474.75,
				y: point.y * 844,
			}),
		};
		const visible = normalizeSkeletonToVisibleView(
			skeletonAt(195, 422),
			results,
			coordinator as never,
		);

		expect(visible?.leftHip).toEqual({ x: 0.5, y: 0.5 });
	});

	it('recovers the same view after rotated and mirrored corner mapping', () => {
		const coordinator = {
			getFrameDims: () => ({ width: 1280, height: 720 }),
			convertPoint: (_dims: unknown, point: { x: number; y: number }) => ({
				x: 432.375 - point.y * 474.75,
				y: (1 - point.x) * 844,
			}),
		};
		const visible = normalizeSkeletonToVisibleView(
			skeletonAt(195, 422),
			{ inputImageWidth: 720, inputImageHeight: 1280 } as never,
			coordinator as never,
		);

		expect(visible?.rightKnee).toEqual({ x: 0.5, y: 0.5 });
	});

	it('rejects a sensor-valid joint after cover cropping moves it offscreen', () => {
		const raw = skeletonAt(0.5, 0.5);
		raw.leftAnkle = { x: 0.07, y: 0.5 };
		const visibility = Object.fromEntries(
			Object.keys(CORE_JOINT_LANDMARK_INDEX).map(joint => [joint, 1]),
		) as JointVisibility;
		const coordinator = {
			getFrameDims: () => ({ width: 720, height: 1280 }),
			convertPoint: (_dims: unknown, point: { x: number; y: number }) => ({
				x: -42.375 + point.x * 474.75,
				y: point.y * 844,
			}),
		};
		const rendered = {} as Skeleton;
		for (const joint of Object.keys(CORE_JOINT_LANDMARK_INDEX) as (keyof Skeleton)[]) {
			rendered[joint] = coordinator.convertPoint({}, raw[joint]);
		}
		const visible = normalizeSkeletonToVisibleView(
			rendered,
			{ inputImageWidth: 720, inputImageHeight: 1280 } as never,
			coordinator as never,
		);

		expect(isSquatBodyInFrame(raw, visibility, false, 0.5)).toBe(true);
		expect(visible).not.toBeNull();
		expect(isSquatBodyInFrame(visible!, visibility, false, 0.5)).toBe(false);
	});

	it('keeps a raw-valid pose visible through replay contain letterboxing', () => {
		const raw = skeletonAt(0.07, 0.07);
		const visibility = Object.fromEntries(
			Object.keys(CORE_JOINT_LANDMARK_INDEX).map(joint => [joint, 1]),
		) as JointVisibility;
		const coordinator = createReplayViewCoordinator(390, 844);
		const results = { inputImageWidth: 1080, inputImageHeight: 1920 } as never;
		const dims = coordinator.getFrameDims(results);
		const rendered = {} as Skeleton;
		for (const joint of Object.keys(CORE_JOINT_LANDMARK_INDEX) as (keyof Skeleton)[]) {
			rendered[joint] = coordinator.convertPoint(dims, raw[joint]);
		}
		const visible = normalizeSkeletonToVisibleView(rendered, results, coordinator);

		expect(visible).not.toBeNull();
		expect(isSquatBodyInFrame(raw, visibility, false, 0.5)).toBe(true);
		expect(isSquatBodyInFrame(visible!, visibility, false, 0.5)).toBe(true);
	});
});
