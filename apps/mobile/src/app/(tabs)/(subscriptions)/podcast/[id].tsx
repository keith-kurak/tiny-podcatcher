import { LegendList } from '@legendapp/list/react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ObserveInteractiveMarker } from 'expo-observe';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { DownloadToggle } from '@/components/download-toggle';
import { Image } from '@/components/image';
import { RemoveDialog } from '@/components/remove-dialog';
import { WatchToggle } from '@/components/watch-toggle';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NowPlayingBarHeight, Spacing } from '@/constants/theme';
import { formatDate, formatDuration } from '@/lib/format';
import { useFeedQuery } from '@/lib/queries';
import { getSubscriptions, removeSubscription } from '@/lib/storage';
import type { Podcast } from '@/lib/types';

const EPISODES_PER_PAGE = 20;
const ESTIMATED_ROW_HEIGHT = 84;

export default function PodcastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const podcast: Podcast | undefined = getSubscriptions().find((s) => s.id === id);
  const { data: episodes = [], isLoading, pullToRefresh, isRefetching } = useFeedQuery(
    id,
    podcast?.feedUrl ?? '',
  );

  const [visibleCount, setVisibleCount] = useState(EPISODES_PER_PAGE);
  const visibleEpisodes = useMemo(
    () => episodes.slice(0, visibleCount),
    [episodes, visibleCount],
  );
  const hasMore = visibleCount < episodes.length;

  const loadNextPage = useCallback(() => {
    setVisibleCount((count) => Math.min(count + EPISODES_PER_PAGE, episodes.length));
  }, [episodes.length]);

  const [showUnsubscribeDialog, setShowUnsubscribeDialog] = useState(false);

  function handleUnsubscribe() {
    removeSubscription(id);
    setShowUnsubscribeDialog(false);
    queryClient.removeQueries({ queryKey: ['feed', id] });
    router.back();
  }

  return (
    <ThemedView style={styles.container}>
      {/*
        TTI for this route, once there are episodes to show. `useFeedQuery` seeds itself
        from the cached episodes, so on a revisit this is the first render and the metric
        stays honest about how quickly the screen was usable.
      */}
      {!isLoading && <ObserveInteractiveMarker />}
      {/*
        `Stack.Title` rather than `Stack.Screen options={{ title }}`: the imperative
        options form replaces the header configuration wholesale, which drops the
        declarative `Stack.Toolbar` items below it.
      */}
      <Stack.Title>{podcast?.title ?? 'Podcast'}</Stack.Title>
      {/*
        The icon is required, not decorative: Android's toolbar renderer drops any button
        without an `ImageSourcePropType` source, so a text-only button silently renders
        nothing. The label survives as the accessibility name.
      */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={require('@/assets/icons/delete.xml')}
          onPress={() => setShowUnsubscribeDialog(true)}
          accessibilityLabel="Unsubscribe">
          Unsubscribe
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <LegendList
        data={visibleEpisodes}
        keyExtractor={(item) => item.guid}
        estimatedItemSize={ESTIMATED_ROW_HEIGHT}
        recycleItems
        refreshing={isRefetching}
        onRefresh={pullToRefresh}
        onEndReached={hasMore ? loadNextPage : undefined}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.episodeRow}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/(subscriptions)/podcast/episode/[episodeId]',
                params: { episodeId: item.guid, podcastId: id },
              })
            }
          >
            <Image
              source={{ uri: item.imageUrl ?? podcast?.artworkUrl }}
              style={styles.thumbnail}
              contentFit="cover"
            />
            <View style={styles.episodeContent}>
              <ThemedText style={styles.episodeTitle} numberOfLines={2}>
                {item.title}
              </ThemedText>
              <View style={styles.episodeMeta}>
                {item.pubDate && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDate(item.pubDate)}
                  </ThemedText>
                )}
                {item.duration && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDuration(item.duration)}
                  </ThemedText>
                )}
              </View>
            </View>
            <WatchToggle podcastId={id} episodeGuid={item.guid} />
            <DownloadToggle podcastId={id} episodeGuid={item.guid} audioUrl={item.audioUrl} />
          </Pressable>
        )}
        ListFooterComponent={
          hasMore ? <ActivityIndicator style={styles.footerSpinner} /> : null
        }
        ListEmptyComponent={
          isLoading ? null : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
              No episodes found.
            </ThemedText>
          )
        }
      />
      <RemoveDialog
        visible={showUnsubscribeDialog}
        title="Unsubscribe?"
        message={`This will remove ${podcast?.title ?? 'this podcast'} and its cached episodes.`}
        onConfirm={handleUnsubscribe}
        onDismiss={() => setShowUnsubscribeDialog(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    paddingBottom: Spacing.three + NowPlayingBarHeight,
  },
  episodeRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.three,
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
  footerSpinner: {
    paddingVertical: Spacing.three,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
