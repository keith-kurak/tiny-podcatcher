import BottomSheetComponent, { BottomSheetView } from '@expo/ui/community/bottom-sheet';
import { Slider } from '@expo/ui/community/slider';
import { Host, Slider as ComposeSlider } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useAudioPlayerStatus } from 'expo-audio';
import { ObserveInteractiveMarker } from 'expo-observe';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { DownloadToggle } from '@/components/download-toggle';
import { Image } from '@/components/image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WatchToggle } from '@/components/watch-toggle';
import { NowPlayingBarHeight, Spacing } from '@/constants/theme';
import { useStatusColors } from '@/hooks/use-status-colors';
import { useTheme } from '@/hooks/use-theme';
import { SKIP_BACK_S, SKIP_FORWARD_S, useAudio } from '@/lib/audio-context';
import { useDownloadContext } from '@/lib/download-context';
import { formatBytes, formatDate, formatDuration, parseDurationToSeconds, stripHtml } from '@/lib/format';
import { useDownloadMutations, useIsInDownloads } from '@/lib/queries';
import {
  getCachedEpisodes,
  getPhoneLimitState,
  getPlaybackProgress,
  getSubscriptions,
} from '@/lib/storage';
import type { Episode, Podcast } from '@/lib/types';

// Shared height for the slider and the buttons beside it, so their centre lines
// match. 48 keeps the play button at the minimum touch target size.
const SliderRowHeight = 48;

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

interface EpisodeDetailProps {
  episodeId: string;
  podcastId: string;
}

export function EpisodeDetail({ episodeId, podcastId }: EpisodeDetailProps) {
  const podcast: Podcast | undefined = getSubscriptions().find((s) => s.id === podcastId);
  const episodes = getCachedEpisodes(podcastId) ?? [];
  const episode: Episode | undefined = episodes.find((e) => e.guid === episodeId);
  const {
    player,
    currentEpisode,
    play,
    pause,
    resume,
    playbackRate,
    setPlaybackRate,
    skipBack,
    skipForward,
  } = useAudio();
  const status = useAudioPlayerStatus(player);
  const theme = useTheme();
  const { data: downloadItem } = useIsInDownloads(episodeId);
  const { add } = useDownloadMutations();
  const { getProgress, isWaitingForWifi } = useDownloadContext();
  const [askDownload, setAskDownload] = useState(false);

  if (!episode) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.notFound}>Episode not found.</ThemedText>
      </ThemedView>
    );
  }

  const isThisEpisode = currentEpisode?.guid === episode.guid;
  const isPlaying = isThisEpisode && status.playing;

  const imageUri = episode.imageUrl ?? podcast?.artworkUrl;
  const episodeDuration = parseDurationToSeconds(episode.duration);
  const savedProgress = !isThisEpisode ? getPlaybackProgress(episode.guid) : null;
  const activeDuration = isThisEpisode && status.duration > 0 ? status.duration : episodeDuration;
  const currentTime = isThisEpisode ? status.currentTime : (savedProgress?.position ?? 0);

  const isDownloaded = downloadItem?.status === 'complete';
  const canPlay = isDownloaded || isThisEpisode;

  const downloadProgress = getProgress(episode.guid);
  const downloadFailed = downloadItem?.status === 'error';
  /**
   * A download this screen is waiting on. Covers 'pending' too: an episode queued behind
   * the Wi-Fi-only setting has no progress yet but is on its way, and showing the
   * playback bar for it would offer a play button that cannot do anything.
   */
  const downloadInFlight =
    !isDownloaded &&
    (downloadProgress != null ||
      downloadItem?.status === 'downloading' ||
      downloadItem?.status === 'pending');

  function handlePlayPause() {
    if (!podcast) return;
    if (isThisEpisode) {
      if (status.playing) pause();
      else resume();
    } else if (isDownloaded) {
      play(episode!, podcast, downloadItem?.localPath);
    } else if (episode!.audioUrl) {
      // Nothing to play yet. Rather than a dead button, say why and offer the fix.
      setAskDownload(true);
    }
  }

  function handleConfirmDownload() {
    setAskDownload(false);
    const audioUrl = episode!.audioUrl;
    if (!audioUrl) return;
    // Same guard the download toggle applies. Starting a download the limit forbids
    // would show a progress bar that never moves.
    const limit = getPhoneLimitState();
    if (!limit.allowed) {
      Alert.alert(
        'Phone storage limit reached',
        `Downloaded episodes use ${formatBytes(limit.usedBytes)} of your ` +
          `${formatBytes(limit.limitBytes)} limit. Remove an episode, or raise the ` +
          `limit in Settings, to download another.`,
      );
      return;
    }
    add.mutate({ podcastId, episodeGuid: episode!.guid, audioUrl });
  }

  return (
    <ThemedView style={styles.container}>
      {/*
        Marks TTI for whichever of the three episode routes rendered this — the router
        integration attributes it from the current route, so one marker covers all of
        them. Below the not-found branch on purpose: a screen that failed to find its
        episode never became interactive, and marking it would flatter the metric.
      */}
      <ObserveInteractiveMarker />
      <ScrollView contentContainerStyle={styles.content}>
        {imageUri && (
          <Image source={{ uri: imageUri }} style={styles.image} contentFit="cover" />
        )}
        <View style={styles.titleRow}>
          <ThemedText style={styles.title}>{episode.title}</ThemedText>
          <WatchToggle podcastId={podcastId} episodeGuid={episode.guid} />
          <DownloadToggle podcastId={podcastId} episodeGuid={episode.guid} audioUrl={episode.audioUrl} />
        </View>
        <View style={styles.meta}>
          {episode.pubDate && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatDate(episode.pubDate)}
            </ThemedText>
          )}
          {episode.duration && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatDuration(episode.duration)}
            </ThemedText>
          )}
        </View>

        {/*
          One bar at a time. While a download is running it takes the playback bar's
          place: there is nothing to scrub or play yet, and the progress is the only
          thing worth that space.
        */}
        {downloadInFlight ? (
          <DownloadProgressBar
            progress={downloadProgress}
            waitingForWifi={downloadItem?.status === 'pending' && isWaitingForWifi}
          />
        ) : (
          (canPlay || episode.audioUrl) && (
            <PlaybackControls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={activeDuration}
              onPlayPause={handlePlayPause}
              onSeek={async (seconds) => {
                if (isThisEpisode) await player.seekTo(seconds);
              }}
              onSkipBack={skipBack}
              onSkipForward={skipForward}
              playbackRate={playbackRate}
              onPlaybackRateChange={setPlaybackRate}
              theme={theme}
              disabled={!canPlay && !isThisEpisode}
              /* Play stays live even with nothing downloaded — tapping it is how the
                 download gets offered. Only the scrubber and skips have nothing to act on. */
              playDisabled={!canPlay && !isThisEpisode && !episode.audioUrl}
              downloadFailed={downloadFailed}
            />
          )
        )}

        {episode.description && (
          <ThemedText style={styles.description}>
            {stripHtml(episode.description)}
          </ThemedText>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={askDownload}
        title="Download this episode to your phone now?"
        message={
          episode.sizeBytes
            ? `This episode is ${formatBytes(
                episode.sizeBytes,
              )}.`
            : ''
        }
        confirmLabel="Download"
        onConfirm={handleConfirmDownload}
        onDismiss={() => setAskDownload(false)}
      />
    </ThemedView>
  );
}

function formatRate(rate: number): string {
  return rate % 1 === 0 ? `${rate}x` : `${rate.toFixed(1)}x`;
}

/**
 * The download's progress, in the space the playback bar will occupy once it finishes.
 *
 * Sized to the playback bar it replaces so the page does not jump when the download
 * completes and the transport takes over.
 */
function DownloadProgressBar({
  progress,
  waitingForWifi,
}: {
  progress: number | null | undefined;
  waitingForWifi: boolean;
}) {
  const statusColors = useStatusColors();
  const pct = progress != null ? Math.round(progress * 100) : null;

  return (
    <View style={styles.downloadBar}>
      <View style={styles.downloadLabelRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {waitingForWifi
            ? 'Waiting for Wi-Fi'
            : pct != null
              ? 'Downloading to your phone…'
              : 'Starting download…'}
        </ThemedText>
        {pct != null && !waitingForWifi && (
          <ThemedText type="small" themeColor="textSecondary">
            {pct}%
          </ThemedText>
        )}
      </View>
      <View style={[styles.downloadTrack, { backgroundColor: statusColors.progressTrack }]}>
        {/*
          Only drawn once there is a real number. A zero-width fill and a full-width one
          both say something untrue while the task is still starting up.
        */}
        {pct != null && !waitingForWifi && (
          <View
            style={[
              styles.downloadFill,
              { width: `${pct}%`, backgroundColor: statusColors.progressFill },
            ]}
          />
        )}
      </View>
    </View>
  );
}

/**
 * A skip button whose icon states its own distance.
 *
 * The glyph carries the number, so the button says what it does without a label. These
 * are the 10s pair and they are tied to `SKIP_BACK_S` / `SKIP_FORWARD_S` by hand —
 * changing a constant means changing its icon here too, or the button lies.
 */
function SkipButton({
  seconds,
  direction,
  onPress,
  disabled,
  theme,
}: {
  seconds: number;
  direction: 'back' | 'forward';
  onPress: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.skipButton, disabled && styles.controlDisabled]}
      hitSlop={8}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        direction === 'back' ? `Skip back ${seconds} seconds` : `Skip forward ${seconds} seconds`
      }>
      <View pointerEvents="none">
        <SymbolView
          name={
            direction === 'back'
              ? { ios: 'gobackward.10', android: 'replay_10' }
              : { ios: 'goforward.10', android: 'forward_10' }
          }
          size={26}
          tintColor={theme.text}
        />
      </View>
    </Pressable>
  );
}

function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onSeek,
  onSkipBack,
  onSkipForward,
  playbackRate,
  onPlaybackRateChange,
  theme,
  disabled,
  playDisabled,
  downloadFailed,
}: {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (seconds: number) => Promise<void>;
  onSkipBack: () => Promise<void>;
  onSkipForward: () => Promise<void>;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  theme: ReturnType<typeof useTheme>;
  /** No audio loaded: the scrubber and skips have nothing to move. */
  disabled?: boolean;
  /** No audio and nothing downloadable either — then even play is dead. */
  playDisabled?: boolean;
  downloadFailed?: boolean;
}) {
  const statusColors = useStatusColors();
  const sheetRef = useRef<BottomSheetComponent>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // While the thumb is held, `scrubTime` overrides the live playback position so
  // incoming status updates don't yank the thumb back under the finger.
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const scrubTimeRef = useRef<number>(0);
  const displayTime = scrubTime ?? currentTime;

  const handleSpeedPress = useCallback(() => {
    setSheetOpen(true);
    // expand after mount on next frame
    requestAnimationFrame(() => sheetRef.current?.expand());
  }, []);

  return (
    <View style={styles.controls}>
      {duration > 0 && (
        <View style={styles.progressContainer}>
          <Host style={styles.sliderRow} useViewportSizeMeasurement>
            <ComposeSlider
              min={0}
              max={duration}
              value={Math.min(displayTime, duration)}
              enabled={!disabled}
              colors={{
                thumbColor: theme.text,
                activeTrackColor: theme.text,
                inactiveTrackColor: theme.backgroundElement,
              }}
              onValueChange={(value) => {
                scrubTimeRef.current = value;
                setScrubTime(value);
              }}
              onValueChangeFinished={() => {
                const target = Math.max(0, Math.min(scrubTimeRef.current, duration));
                // Hold `scrubTime` across the seek. Clearing it first would show
                // the pre-seek position for a frame, which reads as a flash.
                setScrubTime(target);
                onSeek(target).finally(() => setScrubTime(null));
              }}
              modifiers={[fillMaxWidth()]}
            />
          </Host>
          <View style={styles.timeRow}>
            <ThemedText type="small" themeColor="textSecondary">
              {formatSeconds(displayTime)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              -{formatSeconds(Math.max(0, duration - displayTime))}
            </ThemedText>
          </View>
        </View>
      )}

      {/*
        Transport sits below the scrubber rather than beside it. Five controls in one row
        left the slider about a third of the screen, and a scrubber you cannot land on
        accurately is worse than a taller player.
      */}
      <View style={styles.transportRow}>
        <SkipButton
          seconds={SKIP_BACK_S}
          direction="back"
          onPress={onSkipBack}
          disabled={disabled}
          theme={theme}
        />

        <Pressable
          onPress={onPlayPause}
          style={[styles.playButton, playDisabled && styles.controlDisabled]}
          hitSlop={8}
          disabled={playDisabled}>
          <View pointerEvents="none">
            <SymbolView
              name={
                isPlaying
                  ? { ios: 'pause.fill', android: 'pause' }
                  : { ios: 'play.fill', android: 'play_arrow' }
              }
              size={28}
              tintColor={theme.text}
            />
          </View>
        </Pressable>

        <SkipButton
          seconds={SKIP_FORWARD_S}
          direction="forward"
          onPress={onSkipForward}
          disabled={disabled}
          theme={theme}
        />

        {/*
          Absolute so the three transport buttons stay centred on the screen rather than
          on whatever is left after the speed label — which changes width between "1x"
          and "1.5x", and would shift the play button as the rate changed.
        */}
        <Pressable onPress={handleSpeedPress} style={styles.speedButton} hitSlop={8}>
          <ThemedText style={styles.speedButtonText}>{formatRate(playbackRate)}</ThemedText>
        </Pressable>
      </View>

      {downloadFailed && (
        <ThemedText type="small" style={[styles.centeredNote, { color: statusColors.error }]}>
          Download failed. Tap play to try again.
        </ThemedText>
      )}

      {sheetOpen && (
        <BottomSheetComponent
          ref={sheetRef}
          index={-1}
          enablePanDownToClose
          onClose={() => setSheetOpen(false)}
        >
          <BottomSheetView style={styles.sheetContent}>
            <ThemedText style={styles.sheetTitle}>
              Playback Speed: {formatRate(playbackRate)}
            </ThemedText>
            <Slider
              minimumValue={0.5}
              maximumValue={2}
              step={0.1}
              value={playbackRate}
              onValueChange={(value) => {
                onPlaybackRateChange(Math.round(value * 10) / 10);
              }}
            />
            <View style={styles.sliderLabels}>
              <ThemedText type="small" themeColor="textSecondary">0.5x</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">1x</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">1.5x</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">2x</ThemedText>
            </View>
          </BottomSheetView>
        </BottomSheetComponent>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.three + NowPlayingBarHeight,
    gap: Spacing.three,
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  meta: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
  },
  notFound: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
  controls: {
    gap: Spacing.two,
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  playButton: {
    width: 48,
    height: SliderRowHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipButton: {
    width: 44,
    height: SliderRowHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlDisabled: {
    opacity: 0.4,
  },
  downloadBar: {
    // Matches the playback bar's height so completing a download does not shift the
    // description below it.
    minHeight: SliderRowHeight,
    justifyContent: 'center',
    gap: Spacing.two,
  },
  downloadLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  downloadTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  downloadFill: {
    height: '100%',
    borderRadius: 2,
  },
  centeredNote: {
    textAlign: 'center',
  },
  speedButton: {
    position: 'absolute',
    right: 0,
    paddingHorizontal: 8,
    height: SliderRowHeight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  sheetContent: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressContainer: {
    flex: 1,
    gap: Spacing.one,
  },
  sliderRow: {
    height: SliderRowHeight,
    justifyContent: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
