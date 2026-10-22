import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { TV } from '../../components/screen';
import { TvTopBar } from '../../components/TvTopBar';
import { useSession } from '../../lib/session';
import { signedOutRoute } from '../../lib/start';
import { colors } from '../../lib/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather name={name} color={color as string} size={size} />;
  };

export default function TabsLayout() {
  const { signedIn, sessionEnded, t } = useSession();
  // The one place that leaves the tabs when nobody is signed in (also after Sign out).
  if (!signedIn) return <Redirect href={signedOutRoute(sessionEnded)} />;
  return (
    <Tabs
      tabBar={TV ? (props) => <TvTopBar {...props} /> : undefined}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
        // On a TV the tabs are a bar at the top, as on the website (TvTopBar).
        ...(TV ? { tabBarPosition: 'top' as const } : {}),
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tabs.home'), headerShown: false, tabBarIcon: icon('home') }} />
      {/* On a TV the bar at the top already names the screen, so no header under it; search keeps away from the screen's edge. */}
      <Tabs.Screen name="search" options={{ title: t('tabs.search'), headerShown: false, tabBarIcon: icon('search'), ...(TV ? { sceneStyle: { backgroundColor: colors.bg, paddingHorizontal: 32 } } : {}) }} />
      <Tabs.Screen name="movies" options={{ title: t('tabs.movies'), headerShown: !TV, tabBarIcon: icon('film') }} />
      <Tabs.Screen name="shows" options={{ title: t('tabs.shows'), headerShown: !TV, tabBarIcon: icon('tv') }} />
      <Tabs.Screen name="genres" options={{ title: t('tabs.genres'), headerShown: !TV, tabBarIcon: icon('grid') }} />
      <Tabs.Screen name="account" options={{ title: t('tabs.account'), headerShown: !TV, tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
