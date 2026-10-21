import { ActivityIndicator, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Artwork } from './media';
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
  poster: string | null;
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
}

/**
 * The player's screen on Android TV / Google TV, drawn for the remote (keys: lib/tvRemote.ts): the
 * bar with poster, title and time at the bottom, the row of buttons above it, the menu on the right.
 * The same layout as Vidalune's cast player, so it reads from the couch.
 */
export function TvPlayer(p: TvPlayerProps) {
  const { t } = useSession();
  const { state } = p;
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
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: 22 }}>
            <Feather name="pause" size={48} color="#fff" />
          </View>
        </View>
      ) : null}

      {p.visible && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 48, paddingTop: 32, paddingBottom: 32, backgroundColor: 'rgba(10,9,15,0.82)', gap: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 20 }}>
            <Artwork path={p.poster} size="w342" label={p.title} style={{ width: 72, height: 108, borderRadius: radius.md }} />
            <View style={{ flex: 1, gap: 4 }}>
              {p.subtitle ? <Text style={{ color: colors.muted, fontSize: 16 }} numberOfLines={1}>{p.subtitle}</Text> : null}
              <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }} numberOfLines={1}>{p.title}</Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', marginTop: 10 }}>
                <View style={{ width: `${fraction * 100}%`, height: 6, borderRadius: 3, backgroundColor: colors.accent }} />
                {p.marks.map((m, i) => (
                  <View key={i} style={{ position: 'absolute', left: `${m * 100}%`, top: -3, width: 3, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.75)' }} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: '#fff', fontSize: 16 }}>{formatClock(p.position)}</Text>
                <Text style={{ color: colors.muted, fontSize: 16 }}>{formatClock(p.duration)}</Text>
              </View>
            </View>
          </View>
          {state.open !== 'none' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              {p.buttons.map((b, i) => {
                const focused = state.open === 'bar' && state.focus === i;
                return (
                  <View key={b} accessibilityRole="button" accessibilityLabel={label(b)} accessibilityState={{ selected: focused }} style={{ alignItems: 'center', gap: 6 }}>
                    <View style={{ width: focused ? 64 : 52, height: focused ? 64 : 52, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? '#fff' : 'rgba(255,255,255,0.12)' }}>
                      <Feather name={b === 'play' && p.playing ? 'pause' : ICONS[b]} size={focused ? 28 : 22} color={focused ? colors.bg : '#fff'} />
                    </View>
                    <Text style={{ color: focused ? '#fff' : colors.muted, fontSize: 13 }}>{focused ? label(b) : ' '}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {p.skipLabel && !p.upNext && state.open === 'none' && (
        <View style={{ position: 'absolute', right: 48, bottom: p.visible ? 230 : 48, borderRadius: radius.pill, backgroundColor: '#fff', paddingHorizontal: 26, paddingVertical: 14 }}>
          <Text style={{ color: colors.bg, fontSize: 18, fontWeight: '700' }}>{p.skipLabel}</Text>
        </View>
      )}

      {p.upNext && state.open === 'none' && (
        <View style={{ position: 'absolute', right: 48, bottom: p.visible ? 230 : 48, width: 420, backgroundColor: 'rgba(20,18,28,0.95)', borderRadius: radius.lg, padding: 22, gap: 14, borderWidth: 1, borderColor: colors.line }}>
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
