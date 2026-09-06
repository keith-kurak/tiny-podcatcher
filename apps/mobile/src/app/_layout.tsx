import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ObserveRoot } from 'expo-observe';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppOnboarding } from '@/components/onboarding';
import { getConnectedNodes } from '@/hooks/useWearDataLayer';
import { AudioProvider } from '@/lib/audio-context';
import { DownloadProvider } from '@/lib/download-context';
import {
  configureObserve,
  logAppStarted,
  logWatchConnectionChecked,
} from '@/lib/observe';
import { getOnboardingSeen, setOnboardingSeen } from '@/lib/storage';
import { WatchStatusProvider } from '@/lib/watch-status-context';

// Before the first render, so startup metrics are collected under this config.
configureObserve();


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
    },
  },
});

function RootLayout() {
  const colorScheme = useColorScheme();
  // Read once, on mount. A lazy initialiser rather than an effect so the first render
  // already knows the answer — flashing the app for a frame before covering it with the
  // onboarding would defeat the point of a first-run introduction.
  const [showOnboarding, setShowOnboarding] = useState(() => !getOnboardingSeen());

  const finishOnboarding = () => {
    setOnboardingSeen();
    setShowOnboarding(false);
  };

  useEffect(() => {
    logAppStarted();
    // Once per launch, as asked. Reported whether or not a watch answers: "no watch
    // paired" is the interesting half of this signal, and an event that only exists on
    // success cannot tell the difference between absent and broken.
    getConnectedNodes()
      .then((nodes) => logWatchConnectionChecked(nodes.length))
      .catch(() => logWatchConnectionChecked(0));
  }, []);

  // Time to Interactive is marked per screen, not here. The router integration reads the
  // current route to attribute the metric, and a layout above the navigator has no route
  // — calling it here is silently dropped. Every screen renders its own
  // <ObserveInteractiveMarker /> once it is genuinely usable.

  return (
    <QueryClientProvider client={queryClient}>
      <DownloadProvider>
      <WatchStatusProvider>
      <AudioProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style="auto" />
          <AnimatedSplashOverlay />
          {/*
            Rendered over the app rather than as a route: it is a one-time overlay, not a
            place you can navigate to, and keeping it out of the router means no onboarding
            entry appears in the navigation metrics or back stack.
          */}
          {showOnboarding && <AppOnboarding onDone={finishOnboarding} />}
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            {/* Lives outside the tabs so it covers the tab bar while open. */}
            <Stack.Screen
              name="add-podcast"
              options={{
                presentation: 'modal',
                headerShown: true,
                title: 'Add Podcast',
              }}
            />
            {/*
              Pushed on top of the add-podcast modal, and a sibling of it rather than a
              screen nested inside it.

              Nesting a second Stack inside the modal route also works and arguably reads
              better in the file tree. Two flat screens win on the dismiss: subscribing
              has to close the modal *and* the search screen under it, and `router.dismiss`
              counts within the nearest stack — from a nested stack it pops to the search
              screen and stops, needing the parent navigator to finish the job. Here both
              screens are in the same stack, so `dismiss(2)` says exactly what it does.
            */}
            <Stack.Screen
              name="podcast-preview"
              options={{
                headerShown: true,
                title: 'Podcast',
              }}
            />
          </Stack>
        </ThemeProvider>
      </AudioProvider>
      </WatchStatusProvider>
      </DownloadProvider>
    </QueryClientProvider>
  );
}

// Wrapping the root is what records Time to First Render.
export default ObserveRoot.wrap(RootLayout);
