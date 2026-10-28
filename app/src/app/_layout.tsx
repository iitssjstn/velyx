import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { CastConnectListener } from '../components/CastConnect';
import { CastStatusBar } from '../components/CastStatus';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { DialogHost } from '../components/Dialog';
import { LaunchSplash } from '../components/LaunchSplash';
import { appOrientation } from '../components/screen';
import { SessionProvider } from '../lib/session';
import { colors } from '../lib/theme';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, primary: colors.accent, background: colors.bg, card: colors.bg, text: colors.ink, border: colors.line },
};

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Errors the server answered (e.g. 404) are final; only network trouble is retried.
            retry: (count, err) => (err as { status?: number }).status === 0 && count < 2,
            // Kept for half an hour, so what was loaded stays visible while the connection is gone.
            gcTime: 30 * 60_000,
          },
        },
      }),
  );
  // Coming back to the app counts as focus: lists older than their stale time load again, so
  // progress watched on another device shows up.
  // Phones stay upright (only the player turns); tablets turn freely.
  useEffect(appOrientation, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.ink,
              headerTitleStyle: { color: colors.ink },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="cloud" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="movie/[id]" options={{ title: '' }} />
            <Stack.Screen name="show/[id]" options={{ title: '' }} />
            <Stack.Screen name="list/[name]" options={{ title: '' }} />
            <Stack.Screen name="request/[type]/[id]" options={{ title: '' }} />
            <Stack.Screen name="account/password" options={{ title: '' }} />
            <Stack.Screen name="account/sessions" options={{ title: '' }} />
            <Stack.Screen name="admin/requests" options={{ title: '' }} />
            <Stack.Screen name="admin/libraries" options={{ title: '' }} />
            <Stack.Screen name="admin/optimizations" options={{ title: '' }} />
            <Stack.Screen name="admin/users" options={{ title: '' }} />
            <Stack.Screen name="admin/notifications" options={{ title: '' }} />
            <Stack.Screen name="admin/activity" options={{ title: '' }} />
            {/* From the cast bar the remote slides up over the screens (and down again); otherwise the player fades in. */}
            <Stack.Screen name="play/[kind]/[id]" options={({ route }) => ({ headerShown: false, animation: (route.params as { bar?: string } | undefined)?.bar === '1' ? 'slide_from_bottom' : 'fade' })} />
          </Stack>
          <ConnectionBanner />
          <CastStatusBar />
          <CastConnectListener />
          <LaunchSplash />
          <DialogHost />
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
