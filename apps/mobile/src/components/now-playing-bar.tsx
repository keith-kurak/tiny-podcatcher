import { useAudioPlayerStatus } from 'expo-audio';
import { useRouter, useSegments, useGlobalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from '@/components/image';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAudio } from '@/lib/audio-context';

export function NowPlayingBar() {
  const { player, currentEpisode, currentPodcast, pause, resume } = useAudio();
  const status = useAudioPlayerStatus(player);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const params = useGlobalSearchParams<{ episodeId?: string }>();
  const router = useRouter();

  if (!currentEpisode) return null;

  // Only hide when viewing the detail screen of the currently playing episode
  const isOnEpisodeDetail = segments.includes('episode' as never);
  if (isOnEpisodeDetail && params.episodeId === currentEpisode.guid) return null;

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;
  const imageUri = currentEpisode.imageUrl ?? currentPodcast?.artworkUrl;

  // Determine which tab group we're in to navigate to the right episode detail
  function handlePress() {
    if (!currentEpisode) return;
    // Find which tab has this episode — try downloads first, fall back to subscriptions
    const podcastId = currentPodcast?.id;
    if (!podcastId) return;
    router.push({
      pathname: '/(tabs)/(downloads)/episode/[episodeId]',
      params: { episodeId: currentEpisode.guid, podcastId },
    });
  }

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.wrapper, { backgroundColor: theme.backgroundElement, bottom: BottomTabInset + insets.bottom }]}
    >
      <View style={[styles.progressLine, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.progressLineFill,
            { backgroundColor: theme.text, width: `${Math.min(progress * 100, 100)}%` },
          ]}
        />
      </View>
      <View style={styles.content}>
        {imageUri && (
          <Image source={{ uri: imageUri }} style={styles.artwork} contentFit="cover" />
        )}
        <ThemedText style={styles.title} numberOfLines={1}>
          {currentEpisode.title}
        </ThemedText>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            if (status.playing) pause();
            else resume();
          }}
          hitSlop={8}
          style={styles.playPause}>
          <View pointerEvents="none">
            <SymbolView
              name={
                status.playing
                  ? { ios: 'pause.fill', android: 'pause' }
                  : { ios: 'play.fill', android: 'play_arrow' }
              }
              size={20}
              tintColor={theme.text}
            />
          </View>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  progressLine: {
    height: 2,
  },
  progressLineFill: {
    height: '100%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    height: 56,
  },
  artwork: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  playPause: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
