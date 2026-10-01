import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';
import { launchHideAt } from '../lib/launch';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

/**
 * The logo when the app opens: it comes in while the app finds its server and session in the
 * background, and fades out once the app is ready, so the first screen is there at once.
 */
export function LaunchSplash() {
  const { ready } = useSession();
  const [startedAt] = useState(() => Date.now());
  const [gone, setGone] = useState(false);
  const appear = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [appear]);

  useEffect(() => {
    const hideAt = launchHideAt(ready ? Date.now() - startedAt : null);
    const timer = setTimeout(
      () => Animated.timing(fade, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setGone(true)),
      Math.max(0, hideAt - (Date.now() - startedAt)),
    );
    return () => clearTimeout(timer);
  }, [ready, startedAt, fade]);

  if (gone) return null;
  const scale = appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const rise = appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ opacity: appear, transform: [{ scale }] }}>
        <Image source={require('../../assets/splash-icon.png')} style={styles.logo} />
      </Animated.View>
      <Animated.View style={{ opacity: appear, transform: [{ translateY: rise }] }}>
        <Text style={styles.word}>vidalune</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100, elevation: 100 },
  logo: { width: 160, height: 160, marginBottom: -24 },
  word: { color: colors.ink, fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
});
