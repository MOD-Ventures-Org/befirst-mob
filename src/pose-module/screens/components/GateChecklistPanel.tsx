import { StyleSheet, Text, View } from 'react-native';

import type { DebugInfo } from '@/src/pose-module/types';
import { palette } from '@/src/theme';

export interface GateChecklistPanelProps {
	info: DebugInfo | null;
	testID?: string;
}

interface CheckRowProps {
	label: string;
	value: string;
	ok: boolean;
}

// Splits a preformatted GateCheck value into the plain part and the leading
// measurement, so numbers get the orange treatment while units/thresholds stay
// white — e.g. "119° (need ≥160°)" -> "119°" + " (need ≥160°)".
const splitMeasurement = (value: string): { measure: string; rest: string } => {
	const match = value.match(/^(-?\d[\d.,]*\s*[%°]?(?:×SW)?)(.*)$/);
	if (!match) return { measure: '', rest: value };
	return { measure: match[1], rest: match[2] };
};

const CheckRow = ({ label, value, ok }: CheckRowProps) => {
	const isYesNo = value.startsWith('Yes') || value.startsWith('No');
	const { measure, rest } = isYesNo ? { measure: '', rest: value } : splitMeasurement(value);

	return (
		<View style={styles.row}>
			<Text style={styles.bullet}>{'•'}</Text>
			<Text style={styles.rowText}>
				{label}: {measure.length > 0 && <Text style={styles.measure}>{measure}</Text>}
				{rest} {ok ? '✅' : '❌'}
			</Text>
		</View>
	);
};

const formatNumber = (value: number | null | undefined, digits: number): string =>
	value === null || value === undefined ? '—' : value.toFixed(digits);

// Rep position is 1 at the top of the push-up, so depth is its complement: how
// far down the athlete currently is through their own calibrated range.
const formatDepthPercent = (position: number | null | undefined): string =>
	position === null || position === undefined ? '—' : `${Math.round((1 - position) * 100)}%`;

/**
 * Live pose-diagnostics HUD for the AI push-up trainer (recorder screen): every
 * standing, top-position, and counting-signal condition with its current value
 * and a pass/fail mark, plus the raw session telemetry the pipeline produces.
 * Diagnostics only — none of these conditions gate counting.
 *
 * Dev app only; the caller gates it on `isDevEnvironment` and owns the HUD
 * position and page toggling. The Pyramid screen keeps the classic DebugPanel.
 */
export function GateChecklistPanel({ info, testID }: GateChecklistPanelProps) {
	const checks = info?.gateChecks;

	return (
		<View testID={testID} style={styles.container}>
			<Text style={styles.summary}>
				reps <Text style={styles.measure}>{info?.repCount ?? 0}</Text> · counting{' '}
				{info?.counting ? '✅' : '❌'} · {info?.phase ?? '—'} · {info?.coach ?? '—'} · {info?.tier ?? '—'}
			</Text>
			<Text style={styles.summary}>
				depth <Text style={styles.measure}>{formatDepthPercent(info?.position)}</Text> ·{' '}
				{formatNumber(info?.depth, 2)}sw · conf {formatNumber(info?.conf, 2)}/{formatNumber(info?.minConf, 2)} ·{' '}
				{formatNumber(info?.fps, 0)} fps · {formatNumber(info?.inferenceMs, 0)} ms · miss{' '}
				{info?.missingFrames ?? 0}
			</Text>

			{!info?.landmarksDetected && <Text style={styles.rowText}>No body detected</Text>}

			{checks && (
				<>
					<Text style={styles.section}>Ready check (standing)</Text>
					{checks.standing.map(check => (
						<CheckRow key={check.label} {...check} />
					))}
					<Text style={styles.section}>Arming (top position)</Text>
					{checks.arming.map(check => (
						<CheckRow key={check.label} {...check} />
					))}
					<Text style={styles.section}>Counting signal</Text>
					{checks.signal.map(check => (
						<CheckRow key={check.label} {...check} />
					))}
				</>
			)}
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
	summary: {
		color: '#fff',
		fontSize: 11,
		lineHeight: 16,
		fontWeight: '600',
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
});
