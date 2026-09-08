import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { ObserveInteractiveMarker } from 'expo-observe';
import { SymbolView } from 'expo-symbols';
import { Stack, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Image } from '@/components/image';
import { RemoveDialog } from '@/components/remove-dialog';
import { SelectionCheck, useSelectedRowStyle } from '@/components/selectable';
import { SelectionActionBar } from '@/components/selection-action-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NowPlayingBarHeight, Spacing } from '@/constants/theme';
import { useScrollToActiveDownload } from '@/hooks/use-scroll-to-active-download';
import { useSelectionMode } from '@/hooks/use-selection-mode';
import { useStatusColors } from '@/hooks/use-status-colors';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes, formatDate, formatDuration } from '@/lib/format';
import { useWatchListQuery, useWatchListMutations, type EnrichedDownloadItem } from '@/lib/queries';
import {
  getConnectedNodes,
  sendForceDownload,
  requestWatchDownloadStatus,
  retryWatchEpisode,
} from '@/hooks/useWearDataLayer';
import { useWatchStatuses } from '@/lib/watch-status-context';
import type { WatchEpisodeStatus } from '../../../../modules/wear-data-layer/src';

/** Minimum time the refresh spinner stays visible, so it does not just flicker. */
const MIN_SPINNER_MS = 600;

const ESTIMATED_ROW_HEIGHT = 76;

const WatchRow = memo(function WatchRow({
  item,
  watchStatus,
  selecting,
  selected,
  onToggle,
  onStartSelection,
}: {
  item: EnrichedDownloadItem;
  watchStatus: WatchEpisodeStatus | undefined;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onStartSelection: () => void;
}) {
  const router = useRouter();
  const statusColors = useStatusColors();
  const selectedStyle = useSelectedRowStyle(selected);
  const status = watchStatus?.status ?? 'pending';
  const progress = watchStatus?.progress ?? 0;
  // What the watch measured beats what the feed claimed. Falls back to the feed size
  // until the download finishes, and for watch builds that do not report a size.
  const displaySize =
    watchStatus?.sizeBytes && watchStatus.sizeBytes > 0
      ? watchStatus.sizeBytes
      : item.sizeBytes;
  const isDownloading = status === 'downloading';

  return (
    <Pressable
      style={[styles.episodeRow, selectedStyle]}
      onLongPress={onStartSelection}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected } : undefined}
      onPress={() => {
        if (selecting) {
          onToggle();
          return;
        }
        router.push({
          pathname: '/(tabs)/(watch)/episode/[episodeId]',
          params: { episodeId: item.episodeGuid, podcastId: item.podcastId },
        });
      }}
    >
      {selecting && <SelectionCheck selected={selected} />}
      <Image
        source={{ uri: item.episode.imageUrl ?? item.podcast?.artworkUrl }}
        style={styles.thumbnail}
        contentFit="cover"
      />
      <View style={styles.episodeContent}>
        <ThemedText style={styles.episodeTitle} numberOfLines={2}>
          {item.episode.title}
        </ThemedText>
        <View style={styles.episodeMeta}>
          {isDownloading && (
            <ThemedText type="small" themeColor="textSecondary">
              Downloading… {progress > 0 ? `${progress}%` : ''}
            </ThemedText>
          )}
          {status === 'pending' && (
            <ThemedText type="small" themeColor="textSecondary">
              Waiting…
            </ThemedText>
          )}
          {status === 'waiting-wifi' && (
            <ThemedText type="small" style={{ color: statusColors.waiting }}>
              Waiting for Wi-Fi
            </ThemedText>
          )}
          {status === 'error' && (
            <ThemedText type="small" style={{ color: statusColors.error }}>
              Error
            </ThemedText>
          )}
          {status === 'halted' && (
            <ThemedText type="small" style={{ color: statusColors.error }}>
              Paused after watch restarts — sync to retry
            </ThemedText>
          )}
          {status === 'no-space' && (
            <ThemedText type="small" style={{ color: statusColors.error }}>
              Watch storage full
            </ThemedText>
          )}
          {status === 'complete' && item.episode.pubDate && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatDate(item.episode.pubDate)}
            </ThemedText>
          )}
          {item.episode.duration && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatDuration(item.episode.duration)}
            </ThemedText>
          )}
          {/* Pushed to the far right of the meta row, level with the date and duration. */}
          {formatBytes(displaySize) !== '' && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.sizeText}>
              {formatBytes(displaySize)}
            </ThemedText>
          )}
        </View>
        {isDownloading && (
          <View style={[styles.progressTrack, { backgroundColor: statusColors.progressTrack }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress}%`, backgroundColor: statusColors.progressFill },
              ]}
            />
          </View>
        )}
      </View>
    </Pressable>
  );
});

export default function WatchScreen() {
  const theme = useTheme();
  const statusColors = useStatusColors();
  const watchStatuses = useWatchStatuses();
  const { data: watchList = [], isLoading, refetch, isRefetching } = useWatchListQuery();
  const { triggerSync, removeMany } = useWatchListMutations();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const guids = useMemo(() => watchList.map((w) => w.episodeGuid), [watchList]);
  const selection = useSelectionMode(guids);
  const [confirmRemove, setConfirmRemove] = useState(false);

  /**
   * Retry only when every selected episode failed.
   *
   * Long-press used to open a retry dialog, which is the gesture selection now owns, so
   * retry moved into the action bar. Gating on "all errored" keeps it honest: an action
   * that silently skipped the healthy half of a mixed selection would be worse than one
   * that is simply absent.
   */
  const allErrored =
    selection.count > 0 &&
    selection.ids().every((guid) => watchStatuses.get(guid)?.status === 'error');

  const handleRetrySelected = useCallback(() => {
    for (const guid of selection.ids()) retryWatchEpisode(guid).catch(() => {});
    // The watch reports its own status back, which is what actually updates the rows.
    // Nothing optimistic here: if a message is lost the row must keep saying Error.
    selection.exit();
  }, [selection]);

  function handleRemoveSelected() {
    removeMany.mutate({ episodeGuids: selection.ids() });
    setConfirmRemove(false);
    selection.exit();
  }

  // Both drive row appearance, and the list recycles rows — a single value would leave
  // the other one's changes invisible.
  const listExtraData = useMemo(
    () => ({ statuses: watchStatuses, selected: selection.extraData }),
    [watchStatuses, selection.extraData],
  );

  const listRef = useRef<LegendListRef>(null);
  const hasActiveDownload = watchList.some(
    (item) => watchStatuses.get(item.episodeGuid)?.status === 'downloading',
  );
  useScrollToActiveDownload(listRef, hasActiveDownload);

  const checkConnection = useCallback(() => {
    if (Platform.OS !== 'android') {
      setConnected(null);
      return;
    }
    getConnectedNodes().then((nodes) => setConnected(nodes.length > 0));
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const handleRefresh = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      checkConnection();
      triggerSync();
      await Promise.all([
        sendForceDownload().catch(() => {}),
        requestWatchDownloadStatus().catch(() => {}),
      ]);
      // These resolve as soon as the messages are handed to the Data Layer, which is
      // near-instant. Hold the spinner briefly so the refresh reads as an action
      // rather than a flicker.
      await new Promise((resolve) => setTimeout(resolve, MIN_SPINNER_MS));
    } finally {
      setIsSyncing(false);
    }
  }, [checkConnection, triggerSync, isSyncing]);

  return (
    <ThemedView style={styles.container}>
      {/* TTI for this route, once the watch list has loaded. See downloads.tsx. */}
      {!isLoading && <ObserveInteractiveMarker />}
      {/*
        One header or the other, never both. The imperative `options` form replaces the
        header configuration wholesale, so leaving it mounted would drop the action bar's
        declarative toolbar items — the same trap documented on the podcast screen.
      */}
      {selection.active ? (
        <SelectionActionBar
          count={selection.count}
          onExit={selection.exit}
          onDelete={() => setConfirmRemove(true)}
          onSelectAll={selection.selectAll}
          deleteLabel={`Remove ${selection.count} ${
            selection.count === 1 ? 'episode' : 'episodes'
          } from watch`}
          extraAction={
            allErrored
              ? {
                  icon: require('@/assets/icons/sync.xml'),
                  label: 'Retry',
                  onPress: handleRetrySelected,
                }
              : undefined
          }
        />
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <Pressable onPress={handleRefresh} disabled={isSyncing} hitSlop={8}>
                {isSyncing ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <SymbolView
                    name={{ ios: 'arrow.trianglehead.2.clockwise', android: 'sync' }}
                    size={22}
                    tintColor={theme.text}
                  />
                )}
              </Pressable>
            ),
          }}
        />
      )}
      {connected !== null && Platform.OS === 'android' && (
        <View
          style={[
            styles.banner,
            // 20 = ~12% alpha, so the banner reads as a tint rather than a solid block.
            { backgroundColor: connected ? `${statusColors.success}20` : theme.backgroundElement },
          ]}
        >
          <ThemedText type="small" style={connected ? { color: statusColors.success } : undefined}>
            {connected ? 'Watch connected' : 'No watch connected'}
          </ThemedText>
        </View>
      )}
      <LegendList
        ref={listRef}
        data={watchList}
        extraData={listExtraData}
        keyExtractor={(item) => item.episodeGuid}
        estimatedItemSize={ESTIMATED_ROW_HEIGHT}
        recycleItems
        refreshing={isRefetching}
        onRefresh={() => refetch()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <WatchRow
            item={item}
            watchStatus={watchStatuses.get(item.episodeGuid)}
            selecting={selection.active}
            selected={selection.isSelected(item.episodeGuid)}
            onToggle={() => selection.toggle(item.episodeGuid)}
            onStartSelection={() => selection.start(item.episodeGuid)}
          />
        )}
        ListEmptyComponent={
          isLoading ? null : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No episodes queued for watch.
            </ThemedText>
          )
        }
      />

      <RemoveDialog
        visible={confirmRemove}
        title={
          selection.count === 1 ? 'Remove episode?' : `Remove ${selection.count} episodes?`
        }
        message={
          selection.count === 1
            ? 'This will remove the episode from your watch queue.'
            : `This will remove ${selection.count} episodes from your watch queue.`
        }
        onConfirm={handleRemoveSelected}
        onDismiss={() => setConfirmRemove(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  banner: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three + NowPlayingBarHeight,
  },
  episodeRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.three,
    // Horizontal padding belongs to the row rather than the list, so the selected
    // tint has room inside it instead of running edge to edge against the text. The
    // list gives back the same amount, leaving content where it always sat.
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    // Row spacing lives here rather than as a contentContainerStyle gap, which
    // a virtualized list cannot apply to its absolutely positioned items.
    marginBottom: Spacing.one,
    gap: Spacing.three,
    alignItems: 'center',
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  episodeContent: {
    flex: 1,
    gap: Spacing.one,
  },
  episodeTitle: {
    fontWeight: '600' as const,
  },
  episodeMeta: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  sizeText: {
    // Takes the remaining width so the size sits against the right edge whatever
    // else the meta row happens to be showing.
    flex: 1,
    textAlign: 'right',
  },
  progressTrack: {
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 1.5,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
