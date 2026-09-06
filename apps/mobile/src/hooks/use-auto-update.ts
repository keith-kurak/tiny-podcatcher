import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Don't re-check every time the app is flicked back to.
 *
 * A check is one small request, but app switching happens in bursts — answer a message,
 * come back, glance at something, come back — and none of those are new opportunities to
 * find an update. Long enough to collapse a burst into one check, short enough that
 * coming back to the app after a break still finds something waiting.
 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Fetch over-the-air updates in the background, so nobody has to ask for one.
 *
 * Cold starts are already covered: `checkAutomatically` defaults to `ON_LOAD`, so
 * expo-updates checks and downloads on launch by itself. This fills the other half —
 * an app that stays resident for days and is only ever *resumed* would otherwise never
 * look. Together they mean an update is normally already downloaded and staged by the
 * time anyone would think to look for it.
 *
 * Downloading is not a second decision. An update that is found but left un-fetched
 * helps nobody, and the download is small and silent; the only thing worth a person's
 * attention is the restart at the end, which `VersionInfo` offers.
 *
 * Call once, from the root layout.
 */
export function useAutoUpdate() {
  const lastCheckedAt = useRef(0);
  /** Guards against a second pass starting while one is still in flight. */
  const running = useRef(false);

  useEffect(() => {
    // `Updates.isEnabled` is true in a development build — the native module is
    // configured even though the bundle comes from Metro — so it cannot stand alone.
    // Checking in that state throws.
    if (!Updates.isEnabled || __DEV__) return;

    async function checkAndDownload() {
      if (running.current) return;
      if (Date.now() - lastCheckedAt.current < CHECK_INTERVAL_MS) return;

      running.current = true;
      lastCheckedAt.current = Date.now();
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Offline, or the update server is unreachable. Nothing here is worth telling
        // the user about — the next resume tries again.
      } finally {
        running.current = false;
      }
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAndDownload();
    });
    return () => subscription.remove();
  }, []);
}
