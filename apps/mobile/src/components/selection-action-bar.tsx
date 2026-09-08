import { Stack } from 'expo-router';

/**
 * The screen's own header, turned into a contextual action bar.
 *
 * Not a custom bar drawn over the screen: `Stack.Title` and `Stack.Toolbar` replace the
 * native header's contents in place, so the count, the close button and the actions get
 * the platform's own layout, ripples and animation for free. Rendering this instead of
 * the screen's normal title is the whole of "selection mode" as far as the header is
 * concerned.
 *
 * `Stack.Toolbar` items are keyed by placement, so a screen must render either its
 * normal toolbar or this one — never both.
 */
export function SelectionActionBar({
  count,
  onExit,
  onDelete,
  deleteLabel,
  extraAction,
}: {
  count: number;
  onExit: () => void;
  onDelete: () => void;
  /** Names what is being removed, for screen readers: "Delete 3 downloads". */
  deleteLabel: string;
  /**
   * One optional action beside delete, for something only this screen can offer — the
   * watch list's bulk retry. Absent everywhere else.
   */
  extraAction?: { icon: number; label: string; onPress: () => void };
}) {
  return (
    <>
      <Stack.Title>{`${count} selected`}</Stack.Title>

      {/*
        Replaces the back arrow while selecting. Hardware back does the same thing —
        see `useSelectionMode` — so the two ways out of the mode agree.
      */}
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={require('@/assets/icons/close.xml')}
          onPress={onExit}
          accessibilityLabel="Cancel selection">
          Cancel
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      <Stack.Toolbar placement="right">
        {extraAction && (
          <Stack.Toolbar.Button
            icon={extraAction.icon}
            onPress={extraAction.onPress}
            accessibilityLabel={extraAction.label}>
            {extraAction.label}
          </Stack.Toolbar.Button>
        )}
        <Stack.Toolbar.Button
          icon={require('@/assets/icons/delete.xml')}
          onPress={onDelete}
          accessibilityLabel={deleteLabel}>
          Delete
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
