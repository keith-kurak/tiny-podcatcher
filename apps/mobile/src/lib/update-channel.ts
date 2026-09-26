import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Updates from 'expo-updates';
import { useCallback } from 'react';

import { getSelectedUpdateChannel, setSelectedUpdateChannel } from './storage';

/** The channels the Extra Stuff screen offers, in order. `production` is what users call stable. */
export const UPDATE_CHANNELS = [
  { id: 'production', label: 'Stable' },
  { id: 'beta', label: 'Beta' },
  { id: 'alpha', label: 'Alpha' },
] as const;

export type UpdateChannelId = (typeof UPDATE_CHANNELS)[number]['id'];

/**
 * Whether OTA updates can actually run. `Updates.isEnabled` is also true in a development
 * build, where the bundle comes from Metro and every updates call throws.
 */
export const updatesActive = Updates.isEnabled && !__DEV__;

export function isNonStableChannel(channel: string | null): channel is 'beta' | 'alpha' {
  return channel === 'beta' || channel === 'alpha';
}

export function channelLabel(channel: string | null): string {
  return UPDATE_CHANNELS.find((c) => c.id === channel)?.label ?? channel ?? 'Unknown';
}

const updateChannelQueryKey = ['updateChannel'] as const;

/**
 * The channel the app is on: the one chosen on the Extra Stuff screen, else the channel the
 * running build or update came from.
 */
export function useUpdateChannel(): string | null {
  const { data } = useQuery({
    queryKey: updateChannelQueryKey,
    queryFn: () => getSelectedUpdateChannel() ?? Updates.channel ?? null,
  });
  return data ?? null;
}

/**
 * What a channel switch did.
 *
 * - `reloading`: an update was downloaded and the app is reloading into it.
 * - `no-update`: the switch took, but the channel has nothing newer yet. Later checks use the
 *   new channel, so its first update downloads like any other.
 * - `offline`: the switch took, but the update server could not be reached.
 * - `unsupported`: this build cannot switch channels. Nothing changed.
 */
export type ChannelSwitchResult = 'reloading' | 'no-update' | 'offline' | 'unsupported';

/**
 * Switch the OTA channel, then fetch and reload into its update if it has one.
 * See https://docs.expo.dev/eas-update/channel-surfing/#switch-channels.
 *
 * The override is written with an explicit channel name rather than cleared with `null`
 * for stable, so stable means `production` on every build — a preview build's own channel
 * is `preview`.
 */
export function useSwitchUpdateChannel() {
  const queryClient = useQueryClient();

  return useCallback(
    async (
      channel: UpdateChannelId,
      reloadScreenOptions?: Updates.ReloadScreenOptions,
    ): Promise<ChannelSwitchResult> => {
      try {
        // Throws when the build did not declare `expo-channel-name` in its request headers.
        // EAS Build declares it for any profile with a `channel`.
        Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': channel });
      } catch {
        return 'unsupported';
      }
      setSelectedUpdateChannel(channel);
      queryClient.invalidateQueries({ queryKey: updateChannelQueryKey });

      try {
        const result = await Updates.checkForUpdateAsync();
        // Known and accepted: no reload keeps this session on its current update, but the
        // launcher only starts updates downloaded under the current channel header, so the
        // next cold start runs the embedded bundle until this channel publishes an update.
        if (!result.isAvailable) return 'no-update';
        await Updates.fetchUpdateAsync();
      } catch {
        return 'offline';
      }
      await Updates.reloadAsync({ reloadScreenOptions });
      return 'reloading';
    },
    [queryClient],
  );
}
