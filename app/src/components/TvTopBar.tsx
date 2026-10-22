import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Logo } from './Logo';
import { useTvFocus } from './useTvFocus';
import { colors, radius } from '../lib/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];
const ICONS: Record<string, IconName> = { home: 'home', movies: 'film', shows: 'tv', genres: 'tag', search: 'search', account: 'user' };

function Item({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: (color: string) => ReactNode }) {
  const [focused, setFocused] = useState(false);
  const tvFocus = useTvFocus();
  const color = focused || active ? colors.ink : colors.muted;
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} hasTVPreferredFocus={tvFocus.preferred} onFocus={() => {
        setFocused(true);
        tvFocus.remember();
      }} onBlur={() => setFocused(false)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 14, borderRadius: radius.sm, borderWidth: 2, borderColor: focused ? colors.accent : 'transparent', backgroundColor: active ? colors.raised : 'transparent', transform: [{ scale: focused ? 1.08 : 1 }] }}>
        {children(color)}
      </View>
    </Pressable>
  );
}

/**
 * The tabs on a TV: the website's bar at the top, with the logo, the sections with their icons, and
 * search and the account on the right (the arrows move along it; ↓ goes to the screen). Only on a
 * TV; phones keep the tabs at the bottom.
 */
export function TvTopBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const tabs = state.routes.map((route, i) => {
    const options = descriptors[route.key]!.options;
    const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
    const active = state.index === i;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!active && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    };
    return { key: route.key, name: route.name, label, active, onPress };
  });
  const right = new Set(['search', 'account']);
  const render = (tab: (typeof tabs)[number], withLabel: boolean) => (
    <Item key={tab.key} label={tab.label} active={tab.active} onPress={tab.onPress}>
      {(color) => (
        <>
          <Feather name={ICONS[tab.name] ?? 'circle'} size={18} color={color} />
          {withLabel && <Text style={{ color, fontSize: 16, fontWeight: tab.active ? '700' : '500' }}>{tab.label}</Text>}
        </>
      )}
    </Item>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24, paddingHorizontal: 48, paddingVertical: 12, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Logo />
      <View style={{ flex: 1, flexDirection: 'row', gap: 4 }} accessibilityRole="tablist">
        {tabs.filter((tab) => !right.has(tab.name)).map((tab) => render(tab, true))}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>{tabs.filter((tab) => right.has(tab.name)).map((tab) => render(tab, tab.name === 'account'))}</View>
    </View>
  );
}
