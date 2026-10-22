import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Logo } from './Logo';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';

function Chip({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: (focused: boolean) => ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <View style={{ minWidth: 40, height: 40, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.ink : active ? 'rgba(236,232,244,0.14)' : 'transparent' }}>{children(focused)}</View>
    </Pressable>
  );
}

/**
 * The tabs on a TV: a bar at the top with the account on the left, search and the sections in the
 * middle and the logo on the right (the arrows move along it; ↓ goes to the screen). Only on a TV;
 * phones keep the tabs at the bottom.
 */
export function TvTopBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { user } = useSession();
  const tab = (name: string) => {
    const i = state.routes.findIndex((r) => r.name === name);
    const route = state.routes[i];
    if (!route) return null;
    const options = descriptors[route.key]!.options;
    const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
    const active = state.index === i;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!active && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    };
    return { key: route.key, label, active, onPress };
  };
  const account = tab('account');
  const search = tab('search');
  const sections = ['home', 'shows', 'movies', 'genres'].map(tab).filter((x) => x !== null);
  const initial = (user?.displayName || user?.username || '?').slice(0, 1).toUpperCase();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 48, paddingVertical: 14, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {account && (
          <Chip label={account.label} active={account.active} onPress={account.onPress}>
            {(focused) => (
              <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.accentInk : colors.accent }}>
                <Text style={{ color: focused ? colors.accent : colors.accentInk, fontSize: 16, fontWeight: '800' }}>{initial}</Text>
              </View>
            )}
          </Chip>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityRole="tablist">
        {search && (
          <Chip label={search.label} active={search.active} onPress={search.onPress}>
            {(focused) => <Feather name="search" size={20} color={focused ? colors.bg : colors.ink} />}
          </Chip>
        )}
        {sections.map((s) => (
          <Chip key={s.key} label={s.label} active={s.active} onPress={s.onPress}>
            {(focused) => <Text style={{ color: focused ? colors.bg : s.active ? colors.ink : colors.muted, fontSize: 17, fontWeight: s.active || focused ? '700' : '600' }}>{s.label}</Text>}
          </Chip>
        ))}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Logo />
      </View>
    </View>
  );
}
