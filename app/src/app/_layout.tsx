import { useState } from 'react';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
          },
        },
      }),
  );
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
            <Stack.Screen name="connect" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="movie/[id]" options={{ title: '' }} />
            <Stack.Screen name="show/[id]" options={{ title: '' }} />
            <Stack.Screen name="play/[kind]/[id]" options={{ headerShown: false, animation: 'fade' }} />
          </Stack>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
