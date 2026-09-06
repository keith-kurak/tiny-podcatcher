import { LegendList } from '@legendapp/list/react-native';
import { useQuery } from '@tanstack/react-query';
import { ObserveInteractiveMarker } from 'expo-observe';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';

import { Image } from '@/components/image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useMaterialColors } from '@expo/ui/jetpack-compose';
import { formatDate, formatDuration } from '@/lib/format';
import { fetchFeed, resolveFeedUrl } from '@/lib/rss';
import { addSubscription, getSubscriptions, setCachedEpisodes } from '@/lib/storage';
import type { Episode } from '@/lib/types';

/**
 * How many episodes the preview lists.
 *
 * A preview answers "is this the show I mean, and is it still going?" — the newest
 * handful settles both. The full back catalogue is what subscribing is for, and paging
 * through hundreds of rows here would just be the podcast screen with no way to act on
 * anything.
 */
const RECENT_EPISODE_COUNT = 20;

const ESTIMATED_ROW_HEIGHT = 84;

/**
 * A podcast, before you subscribe to it.
 *
 * Pushed from the search screen so the back button returns to the results. Everything
 * shown comes from the feed rather than from the search result that led here — the
 * search directory's title and artwork are passed along only to fill the header while
 * the feed loads, since what gets stored on subscribe must be what the app will show
 * afterwards.
 *
 * Episodes are listed, not tappable. Playing or downloading one needs a subscription for
 * the episode to belong to, and a row that looks pressable but is not is worse than a
 * row that plainly is not.
 */
export default function PodcastPreviewScreen() {
  const { feedUrl, title, artworkUrl } = useLocalSearchParams<{
    feedUrl: string;
    title?: string;
    artworkUrl?: string;
  }>();
  const router = useRouter();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const material = useMaterialColors();

  const [justSubscribed, setJustSubscribed] = useState(false);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['feed-preview', feedUrl],
    queryFn: async () => {
      // Accepts an RSS URL or an Apple Podcasts link, and adds a scheme when the input
      // was typed without one.
      const resolved = await resolveFeedUrl(feedUrl);
      return fetchFeed(resolved);
    },
  });

  const podcast = data?.podcast;
  const episodes = data?.episodes ?? [];
  const recent = episodes.slice(0, RECENT_EPISODE_COUNT);
  const remaining = episodes.length - recent.length;

  const alreadySubscribed =
    podcast != null && getSubscriptions().some((s) => s.id === podcast.id);

  function handleSubscribe() {
    if (!data) return;
    addSubscription(data.podcast);
    // Cache alongside the subscription so the episode list is populated on first open.
    setCachedEpisodes(data.podcast.id, data.episodes);
    setJustSubscribed(true);
    // Two, because this screen and the search screen are both routes of the root stack:
    // popping both lands on Subscriptions, where the show now appears. The search that
    // found it has served its purpose.
    router.dismiss(2);
  }

  return (
    <ThemedView style={styles.container}>
      {/* TTI for this route, once the feed has answered and there is something to judge. */}
      {!isLoading && <ObserveInteractiveMarker />}
      <Stack.Title>{podcast?.title || title || 'Podcast'}</Stack.Title>

      {error ? (
        <View style={styles.centerState}>
          <ThemedText style={styles.errorTitle}>Could not load that feed</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {(error as Error).message}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {feedUrl}
          </ThemedText>
          <Pressable
            onPress={() => refetch()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.retryButton,
              { borderColor: material.outline },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="small" style={{ color: material.primary, fontWeight: '600' }}>
              Try again
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <LegendList
          data={recent}
          keyExtractor={(item) => item.guid}
          estimatedItemSize={ESTIMATED_ROW_HEIGHT}
          recycleItems
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <PreviewHeader
              artworkUrl={podcast?.artworkUrl ?? (artworkUrl || undefined)}
              title={podcast?.title || title || ''}
              author={podcast?.author}
              episodeCount={data ? episodes.length : undefined}
              loading={isLoading}
              subscribed={alreadySubscribed || justSubscribed}
              canSubscribe={data != null}
              onSubscribe={handleSubscribe}
              colors={colors}
              material={material}
            />
          }
          ListFooterComponent={
            remaining > 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.footerNote}>
                {remaining === 1
                  ? '1 older episode in the feed'
                  : `${remaining} older episodes in the feed`}
              </ThemedText>
            ) : null
          }
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator style={styles.listSpinner} color={material.primary} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                This feed lists no episodes.
              </ThemedText>
            )
          }
          renderItem={({ item }) => (
            <EpisodeRow
              episode={item}
              fallbackArtwork={podcast?.artworkUrl}
              colors={colors}
            />
          )}
        />
      )}
    </ThemedView>
  );
}

function PreviewHeader({
  artworkUrl,
  title,
  author,
  episodeCount,
  loading,
  subscribed,
  canSubscribe,
  onSubscribe,
  colors,
  material,
}: {
  artworkUrl?: string;
  title: string;
  author?: string;
  episodeCount?: number;
  loading: boolean;
  subscribed: boolean;
  canSubscribe: boolean;
  onSubscribe: () => void;
  colors: (typeof Colors)[keyof typeof Colors];
  material: ReturnType<typeof useMaterialColors>;
}) {
  return (
    <View style={styles.header}>
      {artworkUrl ? (
        <Image
          source={{ uri: artworkUrl }}
          style={styles.artwork}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.artwork, { backgroundColor: colors.backgroundElement }]} />
      )}

      {title !== '' && (
        <ThemedText style={styles.title} numberOfLines={3}>
          {title}
        </ThemedText>
      )}
      {author && (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {author}
        </ThemedText>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        {/* Only the feed can say how many there are, so this waits rather than guessing. */}
        {episodeCount == null
          ? 'Loading episodes…'
          : episodeCount === 1
            ? '1 episode'
            : `${episodeCount} episodes`}
      </ThemedText>

      <Pressable
        onPress={onSubscribe}
        disabled={subscribed || !canSubscribe}
        accessibilityRole="button"
        accessibilityLabel={subscribed ? 'Already subscribed' : 'Subscribe'}
        style={({ pressed }) => [
          styles.subscribeButton,
          { backgroundColor: material.primary },
          (subscribed || !canSubscribe) && styles.buttonDisabled,
          pressed && !subscribed && canSubscribe && styles.pressed,
        ]}>
        {loading ? (
          <ActivityIndicator size="small" color={material.onPrimary} />
        ) : (
          <ThemedText style={[styles.subscribeLabel, { color: material.onPrimary }]}>
            {subscribed ? 'Already subscribed' : 'Subscribe'}
          </ThemedText>
        )}
      </Pressable>

      {episodeCount != null && episodeCount > 0 && (
        <ThemedText
          type="smallBold"
          themeColor="textSecondary"
          style={styles.recentHeading}>
          RECENT EPISODES
        </ThemedText>
      )}
    </View>
  );
}

function EpisodeRow({
  episode,
  fallbackArtwork,
  colors,
}: {
  episode: Episode;
  fallbackArtwork?: string;
  colors: (typeof Colors)[keyof typeof Colors];
}) {
  const uri = episode.imageUrl ?? fallbackArtwork;

  return (
    <View style={styles.episodeRow}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumbnail} contentFit="cover" />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: colors.backgroundElement }]} />
      )}
      <View style={styles.episodeContent}>
        <ThemedText style={styles.episodeTitle} numberOfLines={2}>
          {episode.title}
        </ThemedText>
        <View style={styles.episodeMeta}>
          {episode.pubDate && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatDate(episode.pubDate)}
            </ThemedText>
          )}
          {episode.duration && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatDuration(episode.duration)}
            </ThemedText>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  artwork: {
    width: 160,
    height: 160,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  title: {
    fontWeight: '600',
    fontSize: 20,
    textAlign: 'center',
  },
  subscribeButton: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  subscribeLabel: {
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  recentHeading: {
    alignSelf: 'flex-start',
    marginTop: Spacing.four,
  },
  episodeRow: {
    flexDirection: 'row',
    paddingVertical: Spacing.three,
    // Row spacing lives here rather than as a contentContainerStyle gap, which a
    // virtualized list cannot apply to its absolutely positioned items.
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
    fontWeight: '600',
  },
  episodeMeta: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  footerNote: {
    textAlign: 'center',
    paddingTop: Spacing.three,
  },
  listSpinner: {
    paddingVertical: Spacing.four,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  errorTitle: {
    fontWeight: '600',
    fontSize: 18,
  },
  retryButton: {
    height: 40,
    paddingHorizontal: Spacing.four,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  pressed: {
    opacity: 0.85,
  },
});
