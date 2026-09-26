import type { PlaybackProgress } from './types';

/** Whether an episode has been listened to, as the Watch and Phone tabs show it. */
export type PlayedState = 'unplayed' | 'in_progress' | 'played';

/** Past this share of the episode, it counts as played — outros and ads are often skipped. */
const COMPLETION_THRESHOLD = 0.95;

/** Under this many seconds in, it still counts as unplayed — a tap-and-stop is not a listen. */
const STARTED_THRESHOLD_S = 5;

export interface PlayedStatus {
  state: PlayedState;
  /** Share listened, 0 to 1. */
  fraction: number;
  /** Seconds left to listen. 0 when unplayed or played. */
  remainingSeconds: number;
}

export function playedStatusOf(progress: PlaybackProgress | null): PlayedStatus {
  if (!progress || progress.duration <= 0) {
    return { state: 'unplayed', fraction: 0, remainingSeconds: 0 };
  }
  const fraction = Math.min(progress.position / progress.duration, 1);
  if (fraction >= COMPLETION_THRESHOLD) {
    return { state: 'played', fraction: 1, remainingSeconds: 0 };
  }
  if (progress.position > STARTED_THRESHOLD_S) {
    return {
      state: 'in_progress',
      fraction,
      remainingSeconds: progress.duration - progress.position,
    };
  }
  return { state: 'unplayed', fraction: 0, remainingSeconds: 0 };
}
