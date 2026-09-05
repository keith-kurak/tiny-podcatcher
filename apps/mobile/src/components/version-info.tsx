import { useMaterialColors } from '@expo/ui/jetpack-compose';
import Constants from 'expo-constants';
import { SymbolView } from 'expo-symbols';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useColorScheme, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

/**
 * Version and over-the-air update state, for the bottom of Settings.
 *
 * Three things, in the order someone asks them: what am I running, when was it built, and
 * is there anything newer. The last one is a single button that changes what it offers
 * rather than three buttons that are mostly disabled — checking, downloading and
 * restarting are steps of one action, never a choice between them.
 *
 * Everything here is inert in development. `expo-updates` is disabled when the bundle
 * comes from Metro, so `createdAt` is undefined and `checkForUpdateAsync` throws; the
 * component says so plainly instead of offering a button that cannot work.
 */
export function VersionInfo() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const material = useMaterialColors();

  const {
    currentlyRunning,
    isUpdateAvailable,
    isUpdatePending,
    isChecking,
    isDownloading,
    downloadProgress,
    checkError,
    downloadError,
  } = Updates.useUpdates();

  /**
   * Set only by a check that came back empty. The hook cannot express "asked, and there
   * was nothing" — `isUpdateAvailable` is false both before and after such a check — and
   * a button that does nothing visible reads as broken.
   */
  const [upToDate, setUpToDate] = useState(false);

  /**
   * Safe to read as *the* app version because `runtimeVersion.policy` is `appVersion`:
   * changing this string changes the runtime version, so an update can never reach a
   * binary built under a different one. Manifest version and native version cannot
   * diverge. It is also the version `http.ts` puts in the User-Agent, which is what a
   * podcast host sees in its logs.
   */
  const version = Constants.expoConfig?.version ?? '—';
  const { createdAt, isEmbeddedLaunch } = currentlyRunning;

  /**
   * `Updates.isEnabled` is true in a development build — the native module is configured
   * even though the bundle is coming from Metro — so it cannot stand alone here.
   * Checking for an update in that state throws, so the button must not be offered.
   */
  const canCheckForUpdates = Updates.isEnabled && !__DEV__;

  async function handleCheck() {
    setUpToDate(false);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) setUpToDate(true);
    } catch {
      // Surfaced through the hook's checkError, which has the message.
    }
  }

  async function handleDownload() {
    try {
      await Updates.fetchUpdateAsync();
    } catch {
      // Surfaced through the hook's downloadError.
    }
  }

  const errorMessage = checkError?.message ?? downloadError?.message;

  return (
    <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <SymbolView
            name={{ ios: 'info.circle', android: 'info' }}
            size={24}
            tintColor={colors.text}
          />
        </View>
        <View style={styles.headerText}>
          <ThemedText style={styles.title}>Version {version}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {!canCheckForUpdates
              ? 'Running from the development server.'
              : createdAt
                ? `${isEmbeddedLaunch ? 'Built in' : 'Updated'} ${formatManifestDate(createdAt)}`
                : 'No update information available.'}
          </ThemedText>
        </View>
      </View>

      {canCheckForUpdates && (
        <View style={styles.actions}>
          {isUpdatePending ? (
            // Downloaded and staged. It applies on the next launch either way, so this
            // button is an offer to have it now, not a step the user must complete.
            <ActionButton
              label="Restart to update"
              filled
              onPress={() => Updates.reloadAsync()}
              material={material}
            />
          ) : isUpdateAvailable ? (
            <ActionButton
              label={
                isDownloading
                  ? downloadProgress != null
                    ? `Downloading ${Math.round(downloadProgress * 100)}%`
                    : 'Downloading…'
                  : 'Download update'
              }
              filled
              busy={isDownloading}
              onPress={handleDownload}
              material={material}
            />
          ) : (
            <ActionButton
              label={isChecking ? 'Checking…' : 'Check for updates'}
              busy={isChecking}
              onPress={handleCheck}
              material={material}
            />
          )}

          {upToDate && !isUpdateAvailable && !isChecking && (
            <ThemedText type="small" themeColor="textSecondary">
              You’re up to date.
            </ThemedText>
          )}

          {errorMessage && (
            <ThemedText type="small" style={{ color: material.error }}>
              {errorMessage}
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  material,
  filled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  material: ReturnType<typeof useMaterialColors>;
  filled?: boolean;
  busy?: boolean;
}) {
  const textColor = filled ? material.onPrimary : material.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        filled
          ? { backgroundColor: material.primary }
          : { borderWidth: 1, borderColor: material.outline },
        busy && styles.buttonBusy,
        pressed && styles.pressed,
      ]}>
      {busy && <ActivityIndicator size="small" color={textColor} />}
      <ThemedText type="small" style={[styles.buttonLabel, { color: textColor }]}>
        {label}
      </ThemedText>
    </Pressable>
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
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  icon: {
    width: 24,
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: '600',
  },
  actions: {
    // Indented to the text column, so the button reads as belonging to the version above
    // it rather than to the card's edge.
    paddingLeft: Spacing.three + 24,
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: 36,
    paddingHorizontal: Spacing.three,
    borderRadius: 18,
  },
  buttonLabel: {
    fontWeight: '600',
  },
  buttonBusy: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.85,
  },
});
