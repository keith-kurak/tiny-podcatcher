import { XMLParser } from 'fast-xml-parser';

import { HTTP_HEADERS } from './http';
import type { Episode, Podcast } from './types';

// An RSS feed returns every episode in one document, so this is only an upper
// bound to keep memory in check. The podcast screen pages through the result.
const MAX_EPISODES = 1000;

function hashFeedUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) - hash + url.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// Apple Podcasts share links look like
// https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1000700000000
// The country and slug segments vary, and an episode link carries an extra
// `?i=`, but every form contains the show's numeric id as an `id<digits>` path
// segment.
const APPLE_PODCASTS_HOST = /(^|\.)(podcasts|itunes)\.apple\.com$/i;
const APPLE_SHOW_ID = /\/id(\d+)/;

export function parseApplePodcastsId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!APPLE_PODCASTS_HOST.test(parsed.hostname)) return null;
  return parsed.pathname.match(APPLE_SHOW_ID)?.[1] ?? null;
}

// The iTunes Lookup API is public and needs no key. It returns the RSS feed
// URL that Apple Podcasts itself reads.
export async function lookupAppleFeedUrl(showId: string): Promise<string> {
  const res = await fetch(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(showId)}&entity=podcast`,
    { headers: HTTP_HEADERS },
  );
  if (!res.ok) throw new Error(`Apple Podcasts lookup failed: ${res.status}`);

  const data = await res.json();
  const result = data?.results?.find((r: any) => r?.feedUrl);
  if (!result) {
    throw new Error('Apple Podcasts did not return an RSS feed for that link');
  }
  return String(result.feedUrl);
}

// Accepts an RSS feed URL or an Apple Podcasts link and returns a feed URL.
export async function resolveFeedUrl(input: string): Promise<string> {
  const url = withScheme(input.trim());
  const showId = parseApplePodcastsId(url);
  return showId ? lookupAppleFeedUrl(showId) : url;
}

/**
 * A hostname followed by a dotted TLD, optionally with a path.
 *
 * The `[a-z]{2,}` on the last label is what keeps a show called "99.9" out: it has a
 * dot, but "9" is not a TLD. Requiring two letters costs nothing real — no podcast feed
 * lives on a single-letter TLD.
 */
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/|$)/i;

/**
 * Decide whether typed text is a feed address rather than something to search for.
 *
 * This is the whole basis of the single input on the add screen, so it errs toward
 * "search": a wrong guess here sends a real URL to the search API and finds nothing,
 * which looks broken, whereas searching for something URL-shaped just returns nothing
 * and the user adds a scheme.
 *
 * Any whitespace means a search — podcast names have spaces and URLs do not.
 */
export function looksLikeFeedUrl(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return BARE_DOMAIN.test(s);
}

/** `feeds.npr.org/…` is a URL a person would type; `fetch` needs the scheme spelled out. */
function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) || !url ? url : `https://${url}`;
}

/**
 * The id `fetchFeed` will give a podcast at this URL.
 *
 * Exported so the search list can mark shows that are already subscribed without
 * fetching every feed first. Subscription ids are hashes of the feed URL, and the URL
 * hashed is the one handed to `fetchFeed` — the same one iTunes reports — so the two
 * agree.
 */
export function feedIdForUrl(url: string): string {
  return hashFeedUrl(url);
}

/** One show from the iTunes Search API, trimmed to the fields the add screen renders. */
export interface PodcastSearchResult {
  /** iTunes `collectionId`. Stable, and unique per show, so it keys the list. */
  id: string;
  title: string;
  author?: string;
  feedUrl: string;
  artworkUrl?: string;
  episodeCount?: number;
}

/** Enough to scroll through, and small enough to stay a ~40 KB response. */
const SEARCH_LIMIT = 25;

/**
 * Search Apple's podcast directory by name.
 *
 * Called straight from the device rather than through a proxy of ours. The API is
 * public and keyless, it sends `Access-Control-Allow-Origin: *` so the web build works
 * too, and its rate limit is per-IP — which a proxy would turn into one shared budget
 * for every user of the app, and one shared failure. Sending [HTTP_HEADERS] keeps the
 * calls attributable to this app rather than to an anonymous OkHttp default.
 *
 * @param signal from React Query, so typing another character abandons the request in
 * flight instead of racing it.
 */
export async function searchPodcasts(
  term: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<PodcastSearchResult[]> {
  const q = term.trim();
  if (!q) return [];

  const res = await fetch(
    'https://itunes.apple.com/search' +
      `?media=podcast&entity=podcast&limit=${SEARCH_LIMIT}` +
      `&term=${encodeURIComponent(q)}`,
    { headers: HTTP_HEADERS, signal },
  );

  // Worth its own message: it is the one failure the user fixes by waiting rather than
  // by typing something different.
  if (res.status === 429) {
    throw new Error('Too many searches at once. Try again in a moment.');
  }
  if (!res.ok) throw new Error(`Podcast search failed: ${res.status}`);

  // Apple serves this as `text/javascript`; `json()` parses on content, not on the
  // declared type, so it reads fine.
  const data = await res.json();
  const raw: any[] = Array.isArray(data?.results) ? data.results : [];

  const seen = new Set<string>();
  const results: PodcastSearchResult[] = [];

  for (const r of raw) {
    const feedUrl = typeof r?.feedUrl === 'string' ? r.feedUrl : '';
    // A directory entry with no feed cannot be subscribed to, so it is not a result.
    // Apple returns these for shows it has delisted.
    if (!feedUrl || seen.has(feedUrl)) continue;
    seen.add(feedUrl);

    results.push({
      id: String(r.collectionId ?? feedUrl),
      title: String(r.collectionName ?? r.trackName ?? 'Untitled'),
      author: r.artistName ? String(r.artistName) : undefined,
      feedUrl,
      // 100px for a list row. `artworkUrl600` is the same image four times the bytes,
      // and the confirm card takes its artwork from the feed anyway.
      artworkUrl: r.artworkUrl100 ?? r.artworkUrl600 ?? r.artworkUrl60 ?? undefined,
      episodeCount: Number.isFinite(r.trackCount) ? Number(r.trackCount) : undefined,
    });
  }

  return results;
}

export async function fetchFeed(
  url: string,
): Promise<{ podcast: Podcast; episodes: Episode[] }> {
  const res = await fetch(url, { headers: HTTP_HEADERS });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const parsed = parser.parse(xml);
  const channel = parsed.rss?.channel;
  if (!channel) throw new Error('Invalid RSS feed: no <channel> found');

  const id = hashFeedUrl(url);

  const podcast: Podcast = {
    id,
    feedUrl: url,
    title: channel.title ?? 'Untitled',
    author: channel['itunes:author'] ?? undefined,
    description: channel.description ?? undefined,
    artworkUrl:
      channel['itunes:image']?.['@_href'] ??
      channel.image?.url ??
      undefined,
  };

  const rawItems = channel.item
    ? Array.isArray(channel.item)
      ? channel.item
      : [channel.item]
    : [];

  const episodes: Episode[] = rawItems.slice(0, MAX_EPISODES).map((item: any) => ({
    guid: String(
      item.guid?.['#text'] ?? item.guid ?? item.enclosure?.['@_url'] ?? item.title ?? '',
    ),
    title: item.title ?? 'Untitled',
    description: item.description ?? item['itunes:summary'] ?? undefined,
    pubDate: item.pubDate ?? undefined,
    audioUrl: item.enclosure?.['@_url'] ?? undefined,
    duration: item['itunes:duration'] != null ? String(item['itunes:duration']) : undefined,
    imageUrl: item['itunes:image']?.['@_href'] ?? undefined,
    sizeBytes: parseEnclosureLength(item.enclosure?.['@_length']),
  }));

  return { podcast, episodes };
}

/**
 * Read `enclosure/@length`. Feeds routinely set this to 0, an empty string, or a
 * non-numeric placeholder, so anything that is not a positive integer becomes
 * undefined rather than a bogus 0-byte size.
 */
function parseEnclosureLength(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}
