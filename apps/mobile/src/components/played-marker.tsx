import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { useStatusColors } from '@/hooks/use-status-colors';
import type { PlayedStatus } from '@/lib/played-state';

type SymbolName = React.ComponentProps<typeof SymbolView>['name'];

const SIZE = 14;
const DOT_SIZE = 8;

/**
 * Material's `clock_loader` glyphs are pie charts at fixed steps, so the pie needs no
 * drawing library. The first step stays visible for a barely started episode, and the
 * last stops short of a full circle, which would read as "played".
 */
const PIE_STEPS = [
  [0.15, 'clock_loader_10'],
  [0.3, 'clock_loader_20'],
  [0.5, 'clock_loader_40'],
  [0.7, 'clock_loader_60'],
  [0.85, 'clock_loader_80'],
] as const;

function pieSymbol(fraction: number): SymbolName {
  const android = PIE_STEPS.find(([below]) => fraction < below)?.[1] ?? 'clock_loader_90';
  return { ios: 'circle.lefthalf.filled', android };
}

/**
 * Leads an episode row's metadata line: a dot for unplayed, a pie for in progress, a
 * check for played. Always in the same place, so the state reads at a glance down a list.
 */
export function PlayedMarker({ status }: { status: PlayedStatus }) {
  const colors = useStatusColors();

  if (status.state === 'unplayed') {
    return (
      <View style={styles.box} accessibilityLabel="Unplayed">
        <View style={[styles.dot, { backgroundColor: colors.success }]} />
      </View>
    );
  }

  const inProgress = status.state === 'in_progress';
  return (
    <View style={styles.box} accessibilityLabel={inProgress ? 'In progress' : 'Played'}>
      <SymbolView
        name={inProgress ? pieSymbol(status.fraction) : { ios: 'checkmark.circle', android: 'check_circle' }}
        size={SIZE}
        tintColor={inProgress ? colors.success : colors.idle}
      />
    </View>
  );
}

/** "23m left" or "1h 5m left". */
export function formatTimeLeft(seconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

const styles = StyleSheet.create({
  box: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
