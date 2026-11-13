import { QueryClient } from '@tanstack/react-query';

/**
 * The app's one query client.
 *
 * In its own module so the background task can use it. When the task runs while the app
 * is open, it shares the runtime with the UI, and its feed fetches and invalidations then
 * update the screens directly. When the app is closed, the task gets a fresh client, which
 * reads the same stored data.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
    },
  },
});
