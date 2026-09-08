import { useMaterialColors } from '@expo/ui/jetpack-compose';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Selection affordances shared by every list that can bulk-delete.
 *
 * Two shapes, because the lists are two shapes.
 *
 * A row grows a circle at its leading edge and shifts its content across, keeping the
 * artwork visible. Swapping the artwork out for the checkmark was tried first and read
 * badly: the artwork is what tells you *which* episode a row is, and a list of
 * identical checkmarks is a list you cannot check.
 *
 * A tile has nothing but artwork, so it cannot give any of it up. It keeps it and takes
 * a badge in the corner instead.
 */

const CIRCLE_SIZE = 24;

/**
 * The leading circle: filled and ticked when selected, an empty ring when not.
 *
 * Every row in a running selection gets one, not just the chosen ones. The ring is what
 * says "this is selectable too" — and it keeps the content of every row aligned, so
 * ticking one does not shuffle its neighbours sideways.
 */
export function SelectionCheck({ selected }: { selected: boolean }) {
  const material = useMaterialColors();

  return (
    <View
      style={[
        styles.circle,
        selected
          ? { backgroundColor: material.primary }
          : { borderWidth: 2, borderColor: material.outline },
      ]}>
      {selected && (
        <SymbolView
          name={{ ios: 'checkmark', android: 'check' }}
          size={16}
          tintColor={material.onPrimary}
        />
      )}
    </View>
  );
}

/**
 * A tile's selected state: dimmed, with a checkmark badge.
 *
 * Absolutely positioned over the artwork rather than around it, so a tile is the same
 * size selected or not and the grid never reflows mid-selection.
 */
export function TileSelectionOverlay({ selected }: { selected: boolean }) {
  const material = useMaterialColors();

  if (!selected) return null;

  return (
    <View style={styles.tileOverlay} pointerEvents="none">
      <View style={[styles.tileScrim, { backgroundColor: material.scrim }]} />
      <View style={[styles.tileBadge, { backgroundColor: material.primary }]}>
        <SymbolView
          name={{ ios: 'checkmark', android: 'check' }}
          size={16}
          tintColor={material.onPrimary}
        />
      </View>
    </View>
  );
}

/** Background tint for a selected row, to be spread into the row's style array. */
export function useSelectedRowStyle(selected: boolean): StyleProp<ViewStyle> {
  const material = useMaterialColors();
  return selected ? { backgroundColor: material.secondaryContainer } : null;
}

const styles = StyleSheet.create({
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    padding: 6,
  },
  tileScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.45,
    borderRadius: 8,
  },
  tileBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
