import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { deviceDecoders } from '../../../../modules/velyx-codecs';
import { SeekBar } from '../../../components/SeekBar';
import { Button, styles } from '../../../components/ui';
import { episodeCode, formatClock } from '../../../lib/format';
import { pickSubtitle, playbackCaps, playerAudioPosition, streamFrom, type PlaybackAnswer, type SubtitleOption } from '../../../lib/playback';
import { useSession } from '../../../lib/session';
import { colors, radius } from '../../../lib/theme';
import { cueTextAt, parseVtt, type Cue } from '../../../lib/vtt';

interface Item {
  kind: 'movie' | 'episode';
  id: number;
  fileId: number;
  title: string;
  subtitle: string | null;
  progress: { positionSec: number; completed: boolean } | null;
  next: { id: number; seasonNumber: number; episodeNumber: number; title: string | null } | null;
}

interface Prefs {
  subtitleMode?: string;
  subtitleLanguage?: string | null;
}

const SAVE_EVERY_MS = 10_000;
const HIDE_CONTROLS_MS = 4000;
const NEXT_COUNTDOWN = 10;

export default function Player() {
  const { kind, id, t: startParam } = useLocalSearchParams<{ kind: string; id: string; t?: string }>();
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();

  const item = useQuery({
    queryKey: [serverUrl, 'play-item', kind, id],
    queryFn: async (): Promise<Item> => {
      if (kind === 'episode') {
        const e = await api.get<{ id: number; showTitle: string; seasonNumber: number; episodeNumber: number; title: string | null; files: { id: number }[]; progress: Item['progress']; next: Item['next'] }>(`/api/episodes/${id}`);
        if (!e.files[0]) throw new Error(t('player.cannotPlay'));
        return { kind: 'episode', id: e.id, fileId: e.files[0].id, title: e.showTitle, subtitle: [episodeCode(e.seasonNumber, e.episodeNumber), e.title].filter(Boolean).join(' · '), progress: e.progress, next: e.next };
      }
      const m = await api.get<{ id: number; title: string; year: number | null; files: { id: number }[]; progress: Item['progress'] }>(`/api/movies/${id}`);
      if (!m.files[0]) throw new Error(t('player.cannotPlay'));
      return { kind: 'movie', id: m.id, fileId: m.files[0].id, title: m.title, subtitle: m.year ? String(m.year) : null, progress: m.progress, next: null };
    },
  });
  const prefs = useQuery({ queryKey: [serverUrl, 'account-prefs'], queryFn: () => api.get<Prefs>('/api/account/preferences') });

  // Landscape and no status bar while watching; back to normal on leaving.
  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => undefined);
    return () => void ScreenOrientation.unlockAsync().catch(() => undefined);
  }, []);

  // Everything the server needs to know is saved when leaving, so lists are fresh afterwards.
  useEffect(
    () => () => {
      void qc.invalidateQueries({ queryKey: [serverUrl] });
    },
    [qc, serverUrl],
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar hidden />
      {item.error ? (
        <Problem message={(item.error as Error).message} />
      ) : item.data && !prefs.isLoading ? (
        <Playback key={`${item.data.kind}-${item.data.id}`} item={item.data} prefs={prefs.data ?? null} startAt={startParam !== undefined ? Number(startParam) : null} />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}
    </View>
  );
}

function Problem({ message }: { message: string }) {
  const { t } = useSession();
  return (
    <View style={[styles.center, { backgroundColor: '#000', padding: 24, gap: 16 }]}>
      <Text style={[styles.body, { textAlign: 'center' }]}>{message}</Text>
      <Button label={t('player.back')} variant="ghost" onPress={() => router.back()} />
    </View>
  );
}

function Playback({ item, prefs, startAt }: { item: Item; prefs: Prefs | null; startAt: number | null }) {
  const { api, t } = useSession();
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.keepScreenOnWhilePlaying = true;
  });

  const [answer, setAnswer] = useState<PlaybackAnswer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState(false);
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [subtitle, setSubtitle] = useState<SubtitleOption | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const lastSave = useRef(0);

  const duration = answer?.file.durationSec ?? answer?.decision.durationSec ?? 0;
  const position = offset + time;

  /** Loads the stream (again) for `at` seconds into the file. */
  const load = useCallback(
    async (a: PlaybackAnswer, at: number) => {
      setLoading(true);
      const s = await streamFrom(api, a, at);
      setOffset(s.offset);
      setTime(Math.max(0, at - s.offset));
      // Direct play starts at 0 and seeks once the file is open; a remux stream already starts there.
      pendingSeek.current = a.decision.seek === 'range' && at > 0 ? at : null;
      await player.replaceAsync({ uri: s.uri, headers: api.headers(), metadata: { title: item.title, artist: item.subtitle ?? undefined } });
      player.play();
    },
    [api, player, item.title, item.subtitle],
  );

  /** Asks the server how to play the file on this device (for an audio track), then plays from `at`. */
  const decide = useCallback(
    async (at: number, wantedAudio?: number) => {
      try {
        const a = await api.post<PlaybackAnswer>(`/api/media/${item.fileId}/playback`, playbackCaps(deviceDecoders(), wantedAudio));
        if (a.analysis.mode === 'unsupported') {
          setProblem([t('player.cannotPlay'), ...a.analysis.problems].join('\n\n'));
          return;
        }
        const sameStream = answer && a.decision.streamUrl === answer.decision.streamUrl && a.decision.seek === 'range';
        setAnswer(a);
        setAudioIndex(a.decision.audioIndex);
        if (sameStream) {
          // Same file, other audio track: the player switches without reloading.
          const pos = playerAudioPosition(a.file.audioTracks, a.decision.audioIndex);
          const track = pos >= 0 ? player.availableAudioTracks[pos] : undefined;
          if (track) player.audioTrack = track;
          return;
        }
        await load(a, at);
      } catch (err) {
        setProblem((err as Error).message || t('common.error'));
      }
    },
    [api, item.fileId, answer, load, player, t],
  );

  // Start: resume where the viewer stopped (unless asked to start elsewhere).
  useEffect(() => {
    const resume = item.progress && !item.progress.completed ? item.progress.positionSec : 0;
    void decide(startAt ?? resume);
    // Once per item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The subtitle the account asks for, once the list is known.
  const subtitlePicked = useRef(false);
  useEffect(() => {
    if (!answer || subtitlePicked.current) return;
    subtitlePicked.current = true;
    const audio = answer.file.audioTracks.find((a) => a.index === answer.decision.audioIndex);
    setSubtitle(pickSubtitle(answer.subtitles, prefs, audio?.language ?? null));
  }, [answer, prefs]);

  // Subtitles are shown by the app (the same for direct play and remux), from the server's WebVTT.
  useEffect(() => {
    setCues([]);
    if (!subtitle) return;
    let alive = true;
    fetch(api.url(subtitle.url), { headers: api.headers() })
      .then((r) => r.text())
      .then((text) => alive && setCues(parseVtt(text)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [subtitle, api]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => setTime(currentTime));
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, 'statusChange', ({ status, error }) => {
    setLoading(status === 'loading');
    if (status === 'readyToPlay' && pendingSeek.current !== null) {
      player.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    }
    if (status === 'readyToPlay' && answer) {
      // No subtitles from the file itself: the app shows its own.
      player.subtitleTrack = null;
      const pos = playerAudioPosition(answer.file.audioTracks, answer.decision.audioIndex);
      const track = pos >= 0 ? player.availableAudioTracks[pos] : undefined;
      if (track && answer.decision.seek === 'range') player.audioTrack = track;
    }
    if (status === 'error') setProblem(t('player.failed', { reason: error?.message ?? t('common.error') }));
  });
  useEventListener(player, 'playToEnd', () => {
    void save(duration, true);
    setEnded(true);
    setControls(true);
    if (item.next) setCountdown(NEXT_COUNTDOWN);
  });

  // ---------------------------------------------------------------- progress
  const save = useCallback(
    async (pos: number, force = false) => {
      if (!duration || (!force && Date.now() - lastSave.current < SAVE_EVERY_MS)) return;
      lastSave.current = Date.now();
      try {
        await api.post('/api/progress', { [item.kind === 'movie' ? 'movieId' : 'episodeId']: item.id, positionSec: Math.round(pos), durationSec: Math.round(duration) });
      } catch {
        /* saved again at the next moment */
      }
    },
    [api, duration, item.kind, item.id],
  );
  useEffect(() => {
    if (playing) void save(position);
  }, [playing, position, save]);
  // The last known position, for saving when leaving (the native player may be gone by then).
  const saveRef = useRef<() => unknown>(() => undefined);
  saveRef.current = () => save(position, true);
  useEffect(() => {
    if (!playing && answer) void saveRef.current();
  }, [playing, answer]);
  useEffect(() => () => void saveRef.current(), []);

  // ---------------------------------------------------------------- next episode
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      if (item.next) router.replace(`/play/episode/${item.next.id}?t=0`);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, item.next]);

  // ---------------------------------------------------------------- controls
  useEffect(() => {
    if (!controls || !playing || menu || scrub !== null) return;
    const timer = setTimeout(() => setControls(false), HIDE_CONTROLS_MS);
    return () => clearTimeout(timer);
  }, [controls, playing, menu, scrub, time]);

  const seekTo = (target: number) => {
    if (!answer) return;
    const tt = Math.max(0, Math.min(Math.max(0, duration - 1), target));
    setEnded(false);
    setCountdown(null);
    if (answer.decision.seek === 'restart') void load(answer, tt);
    else player.currentTime = tt;
  };
  const toggle = () => {
    if (ended) {
      seekTo(0);
      player.play();
    } else if (playing) player.pause();
    else player.play();
  };

  if (problem) return <Problem message={problem} />;

  const text = cueTextAt(cues, position);
  const shown = scrub ?? position;
  const audioTracks = answer?.file.audioTracks ?? [];
  return (
    <View style={{ flex: 1 }}>
      <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" allowsPictureInPicture={false} />
      {text ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: 24, bottom: controls ? 96 : 28, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 20, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>{text}</Text>
        </View>
      ) : null}
      <Pressable accessibilityLabel={t('player.tracks')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => setControls((c) => !c)}>
        {controls && (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'space-between', padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconButton name="arrow-left" label={t('player.back')} onPress={() => router.back()} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? <Text style={{ color: colors.muted }} numberOfLines={1}>{item.subtitle}</Text> : null}
              </View>
              <IconButton name="message-square" label={t('player.tracks')} onPress={() => setMenu(true)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 }}>
              <IconButton name="rotate-ccw" label={t('player.back10')} onPress={() => seekTo(position - 10)} size={30} />
              {loading ? <ActivityIndicator color="#fff" size="large" /> : <IconButton name={playing ? 'pause' : ended ? 'rotate-cw' : 'play'} label={playing ? t('player.pause') : t('player.play')} onPress={toggle} size={44} />}
              <IconButton name="rotate-cw" label={t('player.forward10')} onPress={() => seekTo(position + 10)} size={30} />
            </View>
            <View style={{ gap: 4 }}>
              {countdown !== null && item.next && (
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                  <Button label={t('player.nextIn', { n: countdown })} onPress={() => router.replace(`/play/episode/${item.next!.id}?t=0`)} />
                </View>
              )}
              <SeekBar position={position} duration={duration} onScrub={setScrub} onSeek={seekTo} label={t('player.seek')} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#fff' }}>{formatClock(shown)}</Text>
                <Text style={{ color: colors.muted }}>{formatClock(duration)}</Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)} supportedOrientations={['landscape', 'portrait']}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'flex-end' }} onPress={() => setMenu(false)} accessibilityLabel={t('player.close')}>
          <Pressable style={{ width: 320, maxWidth: '90%', height: '100%', backgroundColor: colors.surface, padding: 16 }} onPress={() => undefined}>
            <ScrollView contentContainerStyle={{ gap: 6 }}>
              <Text style={[styles.label, { marginBottom: 4 }]}>{t('player.audio')}</Text>
              {audioTracks.map((a) => (
                <Choice
                  key={a.index}
                  label={[a.title || a.languageName || a.language || `#${a.index}`, a.channels ? (a.channels === 6 ? '5.1' : a.channels === 8 ? '7.1' : a.channels === 2 ? 'Stereo' : t('player.channels', { n: a.channels })) : null, a.codec?.toUpperCase()].filter(Boolean).join(' · ')}
                  selected={a.index === audioIndex}
                  onPress={() => {
                    setMenu(false);
                    if (a.index !== audioIndex) void decide(position, a.index);
                  }}
                />
              ))}
              <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>{t('player.subtitles')}</Text>
              <Choice label={t('player.off')} selected={!subtitle} onPress={() => (setSubtitle(null), setMenu(false))} />
              {(answer?.subtitles ?? []).map((s) => (
                <Choice key={s.key} label={[s.languageName || s.label, s.title && s.title !== s.languageName ? s.title : null, s.forced ? 'Forced' : null].filter(Boolean).join(' · ')} selected={subtitle?.key === s.key} onPress={() => (setSubtitle(s), setMenu(false))} />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function IconButton({ name, label, onPress, size = 24 }: { name: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void; size?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={12} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
      <Feather name={name} size={size} color="#fff" />
    </Pressable>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: selected ? colors.raised : 'transparent' }}
    >
      <Feather name="check" size={16} color={selected ? colors.accent : 'transparent'} />
      <Text style={{ color: colors.ink, flex: 1 }} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}
