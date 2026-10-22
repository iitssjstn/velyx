import { Text, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Logo } from './Logo';
import { FocusPressable } from './ui';
import { colors, radius } from '../lib/theme';

/**
 * The tabs on a TV: a bar at the top with the logo and the sections, as on the website (the
 * arrows move along it; ↓ goes to the screen). Only on a TV; phones keep the tabs at the bottom.
 */
export function TvTopBar({ state, descriptors, navigation }: BottomTabBarProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32, paddingHorizontal: 48, paddingVertical: 16, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Logo />
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
        {state.routes.map((route, i) => {
          const options = descriptors[route.key]!.options;
          const active = state.index === i;
          const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
          return (
            <FocusPressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!active && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: active ? 'rgba(255,255,255,0.1)' : 'transparent' }}
            >
              <Text style={{ color: active ? colors.ink : colors.muted, fontSize: 18, fontWeight: active ? '700' : '500' }}>{label}</Text>
            </FocusPressable>
          );
        })}
      </View>
    </View>
  );
}
