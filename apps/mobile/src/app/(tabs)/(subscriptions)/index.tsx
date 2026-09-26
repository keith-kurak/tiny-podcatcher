import { LegendList } from '@legendapp/list/react-native';
import { FloatingActionButton, Host, Icon, useMaterialColors } from '@expo/ui/jetpack-compose';
import { useQueryClient } from '@tanstack/react-query';
import { ObserveInteractiveMarker } from 'expo-observe';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';

import { Image } from '@/components/image';
import { RemoveDialog } from '@/components/remove-dialog';
import {
  SelectionCheck,
  TileSelectionOverlay,
  useSelectedRowStyle,
} from '@/components/selectable';
import { SelectionActionBar } from '@/components/selection-action-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useNowPlayingInset } from '@/hooks/use-now-playing-inset';
import { useSelectionMode } from '@/hooks/use-selection-mode';
import { formatShortDate } from '@/lib/format';
import { useFeedMetaQuery } from '@/lib/queries';
import {
  getSubscriptions,
  getSubscriptionsSortMode,
  getSubscriptionsViewMode,
  removeSubscription,
  setSubscriptionsSortMode,
  setSubscriptionsViewMode,
  type SubscriptionsSortMode,
  type SubscriptionsViewMode,
} from '@/lib/storage';
import { subscribeToStarterPodcasts } from '@/lib/starter-podcasts';
import type { Podcast } from '@/lib/types';

/** Colors.light and Colors.dark are const-asserted to different literal types. */
type ThemeColors = Record<keyof (typeof Colors)['light'], string>;

const LIST_ROW_HEIGHT = 72;
const TILE_COLUMNS = 3;
const TILE_GAP = Spacing.two;

export default function SubscriptionsScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const nowPlayingInset = useNowPlayingInset();
  const { width } = useWindowDimensions();

  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [viewMode, setViewMode] = useState<SubscriptionsViewMode>(getSubscriptionsViewMode);
  const [sortMode, setSortMode] = useState<SubscriptionsSortMode>(getSubscriptionsSortMode);
  const [addingStarters, setAddingStarters] = useState(false);

  const queryClient = useQueryClient();
  const { data: feedMeta } = useFeedMetaQuery();
  const sortByLatest = sortMode === 'latest';

  const sortedPodcasts = useMemo(() => {
    if (!sortByLatest) return podcasts;
    // A podcast with no dated episode sinks to the bottom rather than jumping the queue.
    const latest = (p: Podcast) => feedMeta?.[p.id]?.latestPubDate ?? 0;
    return [...podcasts].sort((a, b) => latest(b) - latest(a));
  }, [podcasts, feedMeta, sortByLatest]);

  const ids = useMemo(() => sortedPodcasts.map((p) => p.id), [sortedPodcasts]);
  const selection = useSelectionMode(ids);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function handleUnsubscribeSelected() {
    for (const id of selection.ids()) removeSubscription(id);
    // `removeSubscription` also drops the podcast's cached episodes, so the downloads
    // and watch lists lose their join target and those rows disappear on their next
    // read. Re-reading here is what refreshes this screen.
    setPodcasts(getSubscriptions());
    setConfirmRemove(false);
    selection.exit();
  }

  useFocusEffect(
    useCallback(() => {
      setPodcasts(getSubscriptions());
      // Adding a podcast or importing an OPML file writes feeds without going through the
      // feed query, so its invalidation never fired for them.
      queryClient.invalidateQueries({ queryKey: ['feedMeta'] });
    }, [queryClient]),
  );

  function handleViewModeChange(mode: SubscriptionsViewMode) {
    setViewMode(mode);
    setSubscriptionsViewMode(mode);
  }

  function handleSortModeChange(mode: SubscriptionsSortMode) {
    setSortMode(mode);
    setSubscriptionsSortMode(mode);
  }

  /** The newest episode's date, shown on each podcast only while sorting by it. */
  function latestLabel(podcast: Podcast): string | undefined {
    if (!sortByLatest) return undefined;
    const latest = feedMeta?.[podcast.id]?.latestPubDate;
    return latest ? formatShortDate(latest) : undefined;
  }

  async function handleAddStarters() {
    setAddingStarters(true);
    try {
      const { added, failed } = await subscribeToStarterPodcasts();
      setPodcasts(getSubscriptions());
      // Silent on a clean run — the shows appearing is the confirmation. Only speak up
      // when something is missing, so the user is not left wondering.
      if (failed.length > 0) {
        Alert.alert(
          added > 0 ? 'Added some of them' : 'Could not add them',
          `${failed.join(', ')} could not be fetched. Check your connection and try again.`,
        );
      }
    } finally {
      setAddingStarters(false);
    }
  }

  // Tiles are square, so the row height is the cell width. Worked out here rather than
  // left to flex because the list needs an item size up front.
  const gridPadding = Spacing.three;
  const tileSize =
    (width - gridPadding * 2 - TILE_GAP * (TILE_COLUMNS - 1)) / TILE_COLUMNS;

  const isTile = viewMode === 'tile';

  return (
    <ThemedView style={styles.container}>
      {/*
        Marks Time to Interactive for app startup. It lives here, in the landing screen,
        rather than in the root layout: the expo-observe router integration attributes the
        metric from the current route, and a layout above the navigator has none — the
        call is dropped there. Rendered unconditionally because subscriptions come out of
        storage synchronously, so this screen is usable as soon as it renders.
      */}
      <ObserveInteractiveMarker />
      {/* One header at a time: the layout menu belongs to browsing, not to selecting. */}
      {selection.active ? (
        <SelectionActionBar
          count={selection.count}
          onExit={selection.exit}
          onDelete={() => setConfirmRemove(true)}
          deleteLabel={`Unsubscribe from ${selection.count} ${
            selection.count === 1 ? 'podcast' : 'podcasts'
          }`}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu
            icon={require('@/assets/icons/more_vert.xml')}
            title="View options"
            accessibilityLabel="View options">
            <Stack.Toolbar.MenuAction
              icon={require('@/assets/icons/view_module.xml')}
              isOn={isTile}
              onPress={() => handleViewModeChange('tile')}>
              Tile view
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon={require('@/assets/icons/view_list.xml')}
              isOn={!isTile}
              onPress={() => handleViewModeChange('list')}>
              List view
            </Stack.Toolbar.MenuAction>
            {/* Inline: drawn as a divided section of this menu, not a submenu to open. */}
            <Stack.Toolbar.Menu inline title="Sort">
              <Stack.Toolbar.MenuAction
                icon={require('@/assets/icons/reorder.xml')}
                isOn={!sortByLatest}
                onPress={() => handleSortModeChange('manual')}>
                Manual order
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon={require('@/assets/icons/schedule.xml')}
                isOn={sortByLatest}
                onPress={() => handleSortModeChange('latest')}>
                Latest episode
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}

      <LegendList
        // Remounts on layout change: item size and column count both change, and the list
        // caches measurements keyed by index.
        key={viewMode}
        data={sortedPodcasts}
        keyExtractor={(item) => item.id}
        extraData={selection.extraData}
        numColumns={isTile ? TILE_COLUMNS : 1}
        estimatedItemSize={isTile ? tileSize + TILE_GAP : LIST_ROW_HEIGHT}
        recycleItems
        contentContainerStyle={[
          { padding: gridPadding, paddingBottom: gridPadding + nowPlayingInset },
          podcasts.length === 0 && styles.emptyList,
        ]}
        renderItem={({ item }) =>
          isTile ? (
            <TileCell
              podcast={item}
              latestLabel={latestLabel(item)}
              size={tileSize}
              placeholderColor={colors.backgroundElement}
              selecting={selection.active}
              selected={selection.isSelected(item.id)}
              onToggle={() => selection.toggle(item.id)}
              onStartSelection={() => selection.start(item.id)}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/(subscriptions)/podcast/[id]',
                  params: { id: item.id },
                })
              }
            />
          ) : (
            <ListRow
              podcast={item}
              latestLabel={latestLabel(item)}
              colors={colors}
              selecting={selection.active}
              selected={selection.isSelected(item.id)}
              onToggle={() => selection.toggle(item.id)}
              onStartSelection={() => selection.start(item.id)}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/(subscriptions)/podcast/[id]',
                  params: { id: item.id },
                })
              }
            />
          )
        }
        ListEmptyComponent={
          <EmptyState
            busy={addingStarters}
            colors={colors}
            onAddStarters={handleAddStarters}
          />
        }
      />

      {/*
        Material FAB from Expo UI's Jetpack Compose bindings. `Host` bridges the Compose
        tree into React Native; `matchContents` sizes it to the button so the wrapper does
        not swallow touches around it.
      */}
      <RemoveDialog
        visible={confirmRemove}
        title={
          selection.count === 1
            ? 'Unsubscribe?'
            : `Unsubscribe from ${selection.count} podcasts?`
        }
        message={
          selection.count === 1
            ? 'This will remove the podcast and its cached episodes.'
            : `This will remove ${selection.count} podcasts and their cached episodes.`
        }
        onConfirm={handleUnsubscribeSelected}
        onDismiss={() => setConfirmRemove(false)}
      />

      <Host
        matchContents
        style={[
          styles.fabHost,
          // Offset from this screen's own bottom edge, which already sits above the tab
          // bar — adding `BottomTabInset` here (as the now-playing bar must, being a
          // sibling of the tab bar rather than inside a screen) lifted the button a whole
          // tab-bar height too high. Only the now-playing bar needs clearing.
          { bottom: nowPlayingInset + Spacing.three },
        ]}>
        <FloatingActionButton onClick={() => router.push('/add-podcast')}>
          <FloatingActionButton.Icon>
            <Icon source={require('@/assets/icons/add.xml')} size={24} />
          </FloatingActionButton.Icon>
        </FloatingActionButton>
      </Host>
    </ThemedView>
  );
}

/**
 * Shown when nothing is subscribed yet.
 *
 * The FAB is the real way to add a podcast, but it demands a feed URL to hand — which is
 * a lot to ask of someone who just wants to see what the app does. The link fills the app
 * with a few shows so every other screen has something in it.
 */
function EmptyState({
  busy,
  colors,
  onAddStarters,
}: {
  busy: boolean;
  colors: ThemeColors;
  onAddStarters: () => void;
}) {
  return (
    <View style={styles.empty}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
        No subscriptions yet. Tap + to add a podcast.
      </ThemedText>
      {busy ? (
        <View style={styles.starterLink}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
        </View>
      ) : (
        <Pressable
          onPress={onAddStarters}
          accessibilityRole="button"
          style={({ pressed }) => [styles.starterLink, pressed && styles.pressed]}>
          <ThemedText type="small" style={styles.starterLinkText}>
            Add some good ones to try things out
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/** Artwork-only grid cell. The title is exposed to screen readers, not drawn. */
function TileCell({
  podcast,
  latestLabel,
  size,
  placeholderColor,
  selecting,
  selected,
  onToggle,
  onStartSelection,
  onPress,
}: {
  podcast: Podcast;
  latestLabel?: string;
  size: number;
  placeholderColor: string;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onStartSelection: () => void;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={selecting ? onToggle : onPress}
      onLongPress={onStartSelection}
      accessibilityRole="button"
      accessibilityLabel={podcast.title}
      accessibilityState={selecting ? { selected } : undefined}
      style={({ pressed }) => [
        { width: size, height: size, marginBottom: TILE_GAP },
        pressed && styles.pressed,
      ]}>
      {podcast.artworkUrl ? (
        <Image
          source={{ uri: podcast.artworkUrl }}
          style={styles.tileArtwork}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.tileArtwork, { backgroundColor: placeholderColor }]}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
            {podcast.title}
          </ThemedText>
        </View>
      )}
      {/*
        A tile keeps its artwork when selected — it is the only thing identifying the
        show — so the state is a scrim and a badge over the top rather than the row's
        swap-the-thumbnail treatment.
      */}
      {latestLabel && <DateTag label={latestLabel} />}
      <TileSelectionOverlay selected={selected} />
    </Pressable>
  );
}

function ListRow({
  podcast,
  latestLabel,
  colors,
  selecting,
  selected,
  onToggle,
  onStartSelection,
  onPress,
}: {
  podcast: Podcast;
  latestLabel?: string;
  colors: ThemeColors;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onStartSelection: () => void;
  onPress: () => void;
}) {
  const selectedStyle = useSelectedRowStyle(selected);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.backgroundSelected : 'transparent' },
        selectedStyle,
      ]}
      accessibilityState={selecting ? { selected } : undefined}
      onLongPress={onStartSelection}
      onPress={selecting ? onToggle : onPress}>
      {selecting && <SelectionCheck selected={selected} />}
      {podcast.artworkUrl ? (
        <Image
          source={{ uri: podcast.artworkUrl }}
          style={styles.artwork}
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={[
            styles.artwork,
            styles.artworkPlaceholder,
            { backgroundColor: colors.backgroundElement },
          ]}
        />
      )}
      <View style={styles.rowText}>
        <ThemedText numberOfLines={1} style={styles.podcastTitle}>
          {podcast.title}
        </ThemedText>
        {podcast.author && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {podcast.author}
          </ThemedText>
        )}
      </View>
      {latestLabel && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowDate}>
          {latestLabel}
        </ThemedText>
      )}
    </Pressable>
  );
}

/** The newest episode's date, pinned to a tile's lower-right corner over the artwork. */
function DateTag({ label }: { label: string }) {
  const material = useMaterialColors();
  return (
    <View
      pointerEvents="none"
      style={[styles.dateTag, { backgroundColor: material.secondaryContainer }]}>
      <ThemedText
        type="small"
        style={[styles.dateTagText, { color: material.onSecondaryContainer }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  podcastTitle: {
    fontWeight: '600',
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
  },
  starterLink: {
    marginTop: Spacing.three,
    // Padding rather than margin: it is the touch target, and a line of small text is
    // well under the 48dp minimum on its own.
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  starterLinkText: {
    fontWeight: '600',
    // The palette has no accent colour, so the underline is what makes this read as
    // something you can tap rather than a second line of help text.
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  tileArtwork: {
    width: '100%',
    height: '100%',
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.two,
    borderRadius: Spacing.two,
    gap: Spacing.three,
  },
  artwork: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  artworkPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowDate: {
    // Lower right of the row, level with the author line rather than centred.
    alignSelf: 'flex-end',
  },
  dateTag: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dateTagText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  fabHost: {
    position: 'absolute',
    right: Spacing.three,
  },
});
