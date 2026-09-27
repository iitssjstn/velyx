import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { deviceDecoders } from '../../../../modules/velyx-codecs';
import { SeekBar } from '../../../components/SeekBar';
import { playerScreenState } from '../../../components/screen';
import { Button, styles } from '../../../components/ui';
import { episodeCode, formatClock } from '../../../lib/format';
import { NO_RETRIES, endOfStream, fallbackCaps, retryAt, playbackCaps, playerAudioPosition, resumePoint, streamFrom, type PlaybackAnswer, type PlaybackCaps, type SubtitleOption } from '../../../lib/playback';
import { rememberSubtitle, rememberedSubtitle, storeSubtitleStyle, storedSubtitleStyle } from '../../../lib/remember';
import { DEFAULT_SUBTITLE_STYLE, clampPosition, stepDelay, subtitleBottom, subtitleTextStyle, type SubtitleStyle } from '../../../lib/subtitleStyle';
import { choiceFor, initialSubtitle, type SubtitlePrefs } from '../../../lib/subtitles';
import { useSession } from '../../../lib/session';
import { skipAt, upNextStart, type EpisodeSegments, type SkipMode } from '../../../lib/skip';
import { colors, radius } from '../../../lib/theme';
import { cueTextAt, parseVtt, type Cue } from '../../../lib/vtt';

interface NextEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
}

interface Item {
  kind: 'movie' | 'episode';
  id: number;
  fileId: number;
  title: string;
  subtitle: string | null;
  progress: { positionSec: number; durationSec: number; completed: boolean } | null;
  next: NextEpisode | null;
  segments: EpisodeSegments | null;
}

interface Prefs extends SubtitlePrefs {
  skipIntro?: SkipMode;
  skipCredits?: SkipMode;
}

const SAVE_EVERY_MS = 10_000;
const HIDE_CONTROLS_MS = 4000;
const NEXT_COUNTDOWN = 10;
const DOUBLE_TAP_MS = 300;

export default function Player() {
  const { kind, id, t: startParam } = useLocalSearchParams<{ kind: string; id: string; t?: string }>();
  const { api, t, serverUrl } = useSession();

  const item = useQuery({
    queryKey: [serverUrl, 'play-item', kind, id],
    // Always fresh: a cached copy would resume from where the previous playback started.
    gcTime: 0,
    staleTime: 0,
    // Loaded once per playback, not again when coming back to the app.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<Item> => {
      if (kind === 'episode') {
        const e = await api.get<{ id: number; showTitle: string; seasonNumber: number; episodeNumber: number; title: string | null; files: { id: number }[]; progress: Item['progress']; next: NextEpisode | null; segments?: EpisodeSegments | null }>(`/api/episodes/${id}`);
        if (!e.files[0]) throw new Error(t('player.cannotPlay'));
        return { kind: 'episode', id: e.id, fileId: e.files[0].id, title: e.showTitle, subtitle: [episodeCode(e.seasonNumber, e.episodeNumber), e.title].filter(Boolean).join(' · '), progress: e.progress, next: e.next, segments: e.segments ?? null };
      }
      const m = await api.get<{ id: number; title: string; year: number | null; files: { id: number }[]; progress: Item['progress'] }>(`/api/movies/${id}`);
      if (!m.files[0]) throw new Error(t('player.cannotPlay'));
      return { kind: 'movie', id: m.id, fileId: m.files[0].id, title: m.title, subtitle: m.year ? String(m.year) : null, progress: m.progress, next: null, segments: null };
    },
  });
  const prefs = useQuery({ queryKey: [serverUrl, 'account-prefs'], queryFn: () => api.get<Prefs>('/api/account/preferences') });

  // Landscape without the navigation bar while watching (a swipe from the edge shows it briefly);
  // back to the app's own orientation when the last player closes.
  useEffect(() => {
    playerScreenState.enter();
    return () => playerScreenState.leave();
  }, []);

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
  const { api, t, serverUrl } = useSession();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
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
  /** How subtitles look (kept on this device) and their timing for this playback (+ is later). */
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [subDelay, setSubDelay] = useState(0);
  const [screenHeight, setScreenHeight] = useState(360);
  useEffect(() => {
    let alive = true;
    void storedSubtitleStyle().then((st) => alive && setSubStyle(st));
    return () => {
      alive = false;
    };
  }, []);
  const changeStyle = (patch: Partial<SubtitleStyle>) =>
    setSubStyle((current) => {
      const next = { ...current, ...patch };
      void storeSubtitleStyle(next);
      return next;
    });
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [seekFlash, setSeekFlash] = useState<'back' | 'forward' | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const tracksSet = useRef(false);
  /** A stream is loaded and ready (the player exists before that, without a video). */
  const streamReady = useRef(false);
  const lastSave = useRef(0);
  /** The caps of the current stream; after a failed first try, the safer second-try caps. */
  const capsRef = useRef<PlaybackCaps>(playbackCaps(deviceDecoders()));
  const triedFallback = useRef(false);
  const autoSkipped = useRef(new Set<string>());

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
      tracksSet.current = false;
      streamReady.current = false;
      setEnded(false);
      await player.replaceAsync({ uri: s.uri, headers: api.headers(), metadata: { title: item.title, artist: item.subtitle ?? undefined } });
      player.play();
    },
    [api, player, item.title, item.subtitle],
  );

  /** Asks the server how to play the file on this device (for an audio track), then plays from `at`. */
  const decide = useCallback(
    async (at: number, wantedAudio?: number) => {
      try {
        const caps = { ...capsRef.current, ...(wantedAudio !== undefined ? { audioIndex: wantedAudio } : {}) };
        const a = await api.post<PlaybackAnswer>(`/api/media/${item.fileId}/playback`, caps);
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
    void decide(startAt ?? resumePoint(item.progress) ?? 0);
    // Once per item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The subtitle the account asks for (or the last choice on this device), once the list is known.
  const subtitlePicked = useRef(false);
  useEffect(() => {
    if (!answer || subtitlePicked.current) return;
    subtitlePicked.current = true;
    const audio = answer.file.audioTracks.find((a) => a.index === answer.decision.audioIndex);
    void rememberedSubtitle().then((remembered) => setSubtitle((current) => current ?? initialSubtitle(answer.subtitles, prefs, remembered, audio?.language ?? null)));
  }, [answer, prefs]);
  /** A subtitle picked in the menu: shown now and remembered for the next time. */
  const chooseSubtitle = (option: SubtitleOption | null) => {
    setSubtitle(option);
    setMenu(false);
    void rememberSubtitle(choiceFor(option));
  };

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
    if (status === 'readyToPlay') streamReady.current = true;
    if (status === 'readyToPlay' && pendingSeek.current !== null) {
      player.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    }
    // Once per stream: setting tracks again after every buffering pause can interrupt playback.
    if (status === 'readyToPlay' && answer && !tracksSet.current) {
      tracksSet.current = true;
      // No subtitles from the file itself: the app shows its own.
      player.subtitleTrack = null;
      const pos = playerAudioPosition(answer.file.audioTracks, answer.decision.audioIndex);
      const track = pos >= 0 ? player.availableAudioTracks[pos] : undefined;
      if (track && answer.decision.seek === 'range') player.audioTrack = track;
    }
    if (status === 'error') {
      // It played, then failed (a lost connection; a converted stream the server ended while the
      // app was in the background): continue from the same spot.
      if (streamReady.current && continueAt(position)) return;
      // The original file did not play after all: once, ask the server for a repackaged stream.
      if (answer?.decision.engine === 'direct' && !triedFallback.current) {
        triedFallback.current = true;
        capsRef.current = fallbackCaps(capsRef.current);
        void decide(position, audioIndex ?? undefined);
        return;
      }
      setProblem(t('player.failed', { reason: error?.message ?? t('common.error') }));
    }
  });
  // A stream that stops well before the end broke off (connection lost, server stalled): continue
  // from there — a few times at most at the same spot — instead of ending the episode.
  const resumes = useRef(NO_RETRIES);
  /** Continues the stream at `at` when it broke off; false when it keeps breaking there. */
  const continueAt = (at: number): boolean => {
    if (!answer) return false;
    const next = retryAt(resumes.current, at);
    resumes.current = next.retries;
    if (!next.allowed) return false;
    void load(answer, at).catch((err: Error) => setProblem(err.message || t('common.error')));
    return true;
  };
  useEventListener(player, 'playToEnd', () => {
    const kind = answer ? endOfStream(streamReady.current, position, duration) : 'ignore';
    if (kind === 'ignore') return;
    if (kind === 'resume') {
      if (continueAt(position)) return;
      void save(position, true);
      setProblem(t('player.interrupted'));
      return;
    }
    void save(duration, true);
    setEnded(true);
    setControls(true);
    if (item.next && !nextDismissed && countdown === null) setCountdown(NEXT_COUNTDOWN);
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
  // On leaving: save, then refresh the lists (Continue Watching, progress bars) with the new position.
  useEffect(
    () => () => {
      void Promise.resolve(saveRef.current()).finally(() => void qc.invalidateQueries({ queryKey: [serverUrl] }));
    },
    [qc, serverUrl],
  );

  // ---------------------------------------------------------------- skip intro / credits
  const modes = { intro: prefs?.skipIntro ?? 'ask', credits: prefs?.skipCredits ?? 'ask' };
  const skip = answer && !loading ? skipAt(item.segments, item.fileId, position, modes) : null;
  const goNext = useCallback(() => {
    if (item.next) router.replace(`/play/episode/${item.next.id}?t=0`);
  }, [item.next]);

  // ---------------------------------------------------------------- next episode
  // Offered when the credits begin (or in the last seconds), with a countdown unless dismissed.
  const upNextAt = item.next ? upNextStart(item.segments, item.fileId, duration, NEXT_COUNTDOWN) : null;
  const nearEnd = upNextAt !== null && position >= upNextAt;
  // Only after playing up to that moment: starting (or jumping) straight into the credits does not
  // start the countdown — then it waits for the end of the episode.
  const reachedEnd = useRef(false);
  const lastPosition = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || loading || upNextAt === null) return;
    const before = lastPosition.current;
    lastPosition.current = position;
    if (before !== null && before < upNextAt && position >= upNextAt && position - before < 5) reachedEnd.current = true;
    if (position < upNextAt) reachedEnd.current = false;
  }, [position, playing, loading, upNextAt]);
  useEffect(() => {
    if (!item.next || nextDismissed) return;
    if (nearEnd && playing && reachedEnd.current) setCountdown((c) => c ?? NEXT_COUNTDOWN);
    // Seeking back out of the end cancels it.
    if (!nearEnd && !ended) setCountdown(null);
  }, [nearEnd, playing, ended, item.next, nextDismissed, position]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      goNext();
      return;
    }
    // Paused before the end: the countdown waits too.
    if (!playing && !ended) return;
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, playing, ended, goNext]);

  // ---------------------------------------------------------------- controls
  // Hidden after a few seconds without touching them (counted from the last touch, not the last
  // time update — those come twice a second).
  const [touched, setTouched] = useState(0);
  const poke = () => setTouched((n) => n + 1);
  useEffect(() => {
    if (!controls || !playing || menu || scrub !== null) return;
    const timer = setTimeout(() => setControls(false), HIDE_CONTROLS_MS);
    return () => clearTimeout(timer);
  }, [controls, playing, menu, scrub, touched]);

  const seekTo = useCallback(
    (target: number) => {
      if (!answer) return;
      const tt = Math.max(0, Math.min(Math.max(0, duration - 1), target));
      setEnded(false);
      setTouched((n) => n + 1);
      if (answer.decision.seek === 'restart') void load(answer, tt);
      else {
        player.currentTime = tt;
        // Show the new position straight away instead of after the next time update.
        setTime(tt);
      }
    },
    [answer, duration, load, player],
  );

  // Always-skip: once per part and item, as on the website; credits with nothing after them go
  // straight to the next episode when there is one.
  useEffect(() => {
    if (!skip || skip.mode !== 'always' || autoSkipped.current.has(skip.kind)) return;
    if (skip.kind === 'credits' && skip.toNext && item.next) {
      // Straight on to the next episode only when the credits were reached by watching, not when
      // playback started inside them.
      if (!reachedEnd.current) return;
      autoSkipped.current.add(skip.kind);
      goNext();
      return;
    }
    autoSkipped.current.add(skip.kind);
    seekTo(skip.to);
  }, [skip, item.next, goNext, seekTo, position]);

  const toggle = () => {
    poke();
    if (ended) {
      seekTo(0);
      player.play();
    } else if (playing) player.pause();
    else player.play();
  };

  // A tap shows or hides the controls; a double tap on the left or right third seeks 10 seconds.
  const lastTap = useRef({ at: 0, x: 0 });
  const onTap = (e: GestureResponderEvent) => {
    const now = Date.now();
    const x = e.nativeEvent.pageX;
    const prev = lastTap.current;
    lastTap.current = { at: now, x };
    poke();
    if (now - prev.at < DOUBLE_TAP_MS && Math.abs(x - prev.x) < 80 && screenWidth.current > 0) {
      const side = x < screenWidth.current / 3 ? 'back' : x > (screenWidth.current * 2) / 3 ? 'forward' : null;
      if (side) {
        // Undo the first tap's show/hide and seek instead.
        setControls((c) => !c);
        seekTo(position + (side === 'back' ? -10 : 10));
        setSeekFlash(side);
        return;
      }
    }
    setControls((c) => !c);
  };
  const screenWidth = useRef(0);
  useEffect(() => {
    if (!seekFlash) return;
    const timer = setTimeout(() => setSeekFlash(null), 600);
    return () => clearTimeout(timer);
  }, [seekFlash]);

  if (problem) return <Problem message={problem} />;

  const text = cueTextAt(cues, position - subDelay);
  const shown = scrub ?? position;
  const audioTracks = answer?.file.audioTracks ?? [];
  const showNext = Boolean(item.next && countdown !== null && !nextDismissed);
  return (
    <View style={{ flex: 1 }} onLayout={(e) => {
        screenWidth.current = e.nativeEvent.layout.width;
        setScreenHeight(e.nativeEvent.layout.height);
      }}>
      <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" allowsPictureInPicture={false} />
      {text ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: 24, bottom: subtitleBottom(subStyle, screenHeight, controls) + insets.bottom, alignItems: 'center' }}>
          <Text style={subtitleTextStyle(subStyle, screenHeight)}>{text}</Text>
        </View>
      ) : null}
      {seekFlash && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, [seekFlash === 'back' ? 'left' : 'right']: 48, justifyContent: 'center' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: 16 }}>
            <Feather name={seekFlash === 'back' ? 'rotate-ccw' : 'rotate-cw'} size={32} color="#fff" />
          </View>
        </View>
      )}
      <Pressable accessibilityLabel={t('player.tracks')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onTap}>
        {controls && (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'space-between', paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }}>
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
              <SeekBar position={position} duration={duration} onScrub={setScrub} onSeek={seekTo} label={t('player.seek')} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#fff' }}>{formatClock(shown)}</Text>
                <Text style={{ color: colors.muted }}>{formatClock(duration)}</Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
      {/* Skip intro / credits: visible with or without the controls, above them. */}
      {skip?.mode === 'ask' && !showNext && (
        <View style={{ position: 'absolute', right: 24 + insets.right, bottom: (controls ? 110 : 32) + insets.bottom }}>
          <Button
            label={skip.kind === 'intro' ? t('player.skipIntro') : t('player.skipCredits')}
            onPress={() => {
              if (skip.kind === 'credits' && skip.toNext && item.next) goNext();
              else seekTo(skip.to);
            }}
          />
        </View>
      )}
      {showNext && item.next && (
        <View style={{ position: 'absolute', right: 24 + insets.right, bottom: (controls ? 110 : 32) + insets.bottom, width: 300, maxWidth: '80%', backgroundColor: 'rgba(20,18,28,0.92)', borderRadius: radius.lg, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.line }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{t('player.next')}</Text>
          <Text style={{ color: colors.ink, fontWeight: '700' }} numberOfLines={2}>
            {episodeCode(item.next.seasonNumber, item.next.episodeNumber)}
            {item.next.title ? ` · ${item.next.title}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label={t('player.playIn', { n: Math.max(0, countdown ?? 0) })} onPress={goNext} />
            </View>
            {!ended && (
              <Button
                label={t('player.watchCredits')}
                variant="ghost"
                onPress={() => {
                  setNextDismissed(true);
                  setCountdown(null);
                }}
              />
            )}
          </View>
        </View>
      )}
      <Modal visible={menu} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setMenu(false)} supportedOrientations={['landscape', 'portrait']}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'flex-end' }} onPress={() => setMenu(false)} accessibilityLabel={t('player.close')}>
          <Pressable style={{ width: 320 + insets.right, maxWidth: '90%', height: '100%', backgroundColor: colors.surface, paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom, paddingLeft: 16, paddingRight: 16 + insets.right }} onPress={() => undefined}>
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
              <Choice label={t('player.off')} selected={!subtitle} onPress={() => chooseSubtitle(null)} />
              {(answer?.subtitles ?? []).map((s) => (
                <Choice key={s.key} label={[s.languageName || s.label, s.title && s.title !== s.languageName ? s.title : null, s.forced ? 'Forced' : null].filter(Boolean).join(' · ')} selected={subtitle?.key === s.key} onPress={() => chooseSubtitle(s)} />
              ))}
              <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>{t('subtitleStyle.title')}</Text>
              <Segmented label={t('subtitleStyle.size')} value={subStyle.size} onChange={(v) => changeStyle({ size: v })} options={[['small', 'S'], ['medium', 'M'], ['large', 'L'], ['xlarge', 'XL']]} />
              <Segmented label={t('subtitleStyle.color')} value={subStyle.color} onChange={(v) => changeStyle({ color: v })} options={[['white', t('subtitleStyle.white')], ['yellow', t('subtitleStyle.yellow')]]} />
              <Segmented label={t('subtitleStyle.background')} value={subStyle.background} onChange={(v) => changeStyle({ background: v })} options={[['none', t('subtitleStyle.none')], ['translucent', t('subtitleStyle.dimmed')], ['solid', t('subtitleStyle.solid')]]} />
              <Segmented label={t('subtitleStyle.edge')} value={subStyle.edge} onChange={(v) => changeStyle({ edge: v })} options={[['shadow', t('subtitleStyle.shadow')], ['outline', t('subtitleStyle.outline')], ['none', t('subtitleStyle.none')]]} />
              <Stepper
                label={t('subtitleStyle.position')}
                value={subStyle.position === 0 ? t('subtitleStyle.bottom') : `+${subStyle.position}%`}
                onMinus={() => changeStyle({ position: clampPosition(subStyle.position - 5) })}
                onPlus={() => changeStyle({ position: clampPosition(subStyle.position + 5) })}
              />
              <Stepper
                label={t('subtitleStyle.sync')}
                hint={t('subtitleStyle.syncHint')}
                value={subDelay === 0 ? t('subtitleStyle.inSync') : `${subDelay > 0 ? '+' : ''}${subDelay.toFixed(1)} s`}
                onMinus={() => setSubDelay((d) => stepDelay(d, -1))}
                onPlus={() => setSubDelay((d) => stepDelay(d, 1))}
                onReset={subDelay !== 0 ? () => setSubDelay(0) : undefined}
              />
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

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <View style={{ gap: 6, paddingVertical: 4 }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: colors.raised, borderRadius: radius.sm, padding: 2 }}>
        {options.map(([v, text]) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected: v === value }}
            onPress={() => onChange(v)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center', backgroundColor: v === value ? colors.accent : 'transparent' }}
          >
            <Text style={{ color: v === value ? colors.accentInk : colors.ink, fontSize: 13 }} numberOfLines={1}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Stepper({ label, value, hint, onMinus, onPlus, onReset }: { label: string; value: string; hint?: string; onMinus: () => void; onPlus: () => void; onReset?: () => void }) {
  return (
    <View style={{ gap: 6, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
        {hint ? <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <IconButton name="minus" label={`${label} −`} onPress={onMinus} size={20} />
        <Text style={{ color: colors.ink, flex: 1, textAlign: 'center' }} accessibilityLiveRegion="polite">{value}</Text>
        <IconButton name="plus" label={`${label} +`} onPress={onPlus} size={20} />
        {onReset ? <IconButton name="rotate-ccw" label={`${label}: 0`} onPress={onReset} size={18} /> : null}
      </View>
    </View>
  );
}
