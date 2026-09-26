import {
  Host,
  MultiChoiceSegmentedButtonRow,
  SegmentedButton,
  Text,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';

import { Image } from '@/components/image';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { autoDownloadQueryKey, useSetAutoDownload } from '@/lib/auto-download';
import { formatTimeAgo, stripHtml } from '@/lib/format';
import {
  getAutoDownloadState,
  type AutoDownloadDestination,
  type AutoDownloadDestinationState,
} from '@/lib/storage';
import type { Podcast } from '@/lib/types';

/** Lines of description shown before "More". */
const DESCRIPTION_LINES = 3;

const SegmentedButtonRowHeight = 48;

interface PodcastHeaderProps {
  podcast: Podcast;
  episodeCount?: number;
  /** Reports where the title ends, so the screen can show it in the nav bar once scrolled past. */
  onTitleLayout?: (bottom: number) => void;
}

/**
 * The top of a subscribed podcast's episode list: artwork, full title, description, and
 * the per-podcast auto-download control.
 */
export function PodcastHeader({ podcast, episodeCount, onTitleLayout }: PodcastHeaderProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const description = podcast.description ? stripHtml(podcast.description) : '';
  // Measured from a hidden, unclamped copy of the text, so "More" appears only when the
  // clamp actually hides something. The visible copy cannot tell us: a clamped text
  // reports only the lines it draws.
  const [fullLineCount, setFullLineCount] = useState(0);
  const canExpand = fullLineCount > DESCRIPTION_LINES;

  const { data: autoDownload } = useQuery({
    queryKey: autoDownloadQueryKey(podcast.id),
    queryFn: () => getAutoDownloadState(podcast.id),
  });
  const setAutoDownload = useSetAutoDownload();

  function handleIdentityLayout(event: LayoutChangeEvent) {
    const { y, height } = event.nativeEvent.layout;
    onTitleLayout?.(y + height);
  }

  return (
    <View style={styles.container}>
      <View style={styles.identity} onLayout={handleIdentityLayout}>
        {podcast.artworkUrl ? (
          <Image
            source={{ uri: podcast.artworkUrl }}
            style={styles.artwork}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.artwork, { backgroundColor: theme.backgroundElement }]} />
        )}
        <View style={styles.identityText}>
          <ThemedText style={styles.title} numberOfLines={3}>
            {podcast.title}
          </ThemedText>
          {podcast.author && (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {podcast.author}
            </ThemedText>
          )}
          {episodeCount != null && episodeCount > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {episodeCount === 1 ? '1 episode' : `${episodeCount} episodes`}
            </ThemedText>
          )}
        </View>
      </View>

      {description !== '' && (
        <Pressable
          disabled={!canExpand}
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole={canExpand ? 'button' : undefined}
          accessibilityHint={canExpand ? (expanded ? 'Shows less' : 'Shows more') : undefined}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={expanded ? undefined : DESCRIPTION_LINES}>
            {description}
          </ThemedText>
          <ThemedText
            type="small"
            style={styles.measure}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onTextLayout={(event: NativeSyntheticEvent<TextLayoutEventData>) =>
              setFullLineCount(event.nativeEvent.lines.length)
            }>
            {description}
          </ThemedText>
          {canExpand && (
            <ThemedText type="smallBold" style={styles.moreToggle}>
              {expanded ? 'Less' : 'More'}
            </ThemedText>
          )}
        </Pressable>
      )}

      {autoDownload && (
        <View style={styles.autoDownload}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            AUTO-DOWNLOAD LATEST EPISODE
          </ThemedText>
          <Host style={styles.segmentedHost} useViewportSizeMeasurement>
            <MultiChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
              {(['phone', 'watch'] as const).map((dest) => (
                <SegmentedButton
                  key={dest}
                  checked={autoDownload[dest].enabled}
                  onCheckedChange={(checked) => setAutoDownload(podcast.id, dest, checked)}>
                  <SegmentedButton.Label>
                    <Text>{dest === 'phone' ? 'Phone' : 'Watch'}</Text>
                  </SegmentedButton.Label>
                </SegmentedButton>
              ))}
            </MultiChoiceSegmentedButtonRow>
          </Host>
          {(['phone', 'watch'] as const).map((dest) => {
            const text = statusText(dest, autoDownload[dest]);
            return text ? (
              <ThemedText key={dest} type="small" themeColor="textSecondary" numberOfLines={2}>
                {text}
              </ThemedText>
            ) : null;
          })}
        </View>
      )}
    </View>
  );
}

/** One line on what the last check did for a destination, or null when there is nothing to say. */
function statusText(
  dest: AutoDownloadDestination,
  state: AutoDownloadDestinationState,
): string | null {
  const check = state.lastCheck;
  if (!state.enabled || !check) return null;
  const label = dest === 'phone' ? 'Phone' : 'Watch';
  const when = formatTimeAgo(check.at);
  switch (check.outcome) {
    case 'queued':
      return `${label}: queued “${check.episodeTitle}” · ${when}`;
    case 'present':
      return dest === 'phone'
        ? `${label}: latest episode already downloaded`
        : `${label}: latest episode already on the watch`;
    case 'limit':
      return `${label}: skipped, storage limit reached · ${when}`;
  }
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  identity: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'center',
  },
  artwork: {
    width: 96,
    height: 96,
    borderRadius: Spacing.two,
  },
  identityText: {
    flex: 1,
    gap: Spacing.one,
  },
  title: {
    fontWeight: '600',
    fontSize: 20,
    lineHeight: 26,
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
  },
  moreToggle: {
    marginTop: Spacing.one,
  },
  autoDownload: {
    gap: Spacing.two,
  },
  segmentedHost: {
    height: SegmentedButtonRowHeight,
  },
});
