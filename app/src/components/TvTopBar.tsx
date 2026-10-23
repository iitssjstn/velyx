import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Logo } from './Logo';
import { useTvFocus } from './useTvFocus';
import { colors, radius } from '../lib/theme';
import { overHero } from '../lib/tvHome';

type IconName = React.ComponentProps<typeof Feather>['name'];
const ICONS: Record<string, IconName> = { home: 'home', movies: 'film', shows: 'tv', genres: 'tag', search: 'search', account: 'user' };

function Item({ label, active, onPress, children }: { label: string; active: boolean; onPress: () => void; children: (color: string) => ReactNode }) {
  const [focused, setFocused] = useState(false);
  const tvFocus = useTvFocus();
  const color = active ? colors.buttonInk : focused ? colors.ink : colors.muted;
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label} onPress={onPress} hasTVPreferredFocus={tvFocus.preferred} onFocus={() => {
        setFocused(true);
        tvFocus.remember();
      }} onBlur={() => setFocused(false)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 2, borderColor: focused ? colors.ink : 'transparent', backgroundColor: active ? colors.button : 'transparent', transform: [{ scale: focused ? 1.06 : 1 }] }}>
        {children(color)}
      </View>
    </Pressable>
  );
}

/** Height of the TV's top bar: the screens under it start this far down (Home's hero runs under it). */
export const TV_TOP_BAR = 60;

/**
 * The tabs on a TV: the website's bar at the top, with the logo, the sections with their icons, and
 * search and the account on the right (the arrows move along it; ↓ goes to the screen). Only on a
 * TV; phones keep the tabs at the bottom. Low, and lying over the screen: on Home see-through over the
 * hero's artwork (darker at the top, so it stays readable); elsewhere on the background colour.
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
  // See-through only over Home's hero; on its rows (and elsewhere) on the background colour.
  const onHero = useSyncExternalStore(overHero.subscribe, overHero.get);
  const seeThrough = state.routes[state.index]?.name === 'home' && onHero;
  const render = (tab: (typeof tabs)[number], withLabel: boolean) => (
    <Item key={tab.key} label={tab.label} active={tab.active} onPress={tab.onPress}>
      {(color) => (
        <>
          <Feather name={ICONS[tab.name] ?? 'circle'} size={17} color={color} />
          {withLabel && <Text style={{ color, fontSize: 15, fontWeight: tab.active ? '700' : '500' }}>{tab.label}</Text>}
        </>
      )}
    </Item>
  );
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: TV_TOP_BAR, zIndex: 10, elevation: 10, flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 48, backgroundColor: seeThrough ? 'transparent' : colors.bg }}>
      {seeThrough && <Image source={require('../../assets/shade.png')} resizeMode="stretch" tintColor={colors.bg} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: TV_TOP_BAR + 40, width: '100%', opacity: 0.9 }} />}
      <Logo small />
      <View style={{ flex: 1, flexDirection: 'row', gap: 4 }} accessibilityRole="tablist">
        {tabs.filter((tab) => !right.has(tab.name)).map((tab) => render(tab, true))}
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>{tabs.filter((tab) => right.has(tab.name)).map((tab) => render(tab, tab.name === 'account'))}</View>
    </View>
  );
}
