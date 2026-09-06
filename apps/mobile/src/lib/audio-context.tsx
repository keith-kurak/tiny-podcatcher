import { useQueryClient } from '@tanstack/react-query';
import {
  createAudioPlayer,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayerStatus,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import WearDataLayerModule, {
  type WatchPlaybackProgress,
} from '../../modules/wear-data-layer/src';
import { publishPlaybackProgress } from '@/lib/playback-sync';
import {
  getPlaybackProgress,
  mergeRemotePlaybackProgress,
  setPlaybackProgress,
} from '@/lib/storage';
import type { Episode, Podcast } from '@/lib/types';

const isAndroid = Platform.OS === 'android';

/**
 * Below this many seconds of movement, a save is treated as recording nothing new.
 *
 * Playback saves run every ~5s, so a genuine advance clears this comfortably.
 */
const UNCHANGED_POSITION_S = 1;

/**
 * Skip distances for the phone. Ten seconds each way.
 *
 * The watch is 10/30 — asymmetric, because forward is for clearing an ad break and back
 * is for catching a sentence. The phone cannot match it: its notification controls come
 * from expo-audio, whose `SEEK_INTERVAL_MS` is one private constant used for both
 * directions and is not reachable from JS or the config plugin. Rather than have the
 * in-app button skip 30s while the notification beside it skips 10, both surfaces here
 * agree at 10 and the phone simply differs from the watch.
 *
 * Revisit if expo-audio ever makes the interval configurable; 10/30 is the shape we
 * actually want.
 *
 * Two things depend on each number: the seek itself, and the icon drawn beside it
 * (`replay_10` / `forward_10`). Change one and its icon has to change with it, or the
 * button lies about what it does.
 */
export const SKIP_BACK_S = 10;
export const SKIP_FORWARD_S = 10;

interface NowPlaying {
  episode: Episode;
  podcast: Podcast;
}

interface AudioContextValue {
  player: AudioPlayer;
  currentEpisode: Episode | null;
  currentPodcast: Podcast | null;
  playbackRate: number;
  play: (episode: Episode, podcast: Podcast, localUri?: string) => void;
  pause: () => void;
  resume: () => void;
  seekTo: (seconds: number) => Promise<void>;
  skipBack: () => Promise<void>;
  skipForward: () => Promise<void>;
  setPlaybackRate: (rate: number) => void;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioProvider({ children }: { children: React.ReactNode }) {
  // Lazy state rather than a ref: the player is a plain value the whole tree depends on,
  // and reading it out of a ref during render is what the refs lint rule exists to stop.
  // The initialiser runs once, so still only one player is ever created.
  const [player] = useState<AudioPlayer>(() =>
    createAudioPlayer(null, { updateInterval: 500 }),
  );
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const queryClient = useQueryClient();
  const [playbackRate, setPlaybackRateState] = useState(1);
  const playRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
  }, []);

  /**
   * What is loaded right now, readable from a callback.
   *
   * The status listener below is registered once per player, so it cannot close over
   * `nowPlaying` state — it would keep seeing whatever was loaded when it was registered,
   * which is `null`. That is what stopped the periodic progress save from ever writing.
   */
  const nowPlayingRef = useRef<NowPlaying | null>(null);
  useEffect(() => {
    nowPlayingRef.current = nowPlaying;
  }, [nowPlaying]);

  const clearPlayRetry = useCallback(() => {
    if (playRetryRef.current) {
      clearInterval(playRetryRef.current);
      playRetryRef.current = null;
    }
  }, []);

  /**
   * @param final the position just stopped moving — a pause, or switching episode. The
   * watch gets it straight away instead of waiting out the publish throttle.
   */
  const saveProgress = useCallback(
    ({ final = false } = {}) => {
      const ep = nowPlayingRef.current?.episode;
      if (!ep || !player) return;
      const pos = player.currentTime;
      const dur = player.duration;
      if (dur <= 0) return;

      const stored = getPlaybackProgress(ep.guid);
      // A position that has not moved is not a new recording, and re-stamping it would
      // make this phone the most recent listener for a position it may have just been
      // given by the watch — which then pushes it straight back.
      //
      // Not hypothetical: applying a merge seeks the loaded player, that seek arrives as
      // a status update, and this save then published an echo ~25ms later.
      if (stored && Math.abs(stored.position - pos) < UNCHANGED_POSITION_S) {
        // Still flush when the session is ending — the last real move may be sitting
        // behind the publish throttle.
        if (final) publishPlaybackProgress({ immediate: true });
        return;
      }

      setPlaybackProgress(ep.guid, { position: pos, duration: dur });
      publishPlaybackProgress({ immediate: final });
    },
    [player],
  );

  /**
   * Apply listen positions the watch recorded.
   *
   * The episode playing right now is left alone — its position is advancing and is only
   * written to storage every few seconds, so an incoming value would jump the audio out
   * from under the listener. Anything else is merged newest-wins, and if the episode is
   * loaded but paused the player is moved to match: otherwise the next save would write
   * the player's old position back over the merged one.
   */
  useEffect(() => {
    if (!isAndroid) return;

    const subscription = WearDataLayerModule.addListener(
      'onWatchPlaybackProgress',
      (event: { entries: WatchPlaybackProgress[] }) => {
        const applied = mergeRemotePlaybackProgress(
          event.entries,
          (guid) => player.playing && nowPlayingRef.current?.episode.guid === guid,
        );
        if (applied.length === 0) return;

        const loadedGuid = nowPlayingRef.current?.episode.guid;
        if (loadedGuid && applied.includes(loadedGuid)) {
          const merged = getPlaybackProgress(loadedGuid);
          if (merged) player.seekTo(merged.position);
        }
        // The played/in-progress icons read storage during render and have nothing to
        // subscribe to, so a merged position stays invisible until something else
        // re-renders the row. Invalidating the lists they sit in is that something.
        queryClient.invalidateQueries({ queryKey: ['watchList'] });
        queryClient.invalidateQueries({ queryKey: ['feed'] });
      },
    );

    // Only after subscribing: this asks for whatever is already replicated, which is how
    // a position the watch recorded while this app was closed gets applied.
    WearDataLayerModule.requestWatchPlaybackProgress().catch(() => {});

    return () => subscription.remove();
  }, [player, queryClient]);

  const play = useCallback(
    async (episode: Episode, podcast: Podcast, localUri?: string) => {
      const uri = localUri ?? episode.audioUrl;
      if (!uri) return;
      // Save progress of currently playing episode before switching. Final: that episode
      // is not going to move again, so the watch should hear about it now.
      saveProgress({ final: true });
      clearPlayRetry();
      player.replace({ uri });
      // Resume from saved position if the episode was previously in progress
      const saved = getPlaybackProgress(episode.guid);
      if (saved && saved.duration > 0 && saved.position / saved.duration < 0.95) {
        player.seekTo(saved.position);
      }
      player.play();
      setNowPlaying({ episode, podcast });

      // On Android, play() right after replace() may silently fail while
      // the source is still loading. Retry every 500ms until it starts.
      let retries = 0;
      playRetryRef.current = setInterval(() => {
        retries++;
        if (retries >= 20) {
          clearPlayRetry();
          return;
        }
        if (!player.playing) {
          player.play();
        } else {
          clearPlayRetry();
        }
      }, 500);

      if (Platform.OS === 'android') {
        await requestNotificationPermissionsAsync();
      }
      try {
        player.setActiveForLockScreen(
          true,
          {
            title: episode.title,
            artist: podcast.author ?? podcast.title,
            artworkUrl: episode.imageUrl ?? podcast.artworkUrl,
          },
          // Skip buttons either side of play/pause in the notification and on the lock
          // screen. expo-audio draws them at 10s in both directions, which is why
          // SKIP_BACK_S and SKIP_FORWARD_S are both 10 — the in-app buttons and these
          // have to agree.
          { showSeekBackward: true, showSeekForward: true },
        );
      } catch {
        // Lock screen controls may fail on dev builds; non-critical
      }
    },
    [player, saveProgress, clearPlayRetry],
  );

  // Stop retrying once playback starts, and periodically save progress
  const progressSaveRef = useRef(0);
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.playing) clearPlayRetry();
      // Save progress every ~5 seconds (updateInterval is 500ms, so every 10 updates)
      progressSaveRef.current++;
      if (progressSaveRef.current >= 10) {
        progressSaveRef.current = 0;
        saveProgress();
      }
    });
    return () => sub.remove();
  }, [player, clearPlayRetry, saveProgress]);

  const value = useMemo<AudioContextValue>(
    () => ({
      player,
      currentEpisode: nowPlaying?.episode ?? null,
      currentPodcast: nowPlaying?.podcast ?? null,
      playbackRate,
      setPlaybackRate: (rate: number) => {
        player.setPlaybackRate(rate);
        setPlaybackRateState(rate);
      },
      play,
      pause: () => {
        clearPlayRetry();
        saveProgress({ final: true });
        player.pause();
      },
      resume: () => {
        player.play();
      },
      seekTo: (seconds: number) => player.seekTo(seconds),
      skipBack: () => player.seekTo(Math.max(0, player.currentTime - SKIP_BACK_S)),
      skipForward: () => {
        // `duration` is 0 until the source has loaded, which would clamp every skip to
        // the start. Until it is known, let the seek run unclamped — the player stops at
        // the end on its own.
        const target = player.currentTime + SKIP_FORWARD_S;
        return player.seekTo(player.duration > 0 ? Math.min(target, player.duration) : target);
      },
    }),
    [player, nowPlaying, playbackRate, play, saveProgress, clearPlayRetry],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
}

export function useAudioStatus(): AudioStatus {
  const { player } = useAudio();
  return useAudioPlayerStatus(player);
}
