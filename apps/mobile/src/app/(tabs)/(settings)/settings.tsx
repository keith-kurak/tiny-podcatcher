import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { ObserveInteractiveMarker } from 'expo-observe';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';

import { MaterialSwitch } from '@/components/material-switch';
import { StorageLimitRow } from '@/components/storage-limit-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VersionInfo } from '@/components/version-info';
import { Colors, NowPlayingBarHeight, Spacing } from '@/constants/theme';
import { usePruneAutoDownloads } from '@/lib/auto-download';
import { useDownloadContext } from '@/lib/download-context';
import { buildOpml, parseOpml } from '@/lib/opml';
import { publishPlaybackProgress, publishSettings } from '@/lib/playback-sync';
import { fetchFeed } from '@/lib/rss';
import {
  addSubscription,
  getAutoPruneEnabled,
  getAutoPruneKeepCount,
  getPhoneStorageLimitBytes,
  getPhoneStorageLimitEnabled,
  getPhoneUsedBytes,
  getSubscriptions,
  getSyncPlaybackProgress,
  getWatchQueuedBytes,
  getWatchStorageLimitBytes,
  getWatchStorageLimitEnabled,
  getWifiOnlyDownloads,
  MaxAutoPruneKeepCount,
  MinAutoPruneKeepCount,
  setAutoPruneEnabled,
  setAutoPruneKeepCount,
  setCachedEpisodes,
  setPhoneStorageLimitBytes,
  setPhoneStorageLimitEnabled,
  setSyncPlaybackProgress,
  setWatchStorageLimitBytes,
  setWatchStorageLimitEnabled,
  setWifiOnlyDownloads,
} from '@/lib/storage';

const EXPORT_FILE_NAME = 'podcatch-subscriptions.opml';

export default function SettingsScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  const [wifiOnly, setWifiOnly] = useState(getWifiOnlyDownloads);
  const [syncProgress, setSyncProgress] = useState(getSyncPlaybackProgress);
  const [phoneLimitOn, setPhoneLimitOn] = useState(getPhoneStorageLimitEnabled);
  const [phoneLimitBytes, setPhoneLimitBytes] = useState(getPhoneStorageLimitBytes);
  const [watchLimitOn, setWatchLimitOn] = useState(getWatchStorageLimitEnabled);
  const [watchLimitBytes, setWatchLimitBytes] = useState(getWatchStorageLimitBytes);
  const [phoneUsed, setPhoneUsed] = useState(0);
  const [watchQueued, setWatchQueued] = useState(0);
  const [prunePhone, setPrunePhone] = useState(() => getAutoPruneEnabled('phone'));
  const [pruneWatch, setPruneWatch] = useState(() => getAutoPruneEnabled('watch'));
  const [keepCount, setKeepCount] = useState(getAutoPruneKeepCount);
  const { drainPendingDownloads } = useDownloadContext();
  const pruneAutoDownloads = usePruneAutoDownloads();

  useFocusEffect(
    useCallback(() => {
      setSubscriptionCount(getSubscriptions().length);
      // Re-measured on focus rather than held in a query: downloads finish while
      // this screen is off-screen, and the totals walk the filesystem.
      setPhoneUsed(getPhoneUsedBytes());
      setWatchQueued(getWatchQueuedBytes());
    }, []),
  );

  function handlePhoneLimitEnabledChange(enabled: boolean) {
    setPhoneLimitOn(enabled);
    setPhoneStorageLimitEnabled(enabled);
  }

  function handlePhoneLimitBytesChange(bytes: number) {
    setPhoneLimitBytes(bytes);
    setPhoneStorageLimitBytes(bytes);
  }

  function handleWatchLimitEnabledChange(enabled: boolean) {
    setWatchLimitOn(enabled);
    setWatchStorageLimitEnabled(enabled);
  }

  function handleWatchLimitBytesChange(bytes: number) {
    setWatchLimitBytes(bytes);
    setWatchStorageLimitBytes(bytes);
  }

  // Each change that can only remove more applies at once, rather than waiting for the
  // next new episode. Turning cleanup off, or raising the count, removes nothing.
  function handlePruneChange(dest: 'phone' | 'watch', enabled: boolean) {
    (dest === 'phone' ? setPrunePhone : setPruneWatch)(enabled);
    setAutoPruneEnabled(dest, enabled);
    if (enabled) pruneAutoDownloads();
  }

  function handleKeepCountChange(count: number) {
    setAutoPruneKeepCount(count);
    const stored = getAutoPruneKeepCount();
    setKeepCount(stored);
    if (stored < keepCount) pruneAutoDownloads();
  }

  function handleWifiOnlyChange(enabled: boolean) {
    setWifiOnly(enabled);
    setWifiOnlyDownloads(enabled);
    // The watch enforces this itself via its WorkManager constraint, so it needs
    // its own copy. Fire and forget — it re-syncs whenever the watch reconnects.
    publishSettings();
    // Turning the restriction off should release anything it was holding, rather
    // than leave it waiting for a network change that already happened.
    if (!enabled) drainPendingDownloads();
  }

  function handleSyncProgressChange(enabled: boolean) {
    setSyncProgress(enabled);
    setSyncPlaybackProgress(enabled);
    // Both sides check this before sending and before applying, so the watch needs
    // its own copy — otherwise it would keep publishing positions this phone has
    // stopped asking for.
    publishSettings();
    // Turning it on should not wait for the next episode to be played. Publish what
    // this phone already knows, so the watch can catch up straight away.
    if (enabled) publishPlaybackProgress({ immediate: true });
  }

  async function handleExport() {
    const podcasts = getSubscriptions();
    if (podcasts.length === 0) {
      Alert.alert('Nothing to export', 'You have no subscriptions yet.');
      return;
    }

    setBusy('export');
    try {
      const file = new File(Paths.cache, EXPORT_FILE_NAME);
      if (file.exists) file.delete();
      file.create();
      file.write(buildOpml(podcasts));

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Export failed', 'Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        // OPML has no widely-honoured mime type; plain XML is what the
        // Android share targets actually recognise.
        mimeType: 'application/xml',
        dialogTitle: 'Export subscriptions',
      });
    } catch (e: any) {
      Alert.alert('Export failed', e.message ?? 'Could not write the OPML file');
    } finally {
      setBusy(null);
    }
  }

  async function handleImport() {
    setBusy('import');
    try {
      // Many file providers report OPML as a generic type, so accept anything
      // and let the parser reject files that are not OPML.
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      const xml = new File(asset.uri).textSync();
      const feeds = parseOpml(xml);
      if (feeds.length === 0) {
        Alert.alert('Nothing imported', 'That OPML file contains no feeds.');
        return;
      }

      const existing = new Set(getSubscriptions().map((s) => s.feedUrl));
      let added = 0;
      let skipped = 0;
      let failed = 0;

      for (const feed of feeds) {
        if (existing.has(feed.feedUrl)) {
          skipped++;
          continue;
        }
        try {
          const { podcast, episodes } = await fetchFeed(feed.feedUrl);
          addSubscription(podcast);
          setCachedEpisodes(podcast.id, episodes);
          existing.add(feed.feedUrl);
          added++;
        } catch {
          failed++;
        }
      }

      setSubscriptionCount(getSubscriptions().length);

      const parts = [`${added} added`];
      if (skipped > 0) parts.push(`${skipped} already subscribed`);
      if (failed > 0) parts.push(`${failed} failed`);
      Alert.alert('Import complete', parts.join(', ') + '.');
    } catch (e: any) {
      Alert.alert('Import failed', e.message ?? 'Could not read the OPML file');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ThemedView style={styles.container}>
      {/*
        TTI for this route. Unconditional: every row here reads from storage
        synchronously, so the screen is usable on its first render.
      */}
      <ObserveInteractiveMarker />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          DOWNLOADS
        </ThemedText>

        <View style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
          <View style={styles.rowIcon}>
            <SymbolView
              name={{ ios: 'wifi', android: 'wifi' }}
              size={24}
              tintColor={colors.text}
            />
          </View>
          <View style={styles.rowText}>
            <ThemedText style={styles.rowTitle}>Download on Wi-Fi only</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Applies to this phone and your watch. Episodes will wait to download until a Wi-Fi connection is available.
            </ThemedText>
          </View>
          <MaterialSwitch value={wifiOnly} onValueChange={handleWifiOnlyChange} />
        </View>

        <ThemedText
          type="smallBold"
          themeColor="textSecondary"
          style={[styles.sectionTitle, styles.sectionSpacing]}>
          AUTO-DOWNLOAD CLEANUP
        </ThemedText>

        <SwitchRow
          icon={{ ios: 'iphone', android: 'smartphone' }}
          title="Remove old episodes from phone"
          subtitle="Only episodes that were auto-downloaded. Episodes you download yourself stay."
          value={prunePhone}
          onValueChange={(v) => handlePruneChange('phone', v)}
          backgroundColor={colors.backgroundElement}
          tintColor={colors.text}
        />

        <SwitchRow
          icon={{ ios: 'applewatch', android: 'watch' }}
          title="Remove old episodes from watch"
          subtitle="Only episodes that were auto-downloaded. Episodes you send yourself stay."
          value={pruneWatch}
          onValueChange={(v) => handlePruneChange('watch', v)}
          backgroundColor={colors.backgroundElement}
          tintColor={colors.text}
        />

        <View style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
          <View style={styles.rowIcon}>
            <SymbolView
              name={{ ios: 'tray.full', android: 'auto_delete' }}
              size={24}
              tintColor={colors.text}
            />
          </View>
          <View style={styles.rowText}>
            <ThemedText style={styles.rowTitle}>Episodes to keep</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              The newest auto-downloaded episodes kept for each podcast.
            </ThemedText>
          </View>
          <Stepper
            value={keepCount}
            min={MinAutoPruneKeepCount}
            max={MaxAutoPruneKeepCount}
            onChange={handleKeepCountChange}
            tintColor={colors.text}
            pressedColor={colors.backgroundSelected}
          />
        </View>

        <ThemedText
          type="smallBold"
          themeColor="textSecondary"
          style={[styles.sectionTitle, styles.sectionSpacing]}>
          PLAYBACK
        </ThemedText>

        <View style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
          <View style={styles.rowIcon}>
            <SymbolView
              name={{ ios: 'arrow.trianglehead.2.clockwise', android: 'sync' }}
              size={24}
              tintColor={colors.text}
            />
          </View>
          <View style={styles.rowText}>
            <ThemedText style={styles.rowTitle}>Sync latest progress</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Pick up on your watch where you left off on your phone, and the other way
              around. An episode that is playing right now is never moved.
            </ThemedText>
          </View>
          <MaterialSwitch value={syncProgress} onValueChange={handleSyncProgressChange} />
        </View>

        <ThemedText
          type="smallBold"
          themeColor="textSecondary"
          style={[styles.sectionTitle, styles.sectionSpacing]}>
          STORAGE LIMITS
        </ThemedText>

        <StorageLimitRow
          icon={{ ios: 'iphone', android: 'smartphone' }}
          title="Limit phone storage"
          description="Don't download any more podcasts once this limit is reached."
          enabled={phoneLimitOn}
          limitBytes={phoneLimitBytes}
          usedBytes={phoneUsed}
          onEnabledChange={handlePhoneLimitEnabledChange}
          onLimitBytesChange={handlePhoneLimitBytesChange}
        />

        <StorageLimitRow
          icon={{ ios: 'applewatch', android: 'watch' }}
          title="Limit watch storage"
          description="Measured on your watch once downloaded. Episodes still queued are estimated from the size the podcast publishes."
          enabled={watchLimitOn}
          limitBytes={watchLimitBytes}
          usedBytes={watchQueued}
          onEnabledChange={handleWatchLimitEnabledChange}
          onLimitBytesChange={handleWatchLimitBytesChange}
        />

        <ThemedText
          type="smallBold"
          themeColor="textSecondary"
          style={[styles.sectionTitle, styles.sectionSpacing]}>
          SUBSCRIPTIONS
        </ThemedText>

        <SettingsRow
          icon={{ ios: 'square.and.arrow.down', android: 'file_open' }}
          title="Import from OPML"
          subtitle="Add podcasts from an OPML file"
          busy={busy === 'import'}
          disabled={busy != null}
          onPress={handleImport}
          backgroundColor={colors.backgroundElement}
          pressedColor={colors.backgroundSelected}
          tintColor={colors.text}
        />

        <SettingsRow
          icon={{ ios: 'square.and.arrow.up', android: 'share' }}
          title="Export to OPML"
          subtitle={
            subscriptionCount === 1
              ? 'Share 1 subscription as a file'
              : `Share ${subscriptionCount} subscriptions as a file`
          }
          busy={busy === 'export'}
          disabled={busy != null}
          onPress={handleExport}
          backgroundColor={colors.backgroundElement}
          pressedColor={colors.backgroundSelected}
          tintColor={colors.text}
        />

        <VersionInfo />
      </ScrollView>
    </ThemedView>
  );
}

type SymbolName = React.ComponentProps<typeof SymbolView>['name'];

interface SwitchRowProps {
  icon: SymbolName;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  backgroundColor: string;
  tintColor: string;
}

function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  backgroundColor,
  tintColor,
}: SwitchRowProps) {
  return (
    <View style={[styles.row, { backgroundColor }]}>
      <View style={styles.rowIcon}>
        <SymbolView name={icon} size={24} tintColor={tintColor} />
      </View>
      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </View>
      <MaterialSwitch value={value} onValueChange={onValueChange} />
    </View>
  );
}

interface StepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  tintColor: string;
  pressedColor: string;
}

/** A small minus / value / plus control for a whole number. */
function Stepper({ value, min, max, onChange, tintColor, pressedColor }: StepperProps) {
  const button = (delta: -1 | 1) => {
    const disabled = delta < 0 ? value <= min : value >= max;
    return (
      <Pressable
        onPress={() => onChange(value + delta)}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={delta < 0 ? 'Keep fewer' : 'Keep more'}
        style={({ pressed }) => [
          styles.stepperButton,
          pressed && { backgroundColor: pressedColor },
          disabled && styles.rowDisabled,
        ]}>
        <SymbolView
          name={delta < 0 ? { ios: 'minus', android: 'remove' } : { ios: 'plus', android: 'add' }}
          size={20}
          tintColor={tintColor}
        />
      </Pressable>
    );
  };
  return (
    <View style={styles.stepper}>
      {button(-1)}
      <ThemedText style={styles.stepperValue}>{value}</ThemedText>
      {button(1)}
    </View>
  );
}

interface SettingsRowProps {
  icon: SymbolName;
  title: string;
  subtitle: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  backgroundColor: string;
  pressedColor: string;
  tintColor: string;
}

function SettingsRow({
  icon,
  title,
  subtitle,
  busy,
  disabled,
  onPress,
  backgroundColor,
  pressedColor,
  tintColor,
}: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? pressedColor : backgroundColor },
        disabled && !busy && styles.rowDisabled,
      ]}>
      <View style={styles.rowIcon}>
        {busy ? (
          <ActivityIndicator size="small" color={tintColor} />
        ) : (
          <SymbolView name={icon} size={24} tintColor={tintColor} />
        )}
      </View>
      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.three + NowPlayingBarHeight,
    gap: Spacing.two,
  },
  sectionTitle: {
    marginBottom: Spacing.one,
  },
  sectionSpacing: {
    marginTop: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.three,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 20,
    textAlign: 'center',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
