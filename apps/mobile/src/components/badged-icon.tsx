import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { useStatusColors } from '@/hooks/use-status-colors';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = React.ComponentProps<typeof SymbolView>['name'];

/**
 * Download state shared by the phone and watch destination toggles.
 *
 * The destination glyph never changes — only its colour, plus a small badge in the
 * corner for every state but idle. Swapping the glyph out mid-download used to make it unclear what the
 * button was even for.
 */
export type DestinationState = 'idle' | 'pending' | 'downloading' | 'complete' | 'error';

/** Maps each state onto a Material role. See `useStatusColors` for the reasoning. */
function useStateColors(): Record<DestinationState, string> {
  const status = useStatusColors();
  return {
    idle: status.idle,
    pending: status.waiting,
    downloading: status.waiting,
    complete: status.success,
    error: status.error,
  };
}

const BADGE_SYMBOLS: Partial<Record<DestinationState, SymbolName>> = {
  pending: { ios: 'clock.fill', android: 'schedule' },
  downloading: { ios: 'arrow.down.circle.fill', android: 'download' },
  error: { ios: 'exclamationmark.circle.fill', android: 'error' },
  // Colour alone was the only sign of a finished download, and primary against grey is
  // easy to miss. The check makes every state readable from its shape.
  complete: { ios: 'checkmark.circle.fill', android: 'check_circle' },
};

interface BadgedIconProps {
  /** The destination glyph — a phone or a watch. Never changes with state. */
  name: SymbolName;
  state: DestinationState;
  size?: number;
}

export function BadgedIcon({ name, state, size = 24 }: BadgedIconProps) {
  const theme = useTheme();
  const tintColor = useStateColors()[state];
  const badge = BADGE_SYMBOLS[state];
  const badgeSize = Math.round(size * 0.58);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <SymbolView
        name={name}
        size={size}
        tintColor={tintColor}
        weight={state === 'complete' ? 'bold' : 'regular'}
      />
      {badge && (
        <View
          style={[
            styles.badge,
            {
              // A ring in the page colour keeps the badge legible where it
              // overlaps the glyph beneath it.
              backgroundColor: theme.background,
              borderRadius: badgeSize,
              right: -badgeSize * 0.28,
              bottom: -badgeSize * 0.28,
            },
          ]}
        >
          <SymbolView name={badge} size={badgeSize} tintColor={tintColor} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
