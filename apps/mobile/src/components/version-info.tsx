import { useMaterialColors } from '@expo/ui/jetpack-compose';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { channelLabel, isNonStableChannel, useUpdateChannel } from '@/lib/update-channel';

/** Taps on the version number that open the Extra Stuff screen. */
const SECRET_TAPS = 7;
/** A longer pause between taps starts the count again. */
const SECRET_TAP_GAP_MS = 1500;

/**
 * Version and over-the-air update state — a footer for the bottom of Settings.
 *
 * Deliberately quiet: centred, small, secondary text, no card. Nobody comes to Settings
 * to read a version number; it is here for the moment someone is asked for it, so it
 * should be findable without competing with the rows above.
 *
 * Finding and downloading updates is not this screen's job — `useAutoUpdate` does both
 * in the background. What is left is the one step that genuinely needs a person, because
 * it interrupts them: restarting into an update that is already downloaded and waiting.
 * So there is no button here at all until there is something to restart into.
 */
export function VersionInfo() {
  const material = useMaterialColors();
  const router = useRouter();
  const channel = useUpdateChannel();
  const onNonStableChannel = isNonStableChannel(channel);
  const taps = useRef({ count: 0, lastAt: 0 });

  /**
   * Seven quick taps open Extra Stuff. On beta or alpha one tap is enough: whoever switched
   * there already knows the screen exists, and needs a quick way back.
   */
  function handleVersionPress() {
    const now = Date.now();
    const t = taps.current;
    t.count = now - t.lastAt > SECRET_TAP_GAP_MS ? 1 : t.count + 1;
    t.lastAt = now;
    if (onNonStableChannel || t.count >= SECRET_TAPS) {
      t.count = 0;
      router.push('/(tabs)/(settings)/extra-stuff');
    }
  }

  const { currentlyRunning, isUpdatePending, isDownloading, downloadProgress } =
    Updates.useUpdates();

  /**
   * Safe to read as *the* app version because `runtimeVersion.policy` is `appVersion`:
   * changing this string changes the runtime version, so an update can never reach a
   * binary built under a different one. Manifest version and native version cannot
   * diverge. It is also the version `http.ts` puts in the User-Agent, which is what a
   * podcast host sees in its logs.
   */
  const version = Constants.expoConfig?.version ?? '—';
  const { createdAt, isEmbeddedLaunch } = currentlyRunning;

  const updatesActive = Updates.isEnabled && !__DEV__;

  /**
   * A second line only when it tells the reader something.
   *
   * An embedded launch gets nothing: its date is just the build's own, which the version
   * number above already stands for, and "Built in 3 Mar" invites the reader to wonder
   * what it means. A date is news only when it belongs to an update that arrived after
   * the install — so the line appears exactly when one has.
   */
  const statusLine = !updatesActive
    ? 'Running from the development server.'
    : !isEmbeddedLaunch && createdAt
      ? `Updated ${formatManifestDate(createdAt)}`
      : null;

  return (
    <View style={styles.container}>
      {/* No button role off beta and alpha: the seven-tap entry is meant to stay hidden. */}
      <Pressable
        onPress={handleVersionPress}
        hitSlop={8}
        accessibilityRole={onNonStableChannel ? 'button' : undefined}
        accessibilityHint={onNonStableChannel ? 'Opens Extra Stuff' : undefined}>
        <ThemedText type="small" themeColor="textSecondary">
          Version {version}
        </ThemedText>
      </Pressable>

      {onNonStableChannel && (
        <ThemedText type="smallBold" style={{ color: material.primary }}>
          {channelLabel(channel)} channel
        </ThemedText>
      )}

      {statusLine && (
        <ThemedText type="small" themeColor="textSecondary">
          {statusLine}
        </ThemedText>
      )}

      {updatesActive && isUpdatePending && (
        // Staged already, and it applies on the next launch either way. This is an offer
        // to have it now, not a step that must be completed.
        <Pressable
          onPress={() => Updates.reloadAsync()}
          accessibilityRole="button"
          accessibilityLabel="Restart to update"
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <ThemedText type="small" style={[styles.buttonLabel, { color: material.primary }]}>
            Restart to update
          </ThemedText>
        </Pressable>
      )}

      {updatesActive && !isUpdatePending && isDownloading && (
        // Not a control — just an explanation for the button that is about to appear.
        <ThemedText type="small" themeColor="textSecondary">
          {downloadProgress != null
            ? `Downloading update… ${Math.round(downloadProgress * 100)}%`
            : 'Downloading update…'}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * Date and time, not just the date. Two updates can ship on one day, and "Updated 3 Mar"
 * on both of them cannot tell the reader which one they have.
 */
function formatManifestDate(date: Date): string {
  try {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.four,
    alignItems: 'center',
    // Tight enough that the version and its status read as one block.
    gap: Spacing.one,
  },
  button: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  buttonLabel: {
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});
