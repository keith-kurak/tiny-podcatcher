import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { hasAnyAutoDownloadEnabled } from './storage';

/** Name of the task defined in `background-refresh.ts`. */
export const BACKGROUND_REFRESH_TASK = 'background-refresh';

/**
 * Minutes between background runs. A minimum, not a schedule: Android's WorkManager
 * decides the real time, and batches it with other work to save battery. Matches the
 * feed stale time, so a run nearly always has something new to fetch.
 */
const MINIMUM_INTERVAL_MINUTES = 60;

/**
 * Register the background task while any podcast auto-downloads, and unregister it when
 * none does. Without a podcast to check, a wakeup would only spend battery.
 *
 * Safe to call often: it does nothing when the registration already matches. Errors are
 * swallowed, because a failed registration must not break the screen that asked for it.
 * The next app start tries again.
 */
export async function syncBackgroundRefreshRegistration(): Promise<void> {
  try {
    const wanted = hasAnyAutoDownloadEnabled();
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK);
    if (wanted && !registered) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
        minimumInterval: MINIMUM_INTERVAL_MINUTES,
      });
    } else if (!wanted && registered) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_REFRESH_TASK);
    }
  } catch (e) {
    console.warn('Could not update the background refresh registration', e);
  }
}
