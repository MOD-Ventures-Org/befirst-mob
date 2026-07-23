import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BRAND_ORANGE } from '@/src/pose-module/pyramid/pyramid';

export interface FlappyEndScreenProps {
	score: number;
	coins: number;
	repCount: number;
	hasRecording: boolean;
	isSaved: boolean;
	isBusy: boolean;
	onSave: () => void;
	onShareInstagram: () => void;
	onDone: () => void;
}

/** Flappy Push end screen: score, coins, and the standard rep count. */
export const FlappyEndScreen = ({
	score,
	coins,
	repCount,
	hasRecording,
	isSaved,
	isBusy,
	onSave,
	onShareInstagram,
	onDone,
}: FlappyEndScreenProps) => {
	const { t } = useTranslation(['settings']);
	const { bottom } = useSafeAreaInsets();

	const showSaveOptions = hasRecording && !isSaved;

	return (
		<View style={styles.root}>
			<View style={styles.content}>
				<Text style={styles.emoji}>✈️</Text>
				<Text style={styles.title}>{t('settings:aiTrainer.games.flappy.endTitle')}</Text>
				<View style={styles.statsCard}>
					<Text style={styles.scoreText}>
						{t('settings:aiTrainer.games.flappy.score', { score })}
					</Text>
					<Text style={styles.detailText}>
						{t('settings:aiTrainer.games.flappy.coins', { count: coins })}
					</Text>
					<Text style={styles.detailText}>
						{t('settings:aiTrainer.games.builder.reps', { count: repCount })}
					</Text>
				</View>
			</View>

			<View style={[styles.actions, { paddingBottom: bottom + 16 }]}>
				{showSaveOptions ? (
					<>
						<Pressable disabled={isBusy} style={styles.secondaryButton} onPress={onSave}>
							<Text style={styles.secondaryText}>{t('settings:aiTrainer.pyramid.complete.save')}</Text>
						</Pressable>
						<Pressable disabled={isBusy} style={styles.primaryButton} onPress={onShareInstagram}>
							{isBusy ? (
								<ActivityIndicator color="#fff" />
							) : (
								<Text style={styles.primaryText}>{t('settings:aiTrainer.pyramid.complete.shareInstagram')}</Text>
							)}
						</Pressable>
					</>
				) : (
					<Pressable style={styles.primaryButton} onPress={onDone}>
						<Text style={styles.primaryText}>{t('settings:aiTrainer.pyramid.complete.done')}</Text>
					</Pressable>
				)}
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#fff',
	},
	content: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 24,
	},
	emoji: {
		fontSize: 72,
	},
	title: {
		marginTop: 16,
		fontSize: 26,
		fontWeight: '800',
		color: BRAND_ORANGE,
		textAlign: 'center',
	},
	statsCard: {
		marginTop: 32,
		alignSelf: 'stretch',
		alignItems: 'center',
		backgroundColor: '#F3F4F6',
		borderRadius: 16,
		paddingVertical: 24,
		gap: 4,
	},
	scoreText: {
		fontSize: 26,
		fontWeight: '700',
		color: '#111',
	},
	detailText: {
		fontSize: 16,
		color: '#6B7280',
	},
	actions: {
		flexDirection: 'row',
		gap: 12,
		paddingHorizontal: 16,
	},
	secondaryButton: {
		height: 56,
		paddingHorizontal: 28,
		borderRadius: 28,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: '#F3F4F6',
	},
	secondaryText: {
		fontSize: 17,
		fontFamily: 'MicrogrammaDExtendedBold',
		color: '#111',
	},
	primaryButton: {
		flex: 1,
		height: 56,
		borderRadius: 28,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: BRAND_ORANGE,
	},
	primaryText: {
		fontSize: 17,
		fontFamily: 'MicrogrammaDExtendedBold',
		color: '#fff',
	},
});
