import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { MediaPlayerState, useCastDevice, useMediaStatus, useRemoteMediaClient, useStreamPosition } from 'react-native-google-cast';
import { castNow, castNowRoute, castNowShare, type CastNow } from '../lib/castNow';
import { GLOW } from '../lib/palette';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import { useCastStatus } from './CastStatus';

/** How long the bar takes to slide in or out: soft, not quick. */
const SLIDE_MS = 340;
/** The bar with its space under it. */
const BAR_SPACE = 72;

/**
 * While a Chromecast plays a Vidalune title, a bar just above the tabs: the poster (with the sign for
 * the full remote), the title and the TV, play/pause and a thin line with how far it is. Tapping it
 * opens the remote again, attached to what the TV plays.
 */
export function CastMiniBar() {
  const { t } = useSession();
  const status = useCastStatus();
  const media = useMediaStatus();
  const device = useCastDevice();
  const client = useRemoteMediaClient();
  const position = useStreamPosition(1);
  const live = status === 'connected' ? castNow(media?.mediaInfo) : null;
  // The last title stays drawn while the bar slides away.
  const [shown, setShown] = useState<CastNow | null>(live);
  const slide = useRef(new Animated.Value(live ? 1 : 0)).current;
  const liveKey = live ? `${live.title}|${live.item?.kind}|${live.item?.id}|${live.image}` : null;
  useEffect(() => {
    if (live) setShown(live);
    Animated.timing(slide, { toValue: live ? 1 : 0, duration: SLIDE_MS, easing: live ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished && !live) setShown(null);
    });
    // Only when the title changes or casting stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);
  if (!shown) return null;
  const playing = media?.playerState === MediaPlayerState.PLAYING || media?.playerState === MediaPlayerState.BUFFERING;
  const route = castNowRoute(live ?? shown);
  const share = castNowShare(live ?? shown, position);
  return (
    // The screen above makes room as the bar comes up (it rises from behind the tabs; one value for room and fade, so they move together).
    <Animated.View
      pointerEvents={live ? 'auto' : 'none'}
      style={{ height: slide.interpolate({ inputRange: [0, 1], outputRange: [0, BAR_SPACE] }), overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.bg, paddingHorizontal: 8, paddingBottom: 8, opacity: slide }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('player.openRemote')}: ${shown.title}`}
        disabled={!route}
        onPress={() => route && router.push(route as never)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 64, flexShrink: 0, paddingLeft: 8, paddingRight: 10, borderRadius: radius.md + 2, overflow: 'hidden', backgroundColor: pressed ? colors.raised : colors.surface, borderWidth: 1, borderColor: colors.line, boxShadow: GLOW.button })}
      >
        <View style={{ width: 44, height: 44, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.raised }}>
          {shown.image ? <Image source={{ uri: shown.image }} style={{ width: 44, height: 44, borderRadius: radius.sm }} /> : null}
          {/* The sign for the full remote. */}
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <Feather name="maximize-2" size={18} color="#fff" />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{[shown.title, shown.subtitle].filter(Boolean).join(' · ')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
            <Feather name="cast" size={12} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: 12 }} numberOfLines={1}>{device?.friendlyName ?? t('player.casting')}</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? t('player.pause') : t('player.play')}
          hitSlop={8}
          onPress={() => void (playing ? client?.pause() : client?.play())?.catch(() => undefined)}
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.raised : colors.button, boxShadow: GLOW.button })}
        >
          <Feather name={playing ? 'pause' : 'play'} size={18} color={colors.buttonInk} />
        </Pressable>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.1)' }}>
          <View style={{ width: `${share * 100}%`, height: 3, backgroundColor: colors.accent }} />
        </View>
      </Pressable>
    </Animated.View>
  );
}
