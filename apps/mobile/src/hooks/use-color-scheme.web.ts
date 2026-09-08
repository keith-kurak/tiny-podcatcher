import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/** Never changes after hydration, so there is nothing to subscribe to. */
const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 *
 * `useSyncExternalStore` reports client vs. server directly — false during the server
 * render, true on the client — where a `useState` + `useEffect` pair had to render once
 * wrong and then set state to correct itself, which is a cascading render React now
 * warns about.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
