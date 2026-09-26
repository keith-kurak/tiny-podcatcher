import {
  Host,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';

import { MessageDialog } from '@/components/message-dialog';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  UPDATE_CHANNELS,
  channelLabel,
  updatesActive,
  useSwitchUpdateChannel,
  useUpdateChannel,
  type ChannelSwitchResult,
  type UpdateChannelId,
} from '@/lib/update-channel';

const SegmentedButtonRowHeight = 48;

/** What to tell the user after a switch that did not reload. */
function resultMessage(
  result: Exclude<ChannelSwitchResult, 'reloading'>,
  label: string,
): { title: string; message: string } {
  switch (result) {
    case 'no-update':
      return {
        title: 'No update found',
        message:
          `No update found on the ${label} channel. If you stay on this channel, any ` +
          'later updates will be loaded as they are available.',
      };
    case 'offline':
      return {
        title: `Switched to ${label}`,
        message:
          'The update server could not be reached. The latest update on this channel ' +
          'will download the next time the app can reach it.',
      };
    case 'unsupported':
      return {
        title: 'Cannot switch channels',
        message: 'This build does not support switching update channels.',
      };
  }
}

/**
 * Hidden settings, reached by tapping the version number in Settings seven times.
 *
 * For now it holds one thing: which OTA update channel the app follows. Beta and alpha get
 * changes before stable.
 */
export default function ExtraStuffScreen() {
  const theme = useTheme();
  const channel = useUpdateChannel();
  const switchChannel = useSwitchUpdateChannel();
  const [switchingTo, setSwitchingTo] = useState<UpdateChannelId | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string } | null>(null);
  const { currentlyRunning } = Updates.useUpdates();

  async function handleSelect(target: UpdateChannelId) {
    if (target === channel || switchingTo) return;
    setSwitchingTo(target);
    const result = await switchChannel(target, {
      backgroundColor: theme.background,
      spinner: { color: theme.text, size: 'medium' },
    });
    // A reload replaces this screen, so the spinner stays up until it does.
    if (result === 'reloading') return;
    setSwitchingTo(null);
    setDialog(resultMessage(result, channelLabel(target)));
  }

  const running = currentlyRunning.isEmbeddedLaunch
    ? 'the version built into the app'
    : `update ${currentlyRunning.updateId?.slice(0, 8) ?? 'unknown'}`;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            UPDATE CHANNEL
          </ThemedText>
          <Host style={styles.segmentedHost} useViewportSizeMeasurement>
            <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
              {UPDATE_CHANNELS.map((c) => (
                <SegmentedButton
                  key={c.id}
                  selected={c.id === channel}
                  enabled={updatesActive && switchingTo == null}
                  onClick={() => void handleSelect(c.id)}>
                  <SegmentedButton.Label>
                    <Text>{c.label}</Text>
                  </SegmentedButton.Label>
                </SegmentedButton>
              ))}
            </SingleChoiceSegmentedButtonRow>
          </Host>
          <ThemedText type="small" themeColor="textSecondary">
            Beta and alpha get changes before stable, and can be less reliable. Switching
            downloads the channel&apos;s latest update and restarts the app.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {updatesActive
              ? `Running ${running} from the ${channelLabel(currentlyRunning.channel ?? null)} channel.`
              : 'Channel switching works only in release builds, not from the development server.'}
          </ThemedText>
        </View>
      </ScrollView>

      <Modal visible={switchingTo != null} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.scrim}>
          <View style={[styles.spinnerCard, { backgroundColor: theme.backgroundElement }]}>
            <ActivityIndicator color={theme.text} size="large" />
            <ThemedText>Switching to {channelLabel(switchingTo)}…</ThemedText>
          </View>
        </View>
      </Modal>

      <MessageDialog
        visible={dialog != null}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        onDismiss={() => setDialog(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  segmentedHost: {
    height: SegmentedButtonRowHeight,
  },
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  spinnerCard: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.three,
  },
});
