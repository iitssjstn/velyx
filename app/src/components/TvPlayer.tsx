import { ActivityIndicator, Image, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { formatClock } from '../lib/format';
import { useSession } from '../lib/session';
import { colors, radius } from '../lib/theme';
import type { TvButton, TvState, TvTab } from '../lib/tvRemote';

const ICONS: Record<TvButton, React.ComponentProps<typeof Feather>['name']> = {
  back: 'rotate-ccw',
  play: 'play',
  forward: 'rotate-cw',
  subtitles: 'message-square',
  audio: 'volume-2',
  next: 'skip-forward',
};

export interface TvPlayerProps {
  title: string;
  subtitle: string | null;
  position: number;
  duration: number;
  playing: boolean;
  loading: boolean;
  ended: boolean;
  /** The bar with the title and the time is up (after a key, while paused). */
  visible: boolean;
  state: TvState;
  buttons: TvButton[];
  tabs: TvTab[];
  /** The lines of each tab and which one is chosen now. */
  lines: Record<TvTab, string[]>;
  selected: Partial<Record<TvTab, number>>;
  marks: number[];
  seekStep: number;
  /** "Skip intro" (or recap, credits) when offered. */
  skipLabel: string | null;
  /** The "Next episode" card: what comes next and the seconds left. */
  upNext: { label: string; countdown: number; ended: boolean } | null;
  /** Where the skip button and the next-episode card sit (above the bar while it shows). */
  overlayBottom: number;
}

/** The buttons back, play and forward come first; the time follows the third. */
const TIME_AFTER = 2;
/** Height of the shaded strip behind the top and bottom of the controls. */
const FADE = 170;

/** Dark at the edge to clear, like the website's gradient: one smooth image, stretched (no gradient view in the app). */
function Fade({ from }: { from: 'top' | 'bottom' }) {
  return <Image source={require('../../assets/fade.png')} resizeMode="stretch" style={{ width: '100%', height: FADE, transform: from === 'bottom' ? [{ scaleY: -1 }] : [] }} />;
}

/**
 * The player's screen on Android TV / Google TV, drawn for the remote (keys: lib/tvRemote.ts), laid
 * out like the website's player: title at the top, the timeline at the bottom with the buttons and
 * the time under it, the menu on the right.
 */
export function TvPlayer(p: TvPlayerProps) {
  const { t } = useSession();
  const { state } = p;
  const backFocused = state.open === 'bar' && state.top;
  const fraction = p.duration > 0 ? Math.max(0, Math.min(1, p.position / p.duration)) : 0;
  const label = (b: TvButton) =>
    b === 'back' ? t('player.backSeconds', { n: p.seekStep }) : b === 'forward' ? t('player.forwardSeconds', { n: p.seekStep }) : b === 'play' ? (p.playing ? t('player.pause') : t('player.play')) : b === 'subtitles' ? t('player.subtitles') : b === 'audio' ? t('player.audio') : t('player.next');
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
      {p.loading ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : !p.playing && !p.ended && state.open === 'none' ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, padding: 16 }}>
            <Feather name="pause" size={34} color="#fff" />
          </View>
        </View>
      ) : null}

      {p.visible && (
        <>
          {/* Top: title and episode, as in the website's player. */}
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
            <Fade from="top" />
            <View style={{ position: 'absolute', left: 40, right: 40, top: 28, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              {/* Back to where the player was opened from; ← from the first button of the row reaches it. */}
              <View accessibilityRole="button" accessibilityLabel={t('player.back')} accessibilityState={{ selected: backFocused }} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: backFocused ? '#fff' : 'rgba(255,255,255,0.12)', transform: [{ scale: backFocused ? 1.1 : 1 }] }}>
                <Feather name="arrow-left" size={24} color={backFocused ? colors.bg : '#fff'} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }} numberOfLines={1}>{p.title}</Text>
                {p.subtitle ? <Text style={{ color: 'rgba(238,233,255,0.7)', fontSize: 15 }} numberOfLines={1}>{p.subtitle}</Text> : null}
              </View>
            </View>
          </View>
          {/* Bottom: the timeline, then the buttons and the time (left) and the tracks (right). */}
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <Fade from="bottom" />
            <View style={{ position: 'absolute', left: 40, right: 40, bottom: 24, gap: 12 }}>
              <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)' }}>
                <View style={{ width: `${fraction * 100}%`, height: 5, borderRadius: 3, backgroundColor: colors.accent }} />
                {p.marks.map((m, i) => (
                  <View key={i} style={{ position: 'absolute', left: `${m * 100}%`, top: -3, width: 3, height: 11, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.75)' }} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 52 }}>
                {p.buttons.map((b, i) => {
                  const focused = state.open === 'bar' && !state.top && state.focus === i;
                  const button = (
                    <View key={b} accessibilityRole="button" accessibilityLabel={label(b)} accessibilityState={{ selected: focused }} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? '#fff' : 'transparent', transform: [{ scale: focused ? 1.1 : 1 }] }}>
                      <Feather name={b === 'play' && p.playing ? 'pause' : ICONS[b]} size={b === 'play' ? 26 : 22} color={focused ? colors.bg : '#fff'} />
                    </View>
                  );
                  // After back, play and forward: the time, then the rest on the right (as on the website).
                  return i === TIME_AFTER ? [
                    button,
                    <Text key="time" style={{ color: 'rgba(238,233,255,0.8)', fontSize: 16, marginLeft: 8, marginRight: 'auto' }}>
                      {formatClock(p.position)} <Text style={{ color: 'rgba(238,233,255,0.4)' }}>/ {formatClock(p.duration)}</Text>
                    </Text>,
                  ] : button;
                })}
              </View>
            </View>
          </View>
        </>
      )}

      {p.skipLabel && !p.upNext && state.open === 'none' && (
        <View style={{ position: 'absolute', right: 48, bottom: p.overlayBottom, borderRadius: radius.pill, backgroundColor: '#fff', paddingHorizontal: 26, paddingVertical: 14 }}>
          <Text style={{ color: colors.bg, fontSize: 18, fontWeight: '700' }}>{p.skipLabel}</Text>
        </View>
      )}

      {p.upNext && state.open === 'none' && (
        <View style={{ position: 'absolute', right: 48, bottom: p.overlayBottom, width: 420, backgroundColor: 'rgba(20,18,28,0.95)', borderRadius: radius.lg, padding: 22, gap: 14, borderWidth: 1, borderColor: colors.line }}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>{p.upNext.ended ? t('player.next') : `${t('player.next')} · ${Math.max(0, p.upNext.countdown)} s`}</Text>
          <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }} numberOfLines={2}>{p.upNext.label}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Choice label={t('player.playIn', { n: Math.max(0, p.upNext.countdown) })} focused={state.nextFocus === 0} />
            {!p.upNext.ended && <Choice label={t('player.watchCredits')} focused={state.nextFocus === 1} />}
          </View>
        </View>
      )}

      {state.open === 'menu' && (
        <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 440, backgroundColor: 'rgba(20,18,28,0.97)', paddingVertical: 40, paddingHorizontal: 28, gap: 18 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {p.tabs.map((tab) => (
              <View key={tab} style={{ borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 8, backgroundColor: tab === state.tab ? colors.accent : 'rgba(255,255,255,0.08)' }}>
                <Text style={{ color: tab === state.tab ? colors.accentInk : colors.ink, fontSize: 17, fontWeight: '600' }}>{tab === 'subtitles' ? t('player.subtitles') : t('player.audio')}</Text>
              </View>
            ))}
          </View>
          <View style={{ gap: 6 }}>
            {visibleLines(p.lines[state.tab], state.item).map(({ text, index }) => {
              const focused = index === state.item;
              const chosen = index === p.selected[state.tab];
              return (
                <View key={index} accessibilityRole="radio" accessibilityState={{ selected: chosen }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: focused ? '#fff' : 'transparent' }}>
                  <Feather name="check" size={20} color={chosen ? (focused ? colors.bg : colors.accent) : 'transparent'} />
                  <Text style={{ color: focused ? colors.bg : colors.ink, fontSize: 18, flex: 1 }} numberOfLines={1}>{text}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

/** At most nine lines around the focused one, so a long list scrolls along. */
function visibleLines(lines: string[], focus: number): { text: string; index: number }[] {
  const size = 9;
  const start = Math.max(0, Math.min(focus - Math.floor(size / 2), lines.length - size));
  return lines.slice(start, start + size).map((text, i) => ({ text, index: start + i }));
}

function Choice({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={{ borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: focused ? '#fff' : 'rgba(255,255,255,0.1)' }}>
      <Text style={{ color: focused ? colors.bg : colors.ink, fontSize: 17, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}
