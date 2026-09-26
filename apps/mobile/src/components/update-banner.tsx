import { useMaterialColors } from '@expo/ui/jetpack-compose';
import { SymbolView } from 'expo-symbols';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { updatesActive } from '@/lib/update-channel';

/**
 * A dismissable banner at the top of the app once an OTA update is downloaded. Tapping it
 * reloads into the update.
 *
 * `useAutoUpdate` finds and downloads updates on launch and on return to the foreground;
 * this only offers the restart. Dismissing hides the banner for that update only, and the
 * update still applies on the next cold start. A newer update brings the banner back.
 *
 * Render once, from the root layout.
 */
export function UpdateBanner() {
  const material = useMaterialColors();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [dismissedUpdateId, setDismissedUpdateId] = useState<string | null>(null);

  const updateId = downloadedUpdate?.updateId ?? null;
  if (!updatesActive || !isUpdatePending || updateId === dismissedUpdateId) return null;

  function handleReload() {
    void Updates.reloadAsync({
      reloadScreenOptions: {
        backgroundColor: theme.background,
        spinner: { color: theme.text, size: 'medium' },
      },
    });
  }

  return (
    <View style={[styles.wrapper, { top: insets.top + Spacing.two }]} pointerEvents="box-none">
      <View style={[styles.banner, { backgroundColor: material.inverseSurface }]}>
        <Pressable
          onPress={handleReload}
          accessibilityRole="button"
          accessibilityLabel="Update ready. Restart to update"
          style={({ pressed }) => [styles.message, pressed && styles.pressed]}>
          <SymbolView
            name={{ ios: 'arrow.down.circle', android: 'system_update' }}
            tintColor={material.inverseOnSurface}
            size={22}
          />
          <View style={styles.text}>
            <ThemedText type="smallBold" style={{ color: material.inverseOnSurface }}>
              Update ready
            </ThemedText>
            <ThemedText type="small" style={{ color: material.inverseOnSurface }}>
              Tap to restart and update
            </ThemedText>
          </View>
        </Pressable>
        <Pressable
          onPress={() => setDismissedUpdateId(updateId)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <SymbolView
            name={{ ios: 'xmark', android: 'close' }}
            tintColor={material.inverseOnSurface}
            size={22}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: Spacing.three,
    right: Spacing.three,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.one,
    elevation: 6,
  },
  message: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  text: {
    flex: 1,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
