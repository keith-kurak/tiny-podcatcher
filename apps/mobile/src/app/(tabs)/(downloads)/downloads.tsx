import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { ObserveInteractiveMarker } from 'expo-observe';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

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
import { useAudio } from '@/lib/audio-context';
import { useDownloadContext } from '@/lib/download-context';
import { formatBytes, formatDate, formatDuration } from '@/lib/format';
import { useDownloadMutations, useDownloadsQuery, type EnrichedDownloadItem } from '@/lib/queries';

const ESTIMATED_ROW_HEIGHT = 76;

function DownloadRow({
  item,
  selecting,
  selected,
  onToggle,
  onStartSelection,
}: {
  item: EnrichedDownloadItem;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onStartSelection: () => void;
}) {
  const router = useRouter();
  const status = useStatusColors();
  const { getProgress, isWaitingForWifi } = useDownloadContext();
  const progress = getProgress(item.episodeGuid);
  const isDownloading = item.status === 'downloading' || progress != null;
  const waitingForWifi = item.status === 'pending' && !isDownloading && isWaitingForWifi;
  const selectedStyle = useSelectedRowStyle(selected);

  return (
    <Pressable
      style={[styles.episodeRow, selectedStyle]}
      onLongPress={onStartSelection}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected } : undefined}
      onPress={() => {
        // While a selection is running the row is a checkbox, not a link. Navigating
        // away mid-selection would lose it.
        if (selecting) {
          onToggle();
          return;
        }
        router.push({
          pathname: '/(tabs)/(downloads)/episode/[episodeId]',
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
              Downloading… {progress != null ? `${Math.round(progress * 100)}%` : ''}
            </ThemedText>
          )}
          {waitingForWifi && (
            <ThemedText type="small" style={{ color: status.waiting }}>
              Waiting for Wi-Fi
            </ThemedText>
          )}
          {item.status === 'error' && (
            <ThemedText type="small" style={{ color: status.error }}>
              Error
            </ThemedText>
          )}
          {item.status === 'complete' && item.episode.pubDate && (
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
          {formatBytes(item.sizeBytes) !== '' && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.sizeText}>
              {formatBytes(item.sizeBytes)}
            </ThemedText>
          )}
        </View>
        {isDownloading && (
          <View style={[styles.progressTrack, { backgroundColor: status.progressTrack }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round((progress ?? 0) * 100)}%`, backgroundColor: status.progressFill },
              ]}
            />
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function DownloadsScreen() {
  const { data: downloads = [], isLoading, refetch, isRefetching } = useDownloadsQuery();
  const { getProgress } = useDownloadContext();
  const { removeMany } = useDownloadMutations();
  const { currentEpisode, pause } = useAudio();

  const guids = useMemo(() => downloads.map((d) => d.episodeGuid), [downloads]);
  const selection = useSelectionMode(guids);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleDelete() {
    const ids = selection.ids();
    // Deleting the file under the player leaves it holding a path that no longer exists.
    // Stopping first is the difference between "the episode is gone" and "playback
    // silently broke".
    if (currentEpisode && ids.includes(currentEpisode.guid)) pause();
    removeMany.mutate({ episodeGuids: ids });
    setConfirmDelete(false);
    selection.exit();
  }

  const listRef = useRef<LegendListRef>(null);
  // `status` alone is not enough: an item is 'downloading' in storage only after the
  // task starts, while getProgress reflects bytes actually moving.
  const hasActiveDownload = downloads.some(
    (d) => d.status === 'downloading' || getProgress(d.episodeGuid) != null,
  );
  useScrollToActiveDownload(listRef, hasActiveDownload);

  return (
    <ThemedView style={styles.container}>
      {/*
        TTI for this route. Gated on the query rather than rendered on mount: the list is
        what this screen is for, and marking while it is still loading would report a
        screen that had nothing in it yet as interactive.
      */}
      {!isLoading && <ObserveInteractiveMarker />}
      {selection.active && (
        <SelectionActionBar
          count={selection.count}
          onExit={selection.exit}
          onDelete={() => setConfirmDelete(true)}
          onSelectAll={selection.selectAll}
          deleteLabel={`Delete ${selection.count} ${
            selection.count === 1 ? 'download' : 'downloads'
          }`}
        />
      )}
      <LegendList
        ref={listRef}
        data={downloads}
        keyExtractor={(item) => item.episodeGuid}
        extraData={selection.extraData}
        estimatedItemSize={ESTIMATED_ROW_HEIGHT}
        recycleItems
        refreshing={isRefetching}
        onRefresh={() => refetch()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <DownloadRow
            item={item}
            selecting={selection.active}
            selected={selection.isSelected(item.episodeGuid)}
            onToggle={() => selection.toggle(item.episodeGuid)}
            onStartSelection={() => selection.start(item.episodeGuid)}
          />
        )}
        ListEmptyComponent={
          isLoading ? null : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No episodes on phone.
            </ThemedText>
          )
        }
      />
      <RemoveDialog
        visible={confirmDelete}
        title={selection.count === 1 ? 'Delete download?' : `Delete ${selection.count} downloads?`}
        message={
          selection.count === 1
            ? 'This will delete the downloaded episode from your phone.'
            : `This will delete ${selection.count} downloaded episodes from your phone.`
        }
        onConfirm={handleDelete}
        onDismiss={() => setConfirmDelete(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
