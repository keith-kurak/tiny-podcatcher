import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';

/**
 * Contextual-selection state for a list, shared by every screen that can bulk-delete.
 *
 * The Android contextual action bar in hook form: long-press starts a selection, taps
 * toggle it, and the screen's own header becomes the action bar for as long as one is
 * running. There is no permanent "Edit" affordance to add — selection mode does not
 * exist until someone asks for it.
 *
 * Deselecting the last item ends the mode. Leaving an empty action bar on screen means
 * the only way out is a button the reader has to notice, and a bar reading "0 selected"
 * with a delete button that deletes nothing is a dead end.
 *
 * @param ids every id currently in the list, so a selection can be filtered against
 * what is actually on screen.
 */
export function useSelectionMode(ids: string[]) {
  const [raw, setRaw] = useState<Set<string> | null>(null);

  /**
   * The selection, minus anything that has left the list.
   *
   * Derived rather than pruned in an effect. Deleting is not the only way a row
   * disappears — a download finishes and moves, a sync drops an episode — and a stale id
   * would report a count the reader cannot see and delete nothing. Filtering here means
   * the stale entry is never observable, and there is no extra render to get there.
   */
  const selected = useMemo(() => {
    if (!raw) return null;
    const live = new Set(ids);
    const next = new Set([...raw].filter((id) => live.has(id)));
    return next.size === 0 ? null : next;
  }, [raw, ids]);

  const active = selected !== null;
  const count = selected?.size ?? 0;

  const exit = useCallback(() => setRaw(null), []);

  const start = useCallback((id: string) => {
    setRaw((current) => (current ? current : new Set([id])));
  }, []);

  const toggle = useCallback((id: string) => {
    setRaw((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Nothing left selected means the reader is done, not stuck at zero.
      return next.size === 0 ? null : next;
    });
  }, []);

  // Hardware back leaves selection rather than the screen — the same thing the action
  // bar's X does, and what Android users expect from a contextual bar.
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      exit();
      return true;
    });
    return () => subscription.remove();
  }, [active, exit]);

  return {
    /** True while a selection is running; the header should be an action bar. */
    active,
    count,
    /**
     * Pass as the list's `extraData`.
     *
     * A recycling list reuses row components and will not re-render them just because
     * the screen did, so without this the action bar counts up while the rows underneath
     * show no checkmarks at all. Observed exactly that on device.
     */
    extraData: selected,
    isSelected: useCallback((id: string) => selected?.has(id) ?? false, [selected]),
    /** Ids in selection order-independent form, for the delete itself. */
    ids: useCallback(() => [...(selected ?? [])], [selected]),
    start,
    toggle,
    exit,
  };
}
