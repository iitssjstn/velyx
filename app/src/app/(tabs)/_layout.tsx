import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSession } from '../../lib/session';
import { colors } from '../../lib/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather name={name} color={color as string} size={size} />;
  };

export default function TabsLayout() {
  const { signedIn, t } = useSession();
  if (!signedIn) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tabs.home'), headerShown: false, tabBarIcon: icon('home') }} />
      <Tabs.Screen name="search" options={{ title: t('tabs.search'), headerShown: false, tabBarIcon: icon('search') }} />
      <Tabs.Screen name="movies" options={{ title: t('tabs.movies'), tabBarIcon: icon('film') }} />
      <Tabs.Screen name="shows" options={{ title: t('tabs.shows'), tabBarIcon: icon('tv') }} />
      <Tabs.Screen name="account" options={{ title: t('tabs.account'), tabBarIcon: icon('user') }} />
    </Tabs>
  );
}
