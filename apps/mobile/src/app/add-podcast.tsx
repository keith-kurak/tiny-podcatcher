import { LegendList } from '@legendapp/list/react-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ObserveInteractiveMarker } from 'expo-observe';
import { useRouter } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { Image } from '@/components/image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing } from '@/constants/theme';
import { useMaterialColors } from '@expo/ui/jetpack-compose';
import {
  feedIdForUrl,
  fetchFeed,
  looksLikeFeedUrl,
  resolveFeedUrl,
  searchPodcasts,
  type PodcastSearchResult,
} from '@/lib/rss';
import { addSubscription, getSubscriptions, setCachedEpisodes } from '@/lib/storage';
import type { Episode, Podcast } from '@/lib/types';

interface FoundFeed {
  podcast: Podcast;
  episodes: Episode[];
}

/** Either palette. `Colors.light` alone types as its own literals and rejects the dark set. */
type ThemeColors = (typeof Colors)[keyof typeof Colors];

/**
 * Long enough that a word typed at speed is one request, short enough that results feel
 * like they are keeping up.
 */
const SEARCH_DEBOUNCE_MS = 400;

/** One or two letters match most of the directory; the results are noise until three. */
const MIN_SEARCH_LENGTH = 3;

const ROW_HEIGHT = 72;

/**
 * Fold away the differences that do not change what Apple returns, so "The Daily" and
 * "the daily " share one React Query cache entry instead of two.
 */
function normalizeTerm(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Modal for adding a podcast: find a show, then confirm and subscribe.
 *
 * **One input, two meanings.** Typing a name searches Apple's directory; typing
 * something URL-shaped offers to load that feed directly. There is no mode switch,
 * because the alternative — tabs, or a link to a second screen — makes the reader
 * choose a path before they have typed anything, and the input can tell on its own.
 * See `looksLikeFeedUrl`, which deliberately errs toward searching.
 *
 * Either route ends at the same confirmation step, and that step is fed by `fetchFeed`
 * in both cases. A search result is a pointer to a feed, never a source of truth about
 * it: the title, artwork and episode count on the confirm card are the feed's own, so
 * what is stored matches what the app will show later.
 *
 * Deliberately does not browse episodes before subscribing — the decision here is only
 * "is this the right show?", which the artwork and title answer.
 */
export default function AddPodcastScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const material = useMaterialColors();
  const [query, setQuery] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundFeed | null>(null);

  const trimmed = query.trim();
  const isUrl = looksLikeFeedUrl(trimmed);
  const term = normalizeTerm(trimmed);

  // Debounce only the search term. A URL is never searched, so it never starts a timer.
  useEffect(() => {
    if (isUrl) return;
    const id = setTimeout(() => setDebouncedTerm(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term, isUrl]);

  const searchEnabled = !isUrl && !found && debouncedTerm.length >= MIN_SEARCH_LENGTH;

  const {
    data: results = [],
    isFetching: searching,
    error: searchError,
  } = useQuery({
    queryKey: ['podcast-search', debouncedTerm],
    queryFn: ({ signal }) => searchPodcasts(debouncedTerm, { signal }),
    enabled: searchEnabled,
    // The QueryClient's 5-minute staleTime is the real cache here: backspacing a letter
    // and retyping it, or reopening this modal, costs nothing.
    placeholderData: keepPreviousData,
  });

  // `keepPreviousData` is what stops the list flashing empty between keystrokes, but it
  // also hands back the last results when the query is disabled — so clearing the input
  // would leave the old list on screen. These gate on the *current* text rather than the
  // debounced copy, so the list goes when the text does.
  const hasTerm = !isUrl && !found && term.length >= MIN_SEARCH_LENGTH;
  const showResults = hasTerm && results.length > 0;
  /** False during the debounce window, when `results` still belongs to the last term. */
  const searchedThisTerm = debouncedTerm === term;

  /** Fetch a feed and move to the confirm step. Shared by both routes in. */
  async function loadFeed(url: string) {
    setLoadingFeed(true);
    setError(null);
    try {
      // Accepts an RSS URL or an Apple Podcasts link.
      const resolved = await resolveFeedUrl(url);
      const { podcast, episodes } = await fetchFeed(resolved);
      setFound({ podcast, episodes });
    } catch (e: any) {
      setError(e.message ?? 'Could not fetch that feed');
    } finally {
      setLoadingFeed(false);
    }
  }

  function handleSubscribe() {
    if (!found) return;
    addSubscription(found.podcast);
    // Cache alongside the subscription so the episode list is populated on first open.
    setCachedEpisodes(found.podcast.id, found.episodes);
    router.back();
  }

  const alreadySubscribed =
    found != null && getSubscriptions().some((s) => s.id === found.podcast.id);

  // Read once per render rather than per row: the list is 25 rows and this hits storage.
  const subscribedIds = new Set(getSubscriptions().map((s) => s.id));

  if (found) {
    return (
      <ThemedView style={styles.container}>
        <ObserveInteractiveMarker />
        <View style={styles.confirmStep}>
          {found.podcast.artworkUrl ? (
            <Image
              source={{ uri: found.podcast.artworkUrl }}
              style={styles.artwork}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.artwork, { backgroundColor: colors.backgroundElement }]} />
          )}

          <ThemedText style={styles.foundTitle} numberOfLines={3}>
            {found.podcast.title}
          </ThemedText>
          {found.podcast.author && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {found.podcast.author}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {found.episodes.length === 1 ? '1 episode' : `${found.episodes.length} episodes`}
          </ThemedText>

          <Pressable
            onPress={handleSubscribe}
            disabled={alreadySubscribed}
            accessibilityRole="button"
            accessibilityLabel={alreadySubscribed ? 'Already subscribed' : 'Subscribe'}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: material.primary },
              alreadySubscribed && styles.buttonDisabled,
              pressed && !alreadySubscribed && styles.pressed,
            ]}>
            <ThemedText style={[styles.primaryButtonText, { color: material.onPrimary }]}>
              {alreadySubscribed ? 'Already subscribed' : 'Subscribe'}
            </ThemedText>
          </Pressable>

          {/* Back to the search results rather than closing — a wrong show is the likely
              reason, and the results that produced it are still cached. */}
          <Pressable
            onPress={() => setFound(null)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <ThemedText type="small" themeColor="textSecondary">
              Back to search
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/*
        TTI for this route. Unconditional: the screen opens on an empty input field, so it
        is ready as soon as it renders — searching is what the user does next, not
        something they wait on to start.
      */}
      <ObserveInteractiveMarker />

      <View style={styles.searchArea}>
        <View style={styles.inputWrap}>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.backgroundElement, color: colors.text },
            ]}
            placeholder="Search podcasts, or paste a feed URL"
            placeholderTextColor={colors.textSecondary}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => {
              // Submitting a URL is the only case the debounce cannot serve: there is no
              // search to run, so the keyboard's action key is what loads it.
              if (isUrl && !loadingFeed) loadFeed(trimmed);
            }}
            editable={!loadingFeed}
          />
          {/*
            `clearButtonMode` is iOS-only and this app ships Android, where a wrong paste
            otherwise costs one backspace per character — a pasted feed URL is easily
            forty of them.
          */}
          {query.length > 0 && !loadingFeed && (
            <Pressable
              onPress={() => {
                setQuery('');
                setError(null);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
              <ThemedText themeColor="textSecondary" style={styles.clearGlyph}>
                ✕
              </ThemedText>
            </Pressable>
          )}
        </View>

        {error && (
          <ThemedText type="small" style={[styles.errorText, { color: material.error }]}>
            {error}
          </ThemedText>
        )}
      </View>

      {loadingFeed ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={material.primary} />
          <ThemedText type="small" themeColor="textSecondary">
            Loading feed…
          </ThemedText>
        </View>
      ) : isUrl ? (
        <FeedUrlRow url={trimmed} onPress={() => loadFeed(trimmed)} colors={colors} />
      ) : searchError ? (
        <View style={styles.centerState}>
          <ThemedText type="small" style={{ color: material.error }}>
            {(searchError as Error).message}
          </ThemedText>
        </View>
      ) : showResults ? (
        <LegendList
          data={results}
          keyExtractor={(item) => item.id}
          estimatedItemSize={ROW_HEIGHT}
          recycleItems
          // Without this a tap while the keyboard is open only dismisses the keyboard,
          // and the row underneath needs a second tap.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ResultRow
              item={item}
              subscribed={subscribedIds.has(feedIdForUrl(item.feedUrl))}
              onPress={() => loadFeed(item.feedUrl)}
              colors={colors}
            />
          )}
        />
      ) : searching || (hasTerm && !searchedThisTerm) ? (
        // The second half covers the debounce window. Without it the screen reads "No
        // podcasts found" for 400ms on every new search, before the request even starts.
        <View style={styles.centerState}>
          <ActivityIndicator color={material.primary} />
        </View>
      ) : (
        <View style={styles.centerState}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            {hasTerm
              ? `No podcasts found for “${trimmed}”.`
              : 'Search Apple’s podcast directory by name, or paste an RSS feed URL to add it directly.'}
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

/**
 * The single row shown when the input looks like an address instead of a name.
 *
 * It exists so the URL path is never implicit: the reader sees that their paste was
 * understood as a feed, and taps to confirm, rather than wondering why no results came.
 */
function FeedUrlRow({
  url,
  onPress,
  colors,
}: {
  url: string;
  onPress: () => void;
  colors: ThemeColors;
}) {
  let host = url;
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    // Leave the raw text: it is only a subtitle, and the tap still works.
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Load feed from ${host}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.rowArt, styles.rowArtPlaceholder, { backgroundColor: colors.backgroundElement }]}>
        <ThemedText style={styles.linkGlyph} themeColor="textSecondary">
          ⧉
        </ThemedText>
      </View>
      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle} numberOfLines={1}>
          Load this feed
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {host}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const ResultRow = memo(function ResultRow({
  item,
  subscribed,
  onPress,
  colors,
}: {
  item: PodcastSearchResult;
  subscribed: boolean;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        subscribed ? `${item.title}, already subscribed` : `Add ${item.title}`
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {item.artworkUrl ? (
        <Image
          source={{ uri: item.artworkUrl }}
          style={styles.rowArt}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={[
            styles.rowArt,
            styles.rowArtPlaceholder,
            { backgroundColor: colors.backgroundElement },
          ]}
        />
      )}
      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle} numberOfLines={1}>
          {item.title}
        </ThemedText>
        {item.author && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {item.author}
          </ThemedText>
        )}
        {subscribed && (
          <ThemedText type="small" themeColor="textSecondary">
            Subscribed
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchArea: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  confirmStep: {
    padding: Spacing.three,
    gap: Spacing.three,
    alignItems: 'center',
  },
  inputWrap: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  input: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: Spacing.two,
    paddingLeft: Spacing.three,
    // Reserved for the clear button, always — text reflowing as the button appears and
    // disappears is worse than a little dead space in an empty field.
    paddingRight: Spacing.five + Spacing.three,
    fontSize: 16,
  },
  clearButton: {
    position: 'absolute',
    right: Spacing.one,
    height: 48,
    width: Spacing.five + Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearGlyph: {
    fontSize: 16,
  },
  list: {
    paddingBottom: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: ROW_HEIGHT,
  },
  rowArt: {
    width: 56,
    height: 56,
    borderRadius: Spacing.two,
  },
  rowArtPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkGlyph: {
    fontSize: 22,
  },
  rowText: {
    flex: 1,
    // Without a floor, a long title wrapping to one line makes the row jump as the list
    // recycles. `flex: 1` handles the width; this keeps the height honest.
    minWidth: 0,
  },
  rowTitle: {
    fontWeight: '600',
  },
  centerState: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    // Sits under the input rather than centred in the remaining space. The field
    // autofocuses, so the keyboard is up whenever this shows — anything centred lands
    // behind it — and a hint next to the input reads as belonging to it.
  },
  hint: {
    textAlign: 'center',
  },
  artwork: {
    width: 180,
    height: 180,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
  },
  foundTitle: {
    fontWeight: '600',
    fontSize: 20,
    textAlign: 'center',
  },
  errorText: {
    alignSelf: 'stretch',
  },
  primaryButton: {
    alignSelf: 'stretch',
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontWeight: '600',
  },
  secondaryButton: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
});
