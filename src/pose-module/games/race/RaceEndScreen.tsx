import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BRAND_ORANGE } from '@/src/pose-module/pyramid/pyramid';

export interface RaceEndScreenProps {
	place: number;
	timeMs: number;
	distanceM: number;
	bestLeadM: number;
	repCount: number;
	hasRecording: boolean;
	isSaved: boolean;
	isBusy: boolean;
	onSave: () => void;
	onShareInstagram: () => void;
	onDone: () => void;
}

const PLACE_EMOJI = ['🥇', '🥈', '🥉', '🏁'];

/** Push Race end screen: final place, time, distance, best lead, reps. */
export const RaceEndScreen = ({
	place,
	timeMs,
	distanceM,
	bestLeadM,
	repCount,
	hasRecording,
	isSaved,
	isBusy,
	onSave,
	onShareInstagram,
	onDone,
}: RaceEndScreenProps) => {
	const { t } = useTranslation(['settings']);
	const { bottom } = useSafeAreaInsets();

	const showSaveOptions = hasRecording && !isSaved;
	const total = Math.floor(timeMs / 1000);
	const time = `${Math.floor(total / 60)}:${total % 60 < 10 ? '0' : ''}${total % 60}`;
	const placeText = t(`settings:aiTrainer.games.race.place${Math.min(4, Math.max(1, place))}`);

	return (
		<View style={styles.root}>
			<View style={styles.content}>
				<Text style={styles.emoji}>{PLACE_EMOJI[Math.min(3, Math.max(0, place - 1))]}</Text>
				<Text style={styles.title}>
					{t(
						place === 1
							? 'settings:aiTrainer.games.race.winTitle'
							: 'settings:aiTrainer.games.race.loseTitle',
					)}
				</Text>
				<View style={styles.statsCard}>
					<Text style={styles.scoreText}>
						{t('settings:aiTrainer.games.race.finishPlace', { place: placeText })}
					</Text>
					<Text style={styles.detailText}>
						{t('settings:aiTrainer.games.race.time', { time })}
					</Text>
					<Text style={styles.detailText}>
						{t('settings:aiTrainer.games.race.distance', { count: distanceM })}
					</Text>
					<Text style={styles.detailText}>
						{t('settings:aiTrainer.games.race.bestLead', { count: bestLeadM })}
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
