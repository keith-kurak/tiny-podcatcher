import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { feedQueryOptions } from '@/lib/queries';
import { getSubscriptions } from '@/lib/storage';

/** Feeds fetched at once. Enough to finish quickly, few enough not to swamp a slow link. */
const CONCURRENCY = 4;

/**
 * Refresh every subscribed feed on app start and each time the app returns to the
 * foreground.
 *
 * Only stale feeds are fetched: `prefetchQuery` honours the feed query's one-hour
 * `staleTime`, so resuming the app every few minutes costs nothing. Without this, a feed
 * was only fetched when its podcast screen was opened, and the subscriptions tab's
 * "latest episode" sort would be as old as the last visit to each podcast.
 *
 * Takes the client rather than calling `useQueryClient`, because the root layout that
 * runs it is also the component that renders the provider.
 */
export function useFeedAutoRefresh(queryClient: QueryClient) {
  useEffect(() => {
    let running = false;

    async function refreshStaleFeeds() {
      if (running) return;
      running = true;
      try {
        const queue = [...getSubscriptions()];
        // `prefetchQuery` never throws, so one unreachable feed cannot stop the rest.
        const worker = async () => {
          for (let p = queue.shift(); p; p = queue.shift()) {
            await queryClient.prefetchQuery(feedQueryOptions(queryClient, p.id, p.feedUrl));
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      } finally {
        running = false;
      }
    }

    void refreshStaleFeeds();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshStaleFeeds();
    });
    return () => subscription.remove();
  }, [queryClient]);
}
