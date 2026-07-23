import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type DevicePowerState, getDeviceProfile, getDevicePowerState } from '@/src/helpers/deviceProfile';
import { resolveDeviceTier, resolveStaticDeviceTier } from '@/src/helpers/deviceTier';
import type { DebugInfo } from '@/src/pose-module/types';
import { palette } from '@/src/theme';

const POWER_POLL_MS = 5000;

export interface DevicePerformancePanelProps {
	info: DebugInfo | null;
	onExportLog: () => void;
	testID?: string;
	exportTestID?: string;
}

interface MetricRowProps {
	label: string;
	measure: string;
	note?: string;
}

const MetricRow = ({ label, measure, note }: MetricRowProps) => (
	<View style={styles.row}>
		<Text style={styles.bullet}>{'•'}</Text>
		<Text style={styles.rowText}>
			{label}: <Text style={styles.measure}>{measure}</Text>
			{note}
		</Text>
	</View>
);

const formatRam = (ramGb: number | null): string => (ramGb === null ? '—' : `${ramGb.toFixed(1)} GB`);

const formatLowRam = (isLowRamDevice: boolean | null): string =>
	isLowRamDevice === null ? 'n/a (Android only)' : String(isLowRamDevice);

const formatBattery = ({ batteryLevel, batteryState, lowPowerMode }: DevicePowerState): string => {
	const level = batteryLevel === null || batteryLevel < 0 ? '—' : `${Math.round(batteryLevel * 100)}%`;
	const state = batteryState ?? 'unknown';
	const lowPower = lowPowerMode === null ? 'unknown' : lowPowerMode ? 'on' : 'off';
	return `${level} · ${state} · low power ${lowPower}`;
};

/**
 * Device hardware + live CV performance profile with the computed device tier.
 * Page 2 of the recorder debug HUD; the caller owns the tap-to-toggle wrapper
 * and gates the whole HUD on `isDevEnvironment`.
 */
export function DevicePerformancePanel({ info, onExportLog, testID, exportTestID }: DevicePerformancePanelProps) {
	const profile = getDeviceProfile();
	const [power, setPower] = useState<DevicePowerState>(getDevicePowerState);

	useEffect(() => {
		const timerId = setInterval(() => setPower(getDevicePowerState()), POWER_POLL_MS);
		return () => clearInterval(timerId);
	}, []);

	const perf = info?.perf ?? null;
	const staticInput = { ramGb: profile.ramGb, isLowRamDevice: profile.isLowRamDevice };
	const staticTier = resolveStaticDeviceTier(staticInput);
	const tier = resolveDeviceTier(
		staticInput,
		perf === null
			? null
			: { inferenceP95Ms: perf.inferenceP95Ms, cvFps: perf.cvFps, sampleCount: perf.sampleCount },
	);

	return (
		<View testID={testID} style={styles.container}>
			<Text style={styles.section}>Device</Text>
			<MetricRow label="model" measure={profile.modelName} note={` (${profile.brand} · ${profile.modelId})`} />
			<MetricRow label="soc" measure={profile.soc} />
			<MetricRow label="ram" measure={formatRam(profile.ramGb)} note={` · lowRam ${formatLowRam(profile.isLowRamDevice)}`} />
			<MetricRow label="battery" measure={formatBattery(power)} />
			<MetricRow label="thermal" measure="unavailable" note=" (needs native module)" />

			<Text style={styles.section}>CV performance</Text>
			{perf === null && <Text style={styles.rowText}>No frames sampled yet</Text>}
			{perf !== null && (
				<>
					<MetricRow
						label="inference"
						measure={`${perf.inferenceAvgMs.toFixed(0)} ms avg`}
						note={` · p95 ${perf.inferenceP95Ms.toFixed(0)} ms · ${perf.sampleCount} frames`}
					/>
					<MetricRow
						label="cv fps"
						measure={`${perf.cvFps.toFixed(0)} / ${perf.targetFps} fps`}
						note=" (nominal target)"
					/>
					<MetricRow
						label="dropped"
						measure={`${perf.droppedPct.toFixed(0)}%`}
						note=" (derived from nominal target, not counted)"
					/>
				</>
			)}

			<Text style={styles.section}>Tier</Text>
			<MetricRow label="tier" measure={tier.tier} note={` (${tier.reason})`} />
			<MetricRow label="source" measure={tier.source} note={` · static ${staticTier.tier}`} />

			<Pressable testID={exportTestID} style={styles.exportButton} onPress={onExportLog}>
				<Text style={styles.exportText}>Export session log</Text>
			</Pressable>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		backgroundColor: 'rgba(0,0,0,0.5)',
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.2)',
		borderRadius: 10,
		padding: 14,
	},
	section: {
		color: 'rgba(255,255,255,0.85)',
		fontSize: 10,
		fontWeight: '700',
		textTransform: 'uppercase',
		marginTop: 6,
		marginBottom: 1,
	},
	row: {
		flexDirection: 'row',
	},
	bullet: {
		color: '#fff',
		fontSize: 12,
		lineHeight: 17,
		width: 12,
	},
	rowText: {
		flex: 1,
		color: '#fff',
		fontSize: 12,
		lineHeight: 17,
		letterSpacing: -0.24,
	},
	measure: {
		color: palette.orange.tangerineTango,
		fontWeight: '900',
	},
	exportButton: {
		marginTop: 10,
		alignSelf: 'flex-start',
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: 'rgba(255,255,255,0.35)',
	},
	exportText: {
		color: '#fff',
		fontSize: 11,
		fontWeight: '700',
	},
});
