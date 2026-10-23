import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, BackHandler, Easing, Modal, Pressable, ScrollView, Text, View, type GestureResponderEvent } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { CastContext, MediaPlayerIdleReason, MediaPlayerState, useCastDevice, useMediaStatus, useRemoteMediaClient } from 'react-native-google-cast';
import { deviceDecoders } from '../../../../modules/vidalune-codecs';
import { Artwork } from '../../../components/media';
import { CastIcon } from '../../../components/CastIcon';
import { useCastStatus } from '../../../components/CastStatus';
import { OnlineSubtitles } from '../../../components/OnlineSubtitles';
import { SeekBar } from '../../../components/SeekBar';
import { TvPlayer } from '../../../components/TvPlayer';
import { CastReceiver, RemoteKeys, type CastCommand } from '../../../../modules/vidalune-tv';
import { TV, castRemoteOrientation, playbackOrientation, playerScreenState } from '../../../components/screen';
import { Button, styles } from '../../../components/ui';
import { castSettled, castStartAt, castStatus } from '../../../lib/castStatus';
import { applyCastTextTrackStyle, castLoadFailed, castLoadRequest, castTrackIds, followTv, loadCastWithCurrentSubtitle, sessionUsable, tvChanged, tvFilePosition, tvMedia, tvSubtitleKey, waitForCastReady, type CastSession, type TvSeen } from '../../../lib/cast';
import { episodeCode, formatClock, imagePath } from '../../../lib/format';
import { NO_RETRIES, endOfStream, fallbackCaps, retryAt, playbackCaps, playerAudioPosition, preferredAudio, resumePoint, stillLoading, streamFrom, subtitleUrl, type PlaybackAnswer, type PlaybackCaps, type SubtitleOption } from '../../../lib/playback';
import { defaultOnlineLanguage } from '../../../lib/onlineSubtitles';
import { rememberAudio, rememberSubtitle, rememberedAudio, rememberedSubtitle, storeSeekStep, storeSubtitleStyle, storedSeekStep, storedSubtitleStyle } from '../../../lib/remember';
import { DEFAULT_SUBTITLE_STYLE, TV_SUBTITLE_STYLE, castSubtitlePreview, editSubtitleStyle, clampPosition, stepDelay, subtitleBottom, subtitleTextStyle, tvSubtitleBottom, TV_BAR_HEIGHT, type SubtitleStyle } from '../../../lib/subtitleStyle';
import { createSubtitleStyleSync, subtitlePreferencesReady, subtitleStyleAccountScope } from '../../../lib/subtitleStyleSync';
import { castConnectData, castGiven, castPlayerState, castSubtitleFor, castSubtitleKeys, castTrackIdsFor } from '../../../lib/castConnect';
import { choiceFor, initialSubtitle, type SubtitlePrefs } from '../../../lib/subtitles';
import { errorMessage } from '../../../lib/connection';
import { useSession } from '../../../lib/session';
import { addSeek, justSkipped, SEEK_COMBINE_MS, SEEK_STEPS, skipAt, upNextStart, type DoneSkip, type EpisodeSegments, type PendingSeek, type SeekStep, type SkipMode } from '../../../lib/skip';
import { colors, radius } from '../../../lib/theme';
import { tvFocus } from '../../../lib/tvFocus';
import { TV_CONTROLS_MS, initialTvState, pressKey, remoteKey, segmentMarks, tvButtons, tvTabs, type RemoteKey, type TvContext } from '../../../lib/tvRemote';
import { SUBTITLE_ERROR_FOR_MS, SUBTITLE_LOADING_AFTER_MS, cueTextAt, cuesFrom, type Cue } from '../../../lib/vtt';

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
  /** Artwork shown on the TV while casting. */
  artwork: string | null;
  poster: string | null;
  progress: { positionSec: number; durationSec: number; completed: boolean } | null;
  next: NextEpisode | null;
  segments: EpisodeSegments | null;
}

interface Prefs extends SubtitlePrefs {
  audioLanguage?: string | null;
  subtitleStyle?: SubtitleStyle | null;
  skipIntro?: SkipMode;
  skipCredits?: SkipMode;
  skipRecap?: SkipMode;
}

const SAVE_EVERY_MS = 10_000;
const HIDE_CONTROLS_MS = 4000;
const NEXT_COUNTDOWN = 10;
const DOUBLE_TAP_MS = 300;

export default function Player() {
  const { kind, id, t: startParam, tv: tvParam, bar, sub, audio, o, n } = useLocalSearchParams<{ kind: string; id: string; t?: string; tv?: string; bar?: string; sub?: string; audio?: string; o?: string; n?: string }>();
  // Cast to this TV from a phone or browser (Cast Connect): their subtitle and audio track. Each cast
  // (n) starts the player again, also for the title that plays (the sender jumped or chose other audio).
  const given = castGiven({ sub, audio, o });
  const { api, t, serverUrl } = useSession();
  const [castActive, setCastActive] = useState(false);

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
        const e = await api.get<{ id: number; showTitle: string; seasonNumber: number; episodeNumber: number; title: string | null; stillPath?: string | null; showBackdropPath?: string | null; showPosterPath?: string | null; files: { id: number }[]; progress: Item['progress']; next: NextEpisode | null; segments?: EpisodeSegments | null }>(`/api/episodes/${id}`);
        if (!e.files[0]) throw new Error(t('player.cannotPlay'));
        return { kind: 'episode', id: e.id, fileId: e.files[0].id, title: e.showTitle, subtitle: [episodeCode(e.seasonNumber, e.episodeNumber), e.title].filter(Boolean).join(' · '), artwork: e.stillPath ?? e.showBackdropPath ?? null, poster: e.showPosterPath ?? null, progress: e.progress, next: e.next, segments: e.segments ?? null };
      }
      const m = await api.get<{ id: number; title: string; year: number | null; backdropPath?: string | null; posterPath?: string | null; files: { id: number }[]; progress: Item['progress'] }>(`/api/movies/${id}`);
      if (!m.files[0]) throw new Error(t('player.cannotPlay'));
      return { kind: 'movie', id: m.id, fileId: m.files[0].id, title: m.title, subtitle: m.year ? String(m.year) : null, artwork: m.backdropPath ?? m.posterPath ?? null, poster: m.posterPath ?? null, progress: m.progress, next: null, segments: null };
    },
  });
  const prefs = useQuery({ queryKey: [serverUrl, 'account-prefs'], queryFn: () => api.get<Prefs>('/api/account/preferences') });

  // Landscape without the navigation bar while watching (a swipe from the edge shows it briefly);
  // back to the app's own orientation when the last player closes.
  useEffect(() => {
    // Already casting: open as the TV's remote (upright), not as a video first.
    playerScreenState.enter(castStatus() === 'connected');
    return () => playerScreenState.leave();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar hidden={!castActive} />
      {item.error ? (
        <Problem message={errorMessage(item.error, t)} />
      ) : item.data && subtitlePreferencesReady(prefs) ? (
        <Playback key={`${item.data.kind}-${item.data.id}-${n ?? ''}`} item={item.data} prefs={prefs.data ?? null} startAt={startParam !== undefined ? Number(startParam) : null} onTv={tvParam === '1'} fromBar={bar === '1'} given={given} onCastingChange={setCastActive} />
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

function Playback({ item, prefs, startAt, onTv, fromBar, given, onCastingChange }: { item: Item; prefs: Prefs | null; startAt: number | null; /** Opened because the TV started this title itself: it plays there already. */ onTv: boolean; /** Opened from the cast bar: the screen slides up from it (and down when closed). */ fromBar: boolean; /** The subtitle and audio a cast to this TV came with. */ given: ReturnType<typeof castGiven>; onCastingChange: (active: boolean) => void }) {
  const { api, t, serverUrl, language, cloudServerId, user } = useSession();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.keepScreenOnWhilePlaying = true;
  });

  const [answer, setAnswer] = useState<PlaybackAnswer | null>(null);
  const [mediaEndpoint, setMediaEndpoint] = useState<{ baseUrl: string; token: string } | null>(null);
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
  /** Subtitles fetched online during this playback (the server lists them too from the next time). */
  const [fetchedSubs, setFetchedSubs] = useState<SubtitleOption[]>([]);
  const subtitleOptions = [...(answer?.subtitles ?? []), ...fetchedSubs.filter((f) => !answer?.subtitles.some((s) => s.key === f.key))];
  const [cues, setCues] = useState<Cue[]>([]);
  /** How subtitles look (kept on this device) and their timing for this playback (+ is later). */
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const styleRef = useRef(subStyle);
  styleRef.current = subStyle;
  const [castStyleFallback, setCastStyleFallback] = useState(false);
  const [subDelay, setSubDelay] = useState(0);
  const [screenHeight, setScreenHeight] = useState(360);
  const [styleSaveFailed, setStyleSaveFailed] = useState(false);
  const styleAlive = useRef(true);
  const styleConnection = useRef({ api, serverUrl, cloudServerId, userId: user?.id ?? null });
  styleConnection.current = { api, serverUrl, cloudServerId, userId: user?.id ?? null };
  const styleSync = useRef<ReturnType<typeof createSubtitleStyleSync> | null>(null);
  if (!styleSync.current) {
    const scope = subtitleStyleAccountScope(styleConnection.current);
    styleSync.current = createSubtitleStyleSync({
      scope,
      readDevice: storedSubtitleStyle,
      writeDevice: storeSubtitleStyle,
      writeAccount: (style) => styleConnection.current.api.put('/api/account/preferences', { subtitleStyle: style }),
      change: (style) => {
        styleRef.current = style;
        setSubStyle(style);
        setStyleSaveFailed(false);
      },
      saved: (style) => {
        setStyleSaveFailed(false);
        qc.setQueryData<Prefs>([styleConnection.current.serverUrl, 'account-prefs'], (current) => current ? { ...current, subtitleStyle: style } : current);
      },
      failed: () => setStyleSaveFailed(true),
      active: () => styleAlive.current && subtitleStyleAccountScope(styleConnection.current) === scope,
    });
  }
  useEffect(() => {
    styleAlive.current = true;
    void styleSync.current!.load(prefs?.subtitleStyle ?? null).catch(() => undefined);
    return () => {
      styleAlive.current = false;
    };
    // Account/device priority is decided once; edits win over delayed reads during playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeStyle = (patch: Partial<SubtitleStyle>) => {
    const next = editSubtitleStyle(styleRef.current, patch);
    void styleSync.current!.save(next).catch(() => {
      if (styleAlive.current) setStyleSaveFailed(true);
    });
  };
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [nextDismissed, setNextDismissed] = useState(false);
  /** Quick taps back/forward add up ("+30"); the step is kept on this device. */
  const [seekFlash, setSeekFlash] = useState<{ side: 'back' | 'forward'; total: number; at: number } | null>(null);
  const [seekStep, setSeekStep] = useState<SeekStep>(10);
  const seekRun = useRef<PendingSeek | null>(null);
  useEffect(() => {
    let alive = true;
    void storedSeekStep().then((s) => alive && setSeekStep(s));
    return () => {
      alive = false;
    };
  }, []);
  const pendingSeek = useRef<number | null>(null);
  const tracksSet = useRef(false);
  /** A stream is loaded and ready (the player exists before that, without a video). */
  const streamReady = useRef(false);
  const lastSave = useRef(0);
  /** The video really played here (or on the TV): before that, the position is not known and is never saved. */
  const begun = useRef(false);
  /** Counts loads: a seek that started later wins, whichever stream answer comes back first. */
  const loads = useRef(0);
  /** The caps of the current stream; after a failed first try, the safer second-try caps. */
  const capsRef = useRef<PlaybackCaps>(playbackCaps(deviceDecoders()));
  const triedFallback = useRef(false);
  const autoSkipped = useRef(new Set<string>());
  /** The last skip, so its button does not come back while the stream lands just before where it went. */
  const doneSkip = useRef<DoneSkip | null>(null);

  const duration = answer?.file.durationSec ?? answer?.decision.durationSec ?? 0;
  const position = offset + time;

  /** Loads the stream (again) for `at` seconds into the file. */
  const load = useCallback(
    async (a: PlaybackAnswer, at: number, autoplay = true) => {
      // Playing on a Chromecast: the phone stays quiet.
      if (castingRef.current) return;
      const loadId = ++loads.current;
      setLoading(true);
      const s = await streamFrom(api, a, at);
      if (loadId !== loads.current) return;
      setMediaEndpoint(s.mediaBase && s.mediaToken ? { baseUrl: s.mediaBase, token: s.mediaToken } : null);
      setOffset(s.offset);
      setTime(Math.max(0, at - s.offset));
      // Direct play starts at 0 and seeks once the file is open; a remux stream already starts there.
      pendingSeek.current = a.decision.seek === 'range' && at > 0 ? at : null;
      tracksSet.current = false;
      streamReady.current = false;
      setEnded(false);
      await player.replaceAsync({ uri: s.uri, headers: s.mediaToken ? {} : api.headers(), metadata: { title: item.title, artist: item.subtitle ?? undefined } });
      if (loadId !== loads.current) return;
      if (autoplay && !castingRef.current) player.play();
      else setLoading(false);
    },
    [api, player, item.title, item.subtitle],
  );

  // ---------------------------------------------------------------- casting
  // A Chromecast picked with the cast button: the video continues there (the Chromecast fetches
  // it itself with a short-lived token for this file) and this player becomes its remote control.
  const client = useRemoteMediaClient();
  const clientRef = useRef(client);
  clientRef.current = client;
  const mounted = useRef(true);
  const castLoadId = useRef(0);
  const castLoading = useRef(false);
  const styleQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; castLoadId.current++; };
  }, []);
  const castDevice = useCastDevice();
  const mediaStatus = useMediaStatus();
  // The file Vidalune's TV player says it plays (null: unknown, or another receiver).
  const tvFile = useRef<number | null>(null);
  tvFile.current = tvMedia(mediaStatus?.mediaInfo)?.fileId ?? null;
  // A subtitle chosen here, until the TV reports it.
  const subtitleSent = useRef<{ key: string | null; until: number } | null>(null);
  // The TV's position (file time) while casting, as last reported; saved when casting ends.
  const tvPosition = useRef<number | null>(null);
  const onTvProgress = useRef<(streamSec: number) => void>(() => undefined);
  // Where the TV was last asked to start (in the file), and whether it got there.
  const tvStartedAt = useRef(0);
  const tvSettled = useRef(false);
  // The TV reports its position through the Cast SDK's own progress listener. It runs natively, so it
  // keeps coming while the app is in the background (phone locked, another app open), when JavaScript
  // timers and effects wait; the position is therefore saved straight from it (see below).
  useEffect(() => {
    if (!client) return;
    void client
      .getStreamPosition()
      .then((p) => p !== null && onTvProgress.current(p))
      .catch(() => undefined);
    const subscription = client.onMediaProgressUpdated((p) => onTvProgress.current(p), 0.5);
    return () => subscription.remove();
  }, [client]);
  const [casting, setCasting] = useState(false);
  const castingRef = useRef(false);
  // A Chromecast already connected when the title opens: the remote shows at once, and nothing
  // plays on the phone while the TV is being given the title.
  const castNow = useCastStatus();
  const remote = casting || castNow === 'connected';
  useEffect(() => { onCastingChange(remote); }, [remote, onCastingChange]);
  useEffect(() => {
    if (remote) castRemoteOrientation();
    else playbackOrientation();
  }, [remote]);
  // Where this playback is meant to start (the resume point), for a TV that takes over before the phone played.
  const wantedStart = useRef<number | null>(null);
  // The phone did not load the video because a Chromecast was connected.
  const localSkipped = useRef(false);
  const castSession = useRef<{ session: CastSession; audio: number | null } | null>(null);
  const [castPreparing, setCastPreparing] = useState(false);
  const subtitleRef = useRef<SubtitleOption | null>(null);
  subtitleRef.current = subtitle;

  const castFailed = useCallback(
    (err: unknown, stop = true) => {
      if (!mounted.current) return;
      Alert.alert(t('player.castFailed'), castLoadFailed(err) ? t('player.castTvFailed') : errorMessage(err, t));
      if (stop) void CastContext.getSessionManager().endCurrentSession(true).catch(() => undefined);
    },
    [t],
  );
  const applyCastStyle = useCallback(() => {
    const target = client;
    const active = () => mounted.current && target !== null && target === clientRef.current && castingRef.current && !castLoading.current;
    const pending = styleQueue.current.catch(() => undefined).then(async () => {
      if (!target || !active()) return;
      const fallback = await applyCastTextTrackStyle({
        style: () => styleRef.current,
        apply: (style) => target.setTextTrackStyle(style),
        active,
        fallback: (error) => castFailed(new Error(`${t('subtitleStyle.castFallback')}\n${errorMessage(error, t)}`), false),
      });
      if (active() && fallback !== null) setCastStyleFallback(fallback);
    });
    styleQueue.current = pending;
    return pending;
  }, [client, castFailed, t]);

  /** Loads the file on the Chromecast from `at` seconds (for an audio track). */
  const castLoad = useCallback(
    async (at: number, audio: number | null) => {
      if (!client) return;
      const loadId = ++castLoadId.current;
      const active = () => mounted.current && clientRef.current === client && castLoadId.current === loadId && castingRef.current;
      castLoading.current = true;
      try {
        setLoading(true);
        let s = castSession.current;
        if (!s || !sessionUsable(s.session, audio, s.audio)) {
          const session = await api.post<CastSession>('/api/cast/session', { fileId: item.fileId, ...(audio !== null ? { audioIndex: audio } : {}), ...(answer?.file.id === item.fileId && answer.decision.optimized ? { optimizationId: answer.decision.optimized.id } : {}) });
          if (!active()) return;
          s = castSession.current = { session, audio };
        }
        if (s.session.preparing) {
          // A large file is read once before the TV can have it; without waiting the TV gives up (2100).
          setCastPreparing(true);
          try {
            const optimized = s.session.decision.optimized ? `&optimizationId=${s.session.decision.optimized.id}` : '';
            if (!(await waitForCastReady({ ask: () => api.get(`/api/cast/ready?fileId=${item.fileId}${optimized}`), active, unreadable: t('player.castUnreadable') }))) return;
            s.session.preparing = false;
          } finally {
            if (mounted.current) setCastPreparing(false);
          }
        }
        if (!s.session.serverUrl) throw new Error(t('player.noDirectEndpoint'));
        // A repackaged stream starts at the keyframe before `at`.
        const keyframe = s.session.decision.seek === 'restart' && at > 0 ? await api.get<{ start: number; seek: number }>(`/api/media/${item.fileId}/keyframe?t=${at.toFixed(3)}${s.session.decision.optimized ? `&optimized=${s.session.decision.optimized.id}` : ''}`).then((r) => ({ offset: r.start, seek: r.seek })) : null;
        if (!active()) return;
        // Load the safe TV preset first; unsupported custom styling must not prevent playback.
        const { request, offset: from } = castLoadRequest({ session: s.session, url: (path) => new URL(path, `${s!.session.serverUrl}/`).toString(), title: item.title, subtitle: item.subtitle, artwork: imagePath(item.poster ?? item.artwork, 'w780'), at, keyframe, subtitleKey: subtitleRef.current?.key ?? null, fileId: item.fileId, audioIndex: audio, item: { kind: item.kind, id: item.id } });
        setOffset(from);
        setTime(Math.max(0, at - from));
        tvStartedAt.current = at;
        tvSettled.current = false;
        setEnded(false);
        subtitleSent.current = { key: subtitleRef.current?.key ?? null, until: Date.now() + 5000 };
        await loadCastWithCurrentSubtitle({ request, session: s.session, subtitleKey: () => subtitleRef.current?.key ?? null, load: (media) => client.loadMedia(media), select: (ids) => client.setActiveTrackIds(ids), active });
        if (active()) {
          castLoading.current = false;
          await applyCastStyle().catch((error) => castFailed(error, false));
        }
      } catch (error) {
        if (active()) throw error;
      } finally {
        if (castLoadId.current === loadId) castLoading.current = false;
      }
    },
    [api, client, item.fileId, item.title, item.subtitle, item.artwork, item.poster, answer, t, applyCastStyle, castFailed],
  );
  const attachTv = useRef(onTv);
  /** The TV plays this title already (it started it itself): this screen becomes its remote without loading it again. */
  const castAttach = useCallback(
    async (audio: number | null) => {
      if (!client) return;
      setOffset(0);
      tvStartedAt.current = 0;
      tvSettled.current = true;
      setEnded(false);
      // For its subtitles (the TV numbers them in the same order) and later changes.
      const session = await api.post<CastSession>('/api/cast/session', { fileId: item.fileId });
      if (mounted.current) castSession.current = { session, audio };
    },
    [api, client, item.fileId],
  );
  useEffect(() => {
    setCastStyleFallback(false);
    if (casting && client && !castLoading.current) void applyCastStyle().catch((error) => castFailed(error, false));
  }, [subStyle, casting, client, applyCastStyle, castFailed]);

  /** Asks the server how to play the file on this device (for an audio track), then plays from `at`. */
  const decide = useCallback(
    async (at: number, wantedAudio?: number) => {
      try {
        if (castingRef.current && wantedAudio !== undefined) {
          setAudioIndex(wantedAudio);
          await castLoad(at, wantedAudio);
          return;
        }
        const caps = { ...capsRef.current, ...(wantedAudio !== undefined ? { audioIndex: wantedAudio } : {}), ...(answer?.file.id === item.fileId && answer.decision.optimized ? { optimizationId: answer.decision.optimized.id } : {}) };
        let a = await api.post<PlaybackAnswer>(`/api/media/${item.fileId}/playback`, caps);
        if (wantedAudio === undefined && a.analysis.mode !== 'unsupported') {
          // The audio language chosen last (on this device, else the account's), when this file has it.
          const language = (await rememberedAudio()) ?? prefs?.audioLanguage ?? null;
          const audio = preferredAudio(a.file.audioTracks, language, a.decision.audioIndex);
          if (audio !== undefined) a = await api.post<PlaybackAnswer>(`/api/media/${item.fileId}/playback`, { ...caps, audioIndex: audio });
        }
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
        wantedStart.current = at;
        // Casting already: the TV gets it (below), the phone does not play it too.
        if (!castingRef.current && castStatus() === 'connected') {
          localSkipped.current = true;
          return;
        }
        await load(a, at);
      } catch (err) {
        setProblem(errorMessage(err, t));
      }
    },
    [api, item.fileId, answer, load, castLoad, player, t, prefs?.audioLanguage],
  );

  // Start: resume where the viewer stopped (unless asked to start elsewhere).
  useEffect(() => {
    void decide(startAt ?? resumePoint(item.progress) ?? 0, given.audioIndex);
    // Once per item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The subtitle the account asks for (or the last choice on this device), once the list is known.
  const subtitlePicked = useRef(false);
  useEffect(() => {
    if (!answer || subtitlePicked.current) return;
    subtitlePicked.current = true;
    // The one a phone or browser showed when it cast this title to the TV.
    if (given.subtitleKey !== undefined) {
      const sent = given.subtitleKey === null ? null : answer.subtitles.find((o) => o.key === given.subtitleKey);
      if (sent !== undefined) return setSubtitle(sent);
    }
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
  // A subtitle inside the file is read by the server first (minutes on a NAS): "Loading subtitle…"
  // once it takes a moment, and a message when it could not be loaded, instead of nothing at all.
  const [subLoad, setSubLoad] = useState<'loading' | 'error' | null>(null);
  useEffect(() => {
    setCues([]);
    setSubLoad(null);
    if (!subtitle) return;
    let alive = true;
    const slow = setTimeout(() => alive && setSubLoad('loading'), SUBTITLE_LOADING_AFTER_MS);
    let gone: ReturnType<typeof setTimeout> | undefined;
    fetch(subtitleUrl(api, subtitle, 0, mediaEndpoint ?? undefined), { headers: mediaEndpoint ? {} : api.headers() })
      .then(cuesFrom)
      .then((list) => {
        if (!alive) return;
        setCues(list);
        setSubLoad(null);
      })
      .catch(() => {
        if (!alive) return;
        setSubLoad('error');
        gone = setTimeout(() => alive && setSubLoad(null), SUBTITLE_ERROR_FOR_MS);
      })
      .finally(() => clearTimeout(slow));
    return () => {
      alive = false;
      clearTimeout(slow);
      clearTimeout(gone);
    };
  }, [subtitle, api, mediaEndpoint]);

  // The subtitle line now, read from the player several times a second: its time events come every 0.5 s,
  // which shows a line up to half a second late. Only a new line draws the screen again.
  const [cueText, setCueText] = useState('');
  useEffect(() => {
    setCueText('');
    if (casting || !cues.length) return;
    const tick = () => {
      const now = cueTextAt(cues, offset + player.currentTime - subDelay);
      setCueText((old) => (old === now ? old : now));
    };
    tick();
    const timer = setInterval(tick, 120);
    return () => clearInterval(timer);
  }, [player, cues, offset, subDelay, casting]);

  const lastTime = useRef(0);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (castingRef.current) return;
    // Playing on: the spinner goes, also when the player's status did not say so (some devices).
    setLoading((l) => stillLoading(l, lastTime.current, currentTime, player.playing));
    lastTime.current = currentTime;
    setTime(currentTime);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => !castingRef.current && setPlaying(isPlaying));
  useEventListener(player, 'statusChange', ({ status, error }) => {
    if (castingRef.current) return;
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
    void load(answer, at).catch((err: unknown) => setProblem(errorMessage(err, t)));
    return true;
  };
  useEventListener(player, 'playToEnd', () => {
    if (castingRef.current) return;
    const kind = answer ? endOfStream(streamReady.current, position, duration) : 'ignore';
    if (kind === 'ignore') return;
    if (kind === 'resume') {
      if (continueAt(position)) return;
      void save(position, true);
      setProblem(t('player.interrupted'));
      return;
    }
    finished();
  });
  /** Played to the end (on the phone or the TV). */
  const finished = () => {
    void save(duration, true);
    setEnded(true);
    setControls(true);
    // While casting, Vidalune's TV player counts down and starts the next episode itself.
    if (item.next && !nextDismissed && countdown === null && !castingRef.current) setCountdown(NEXT_COUNTDOWN);
  };

  // Connected to a Chromecast: continue there from here (also when the next episode opens while
  // casting). Disconnected: back on the phone where the TV was, paused.
  useEffect(() => {
    if (client && answer && !castingRef.current) {
      castingRef.current = true;
      setCasting(true);
      player.pause();
      localSkipped.current = false;
      // Opened because the TV started this title itself: once, when the TV is (still) on it.
      const attach = attachTv.current && (tvFile.current === null || tvFile.current === item.fileId);
      attachTv.current = false;
      if (attach) void castAttach(audioIndex).catch(() => undefined);
      else void castLoad(castStartAt(position, wantedStart.current), audioIndex).catch(castFailed);
    } else if (!client && castingRef.current) {
      castingRef.current = false;
      // Where the TV was (also when casting was stopped on the TV or while the app was away).
      const at = tvPosition.current ?? position;
      tvPosition.current = null;
      void save(at, true);
      setCasting(false);
      setPlaying(false);
      if (answer && !ended) void load(answer, at, false).catch((err: unknown) => setProblem(errorMessage(err, t)));
    }
    // On connecting and disconnecting only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, answer !== null]);
  // The Chromecast went away before it got the title: play it on the phone after all.
  useEffect(() => {
    if (castNow === 'connected' || castingRef.current || !localSkipped.current || !answer) return;
    localSkipped.current = false;
    void load(answer, wantedStart.current ?? 0).catch((err: unknown) => setProblem(errorMessage(err, t)));
    // When the connection status changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castNow]);
  // The TV's playing state and end (its position comes from onTvProgress below).
  const castState = mediaStatus?.playerState ?? null;
  const castIdle = mediaStatus?.idleReason ?? null;
  useEffect(() => {
    if (!casting || castState === null) return;
    setPlaying(castState === MediaPlayerState.PLAYING);
    setLoading(castState === MediaPlayerState.LOADING || castState === MediaPlayerState.BUFFERING);
    if (castState === MediaPlayerState.IDLE && castIdle === MediaPlayerIdleReason.FINISHED && !ended) finished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting, castState, castIdle]);
  // Another subtitle picked while casting: shown on the TV.
  useEffect(() => {
    if (!casting || !client) return;
    if (tvSubtitleKey(mediaStatus?.activeTrackIds, castSession.current?.session ?? null) === (subtitle?.key ?? null)) return;
    subtitleSent.current = { key: subtitle?.key ?? null, until: Date.now() + 5000 };
    void client.setActiveTrackIds(castTrackIds(castSession.current?.session ?? null, subtitle?.key ?? null)).catch(() => undefined);
    // When the choice here changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting, client, subtitle]);
  // A subtitle chosen on the TV (its remote): shown here and remembered, as if chosen here. Its first
  // report for a title is what it was given, not a choice (see tvChanged). "Off" from the TV is not
  // taken: Google's framework reports it when it loses the track (loading, a seek).
  const tvSeen = useRef<TvSeen | null>(null);
  useEffect(() => {
    if (!casting || !answer || castLoading.current || tvFile.current !== item.fileId) return;
    const key = tvSubtitleKey(mediaStatus?.activeTrackIds, castSession.current?.session ?? null);
    const sent = subtitleSent.current;
    if (key === undefined || (sent && key !== sent.key && Date.now() < sent.until)) return;
    if (!tvChanged(tvSeen, item.fileId, 'subtitle', key)) return;
    subtitleSent.current = null;
    if (key === null || key === (subtitleRef.current?.key ?? null)) return;
    const option = answer.subtitles.find((o) => o.key === key);
    if (!option) return;
    setSubtitle(option);
    void rememberSubtitle(choiceFor(option));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting, mediaStatus?.activeTrackIds, answer]);
  // The TV started another title itself (the next episode): this screen follows it.
  const lastTvFile = useRef<number | null>(null);
  useEffect(() => {
    const tv = tvMedia(mediaStatus?.mediaInfo);
    const before = lastTvFile.current;
    if (tv) lastTvFile.current = tv.fileId;
    const next = casting && !castLoading.current ? followTv(before, tv, item.fileId) : null;
    if (next) router.replace(`/play/${next.kind}/${next.id}?tv=1`);
    // An audio track chosen on the TV (its menu) is remembered for the next title too.
    else if (casting && tv?.fileId === item.fileId && tv.audioIndex !== null && tvChanged(tvSeen, item.fileId, 'audio', tv.audioIndex) && tv.audioIndex !== audioIndex) {
      const track = answer?.file.audioTracks.find((x) => x.index === tv.audioIndex);
      if (track) void rememberAudio(track.language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting, mediaStatus?.mediaInfo]);

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
    if (!playing || casting) return;
    begun.current = true;
    void save(position);
  }, [playing, casting, position, save]);
  // While casting: shown and saved straight from the TV's progress reports (every 10 s at most), so it
  // also happens while the app is in the background.
  onTvProgress.current = (streamSec) => {
    if (!castingRef.current) return;
    const at = tvFilePosition(offset, streamSec);
    // The TV is on another file (it started the next episode itself, and saves that one).
    if (at === null || (tvFile.current !== null && tvFile.current !== item.fileId)) return;
    // Not before the TV got to the resume point: it keeps its resume point otherwise.
    tvSettled.current = castSettled(tvSettled.current, at, tvStartedAt.current);
    if (!tvSettled.current) return;
    tvPosition.current = at;
    begun.current = true;
    setTime(streamSec);
    void save(at);
  };
  // The last known position, for saving when leaving (the native player may be gone by then).
  const saveRef = useRef<() => unknown>(() => undefined);
  // Opened and left (or paused) before anything played: the saved resume point stays as it was.
  saveRef.current = () => (begun.current ? save(position, true) : undefined);
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
  const modes = { recap: prefs?.skipRecap ?? prefs?.skipIntro ?? 'ask', intro: prefs?.skipIntro ?? 'ask', credits: prefs?.skipCredits ?? 'ask' };
  const skip = answer && !loading ? skipAt(item.segments, item.fileId, position, modes) : null;
  // Skipped automatically once, then watched again (seeked back into it): offer the button instead.
  const askSkip = skip && !justSkipped(skip, doneSkip.current, position) && (skip.mode === 'ask' || autoSkipped.current.has(skip.kind)) ? skip : null;
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
    if (nearEnd && playing && reachedEnd.current && !castingRef.current) setCountdown((c) => c ?? NEXT_COUNTDOWN);
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
  // On a TV the row of buttons goes with them; an open menu stays.
  const [tv, setTv] = useState(initialTvState);
  useEffect(() => {
    if (!controls || !playing || menu || tv.open === 'menu' || scrub !== null) return;
    const timer = setTimeout(() => {
      setControls(false);
      setTv((s) => (s.open === 'bar' ? { ...s, open: 'none' } : s));
    }, TV ? TV_CONTROLS_MS : HIDE_CONTROLS_MS);
    return () => clearTimeout(timer);
  }, [controls, playing, menu, tv.open, scrub, touched]);

  const seekTo = useCallback(
    (target: number) => {
      if (!answer) return;
      const tt = Math.max(0, Math.min(Math.max(0, duration - 1), target));
      // A seek of the viewer's own: a part skipped before may be offered again.
      doneSkip.current = null;
      setEnded(false);
      setTouched((n) => n + 1);
      if (castingRef.current) {
        // A repackaged stream is loaded again from there; a file as it is seeks on the TV.
        if (castSession.current?.session.decision.seek === 'restart') void castLoad(tt, castSession.current.audio).catch(castFailed);
        else {
          void client?.seek({ position: tt, resumeState: 'play' });
          setTime(tt);
        }
        return;
      }
      if (answer.decision.seek === 'restart') void load(answer, tt);
      else {
        player.currentTime = tt;
        // Show the new position straight away instead of after the next time update.
        setTime(tt);
      }
    },
    [answer, duration, load, player, client, castLoad, castFailed],
  );

  // ---------------------------------------------------------------- Cast Connect (on a TV)
  // A phone or browser cast to this TV: they see what plays here and control it (CastConnect.kt
  // ignores all this until a sender cast to the TV).
  const castKeys = castSubtitleKeys(answer?.subtitles ?? []);
  useEffect(() => {
    if (!TV || !CastReceiver || !answer) return;
    const tracks = castKeys.map((key, i) => {
      const option = answer.subtitles.find((o) => o.key === key)!;
      return { id: i + 1, name: option.label, language: option.language ?? null };
    });
    // No artwork: the server's images need its sign-in, which senders do not have.
    void CastReceiver.castMedia(item.title, item.subtitle, null, Math.max(0, duration - given.offset), castConnectData(item, audioIndex), tracks).catch(() => undefined);
    // When the title, its subtitles or the audio track change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, audioIndex]);
  const castTick = Math.floor(position / 5);
  useEffect(() => {
    if (!TV || !CastReceiver || !answer) return;
    void CastReceiver.castStatus(castPlayerState({ playing, loading }), Math.max(0, position - given.offset), castTrackIdsFor(subtitle?.key ?? null, castKeys)).catch(() => undefined);
    // On a change of state or subtitle, and every 5 s of playing (senders count on from the state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, playing, loading, castTick, subtitle?.key]);
  const castAt = useRef(0);
  castAt.current = position;
  useEffect(() => () => void CastReceiver?.castStatus('idle', Math.max(0, castAt.current - given.offset), []).catch(() => undefined), []);
  const onCastCommand = useRef<(c: CastCommand) => void>(() => undefined);
  onCastCommand.current = (c) => {
    if (c.type === 'play') player.play();
    else if (c.type === 'pause') player.pause();
    else if (c.type === 'seek') seekTo(c.position + given.offset);
    else if (c.type === 'stop') router.back();
    else if (c.type === 'subtitle') {
      const key = castSubtitleFor(c.trackId, castKeys);
      if (key === undefined) return;
      const option = key === null ? null : subtitleOptions.find((o) => o.key === key) ?? null;
      if (key !== null && !option) return;
      // A choice made on the phone or browser: remembered here too.
      setSubtitle(option);
      void rememberSubtitle(choiceFor(option));
    }
  };
  useEffect(() => {
    if (!TV || !CastReceiver) return;
    const sub = CastReceiver.addListener('onCastCommand', (c) => onCastCommand.current(c));
    return () => sub.remove();
  }, []);

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
    doneSkip.current = { kind: skip.kind, to: skip.to };
  }, [skip, item.next, goNext, seekTo, position]);

  const toggle = () => {
    poke();
    if (castingRef.current) {
      if (ended) seekTo(0);
      else if (playing) void client?.pause();
      else void client?.play();
      return;
    }
    if (ended) {
      seekTo(0);
      player.play();
    } else if (playing) player.pause();
    else player.play();
  };

  /** Back or forward by the step; quick taps add up from where the previous one aimed. */
  const seekBy = (side: 'back' | 'forward') => {
    const p = addSeek(seekRun.current, Date.now(), position, side === 'back' ? -seekStep : seekStep, duration);
    seekRun.current = p;
    seekTo(p.target);
    setSeekFlash({ side, total: p.total, at: p.at });
  };

  // A tap shows or hides the controls; a double tap on the left or right third seeks by the step
  // (every further tap there adds another step).
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
        seekBy(side);
        return;
      }
    }
    setControls((c) => !c);
  };
  const screenWidth = useRef(0);
  useEffect(() => {
    if (!seekFlash) return;
    const timer = setTimeout(() => setSeekFlash(null), SEEK_COMBINE_MS);
    return () => clearTimeout(timer);
  }, [seekFlash]);

  const audioTracks = answer?.file.audioTracks ?? [];
  const showNext = Boolean(item.next && countdown !== null && !nextDismissed);
  /** Another audio track picked (menu or TV remote): remembered for the next title too. */
  const chooseAudio = (index: number) => {
    const track = audioTracks.find((a) => a.index === index);
    if (track) void rememberAudio(track.language);
    if (index !== audioIndex) void decide(position, index);
  };
  const skipNow = () => {
    if (!askSkip) return;
    if (askSkip.kind === 'credits' && askSkip.toNext && item.next) goNext();
    else {
      seekTo(askSkip.to);
      doneSkip.current = { kind: askSkip.kind, to: askSkip.to };
    }
  };

  // ---------------------------------------------------------------- TV remote
  // On Android TV / Google TV the remote drives the player (lib/tvRemote.ts): RemoteKeys passes the
  // arrows, OK and media keys, Back comes through BackHandler.
  const tvContext: TvContext = {
    buttons: tvButtons({ audioTracks: audioTracks.length, hasNext: Boolean(item.next) }),
    tabs: tvTabs({ audioTracks: audioTracks.length }),
    items: { subtitles: subtitleOptions.length + 1, audio: audioTracks.length },
    selected: { subtitles: subtitle ? subtitleOptions.findIndex((o) => o.key === subtitle.key) + 1 : 0, audio: Math.max(0, audioTracks.findIndex((a) => a.index === audioIndex)) },
    skip: Boolean(askSkip && !showNext),
    upNext: showNext,
  };
  const onRemote = useRef<(key: RemoteKey) => boolean>(() => false);
  onRemote.current = (key) => {
    const r = pressKey(tv, key, tvContext);
    setTv(r.state);
    if (!r.handled) return false;
    poke();
    setControls(true);
    const a = r.action;
    if (a?.type === 'toggle') toggle();
    else if (a?.type === 'step') seekBy(a.side);
    else if (a?.type === 'seek') seekTo(position + a.by);
    else if (a?.type === 'skip') skipNow();
    else if (a?.type === 'next') goNext();
    else if (a?.type === 'exit') router.back();
    else if (a?.type === 'dismissNext') {
      setNextDismissed(true);
      setCountdown(null);
    } else if (a?.type === 'pick' && a.tab === 'subtitles') chooseSubtitle(a.index === 0 ? null : subtitleOptions[a.index - 1] ?? null);
    else if (a?.type === 'pick' && a.tab === 'audio') {
      const track = audioTracks[a.index];
      if (track) chooseAudio(track.index);
    }
    return true;
  };
  useEffect(() => {
    if (!TV) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => onRemote.current('back'));
    return () => sub.remove();
  }, []);
  // Leaving the player (Back, or after the last episode): the button or poster that opened it takes
  // the focus again, so the remote keeps working on the screen underneath.
  useEffect(() => () => {
    if (TV) tvFocus.restore();
  }, []);

  if (problem) return <Problem message={problem} />;

  // While casting the TV shows the subtitles.
  const text = cueText;
  // On a TV the subtitles go above the bar while it shows (it is taller than the phone's controls).
  const tvBarShown = TV && (controls || !playing || tv.open !== 'none');
  const subtitleAt = TV ? tvSubtitleBottom(subStyle, screenHeight, tvBarShown) : subtitleBottom(subStyle, screenHeight, controls);
  const subtitleView = text ? (
    <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: 24, bottom: subtitleAt + insets.bottom, alignItems: 'center' }}>
      <Text style={subtitleTextStyle(subStyle, screenHeight)}>{text}</Text>
    </View>
  ) : subLoad && !casting ? (
    <View pointerEvents="none" accessibilityRole="alert" style={{ position: 'absolute', left: 24, right: 24, bottom: subtitleAt + insets.bottom, alignItems: 'center' }}>
      <Text style={{ color: subLoad === 'error' ? '#ff9aa8' : '#fff', fontSize: TV ? 22 : 15, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, overflow: 'hidden', paddingHorizontal: TV ? 26 : 16, paddingVertical: TV ? 12 : 8 }}>
        {subLoad === 'error' ? t('player.subtitleFailed') : t('player.subtitleLoading')}
      </Text>
    </View>
  ) : null;
  const shown = scrub ?? position;
  return (
    <View style={{ flex: 1 }} onLayout={(e) => {
        screenWidth.current = e.nativeEvent.layout.width;
        setScreenHeight(e.nativeEvent.layout.height);
      }}>
      <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" allowsPictureInPicture={false} />
      {remote && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Feather name="cast" size={48} color={colors.accent} />
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>{castDevice?.friendlyName ? t('player.castingTo', { device: castDevice.friendlyName }) : t('player.casting')}</Text>
          <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('player.castingHint')}</Text>
        </View>
      )}
      {!TV && subtitleView}
      {seekFlash && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, [seekFlash.side === 'back' ? 'left' : 'right']: 48, justifyContent: 'center' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', gap: 4 }}>
            <Feather name={seekFlash.side === 'back' ? 'rotate-ccw' : 'rotate-cw'} size={28} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{seekFlash.total > 0 ? `+${seekFlash.total}` : `−${Math.abs(seekFlash.total)}`}</Text>
          </View>
        </View>
      )}
      {TV ? (
        <>
          <RemoteKeys style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1 }} onKey={(e) => {
            // A held key repeats quickly: every third repeat counts (each jump may restart a converted stream).
            if (e.nativeEvent.repeat % 3 !== 0) return;
            const key = remoteKey(e.nativeEvent.keyCode);
            if (key) onRemote.current(key);
          }} />
          <TvPlayer
            title={item.title}
            subtitle={item.subtitle}
            position={position}
            duration={duration}
            playing={playing}
            loading={loading}
            ended={ended}
            visible={tvBarShown}
            overlayBottom={tvBarShown ? TV_BAR_HEIGHT + 16 : 48}
            state={tv}
            buttons={tvContext.buttons}
            tabs={tvContext.tabs}
            lines={{
              subtitles: [t('player.off'), ...subtitleOptions.map(subtitleLabel)],
              audio: audioTracks.map((a) => audioLabel(a, t)),
            }}
            selected={tvContext.selected}
            marks={segmentMarks(item.segments, item.fileId, duration)}
            seekStep={seekStep}
            skipLabel={askSkip ? skipLabel(askSkip.kind, t) : null}
            captions={subtitle ? subtitleLabel(subtitle) : null}
            upNext={showNext && item.next ? { label: `${episodeCode(item.next.seasonNumber, item.next.episodeNumber)}${item.next.title ? ` · ${item.next.title}` : ''}`, countdown: countdown ?? 0, ended } : null}
          />
          {/* Over the bar's shading, so they stay readable. */}
          {subtitleView}
        </>
      ) : (
      <Pressable accessibilityLabel={t('player.tracks')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onTap}>
        {controls && (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'space-between', paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconButton name="arrow-left" label={t('player.back')} onPress={() => router.back()} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? <Text style={{ color: colors.muted }} numberOfLines={1}>{item.subtitle}</Text> : null}
              </View>
              <CastIcon />
              <IconButton name="message-square" label={t('player.tracks')} onPress={() => setMenu(true)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40 }}>
              <IconButton name="rotate-ccw" label={t('player.backSeconds', { n: seekStep })} onPress={() => seekBy('back')} size={30} />
              {loading ? <ActivityIndicator color="#fff" size="large" /> : <IconButton name={playing ? 'pause' : ended ? 'rotate-cw' : 'play'} label={playing ? t('player.pause') : t('player.play')} onPress={toggle} size={44} />}
              <IconButton name="rotate-cw" label={t('player.forwardSeconds', { n: seekStep })} onPress={() => seekBy('forward')} size={30} />
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
      )}
      {remote && (
        <CastRemotePanel
          rise={fromBar}
          title={item.title}
          subtitle={item.subtitle}
          device={castDevice?.friendlyName ?? null}
          artwork={item.poster ?? item.artwork}
          position={position}
          duration={duration}
          playing={playing}
          starting={!casting || loading}
          preparing={castPreparing}
          volume={mediaStatus?.volume ?? 1}
          muted={mediaStatus?.isMuted ?? false}
          insets={insets}
          onSeek={seekTo}
          onTogglePlay={toggle}
          onOpenTracks={() => setMenu(true)}
          onStop={() => void CastContext.getSessionManager().endCurrentSession(true)}
          onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          onVolume={(value) => void client?.setStreamVolume(value).catch(() => undefined)}
          onToggleMute={() => void client?.setStreamMuted(!(mediaStatus?.isMuted ?? false)).catch(() => undefined)}
        />
      )}
      {/* Skip intro / credits: visible with or without the controls, above them. */}
      {askSkip && !showNext && !casting && !TV && (
        <View style={{ position: 'absolute', right: 24 + insets.right, bottom: (controls ? 110 : 32) + insets.bottom }}>
          <Button label={skipLabel(askSkip.kind, t)} onPress={skipNow} />
        </View>
      )}
      {showNext && item.next && !casting && !TV && (
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
      <Modal visible={menu && !TV} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setMenu(false)} supportedOrientations={['landscape', 'portrait']}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'flex-end' }} onPress={() => setMenu(false)} accessibilityLabel={t('player.close')}>
          <Pressable style={{ width: 320 + insets.right, maxWidth: '90%', height: '100%', backgroundColor: colors.surface, paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom, paddingLeft: 16, paddingRight: 16 + insets.right }} onPress={() => undefined}>
            <ScrollView contentContainerStyle={{ gap: 6 }}>
              <Text style={[styles.label, { marginBottom: 4 }]}>{t('player.audio')}</Text>
              {audioTracks.map((a) => (
                <Choice
                  key={a.index}
                  label={audioLabel(a, t)}
                  selected={a.index === audioIndex}
                  onPress={() => {
                    setMenu(false);
                    chooseAudio(a.index);
                  }}
                />
              ))}
              <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>{t('player.subtitles')}</Text>
              <Choice label={t('player.off')} selected={!subtitle} onPress={() => chooseSubtitle(null)} />
              {subtitleOptions.map((s) => (
                <Choice key={s.key} label={subtitleLabel(s)} selected={subtitle?.key === s.key} onPress={() => chooseSubtitle(s)} />
              ))}
              {answer?.onlineSubtitles ? (
                <OnlineSubtitles
                  fileId={answer.file.id}
                  defaultLanguage={defaultOnlineLanguage(prefs?.subtitleLanguage, prefs?.subtitleFallback, language)}
                  activeKey={subtitle?.key ?? null}
                  onChosen={(option) => {
                    setFetchedSubs((list) => (list.some((x) => x.key === option.key) ? list : [...list, option]));
                    chooseSubtitle(option);
                  }}
                />
              ) : null}
              {!casting && <>
              <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>{t('player.seekStep')}</Text>
              <Segmented
                label={t('player.seekStepHint')}
                value={String(seekStep)}
                onChange={(v) => {
                  const step = Number(v) as SeekStep;
                  setSeekStep(step);
                  void storeSeekStep(step);
                }}
                options={SEEK_STEPS.map((s) => [String(s), `${s} s`] as [string, string])}
              />
              </>}
              <Text style={[styles.label, { marginTop: 16, marginBottom: 4 }]}>{t('subtitleStyle.title')}</Text>
              {styleSaveFailed && <Text style={styles.muted}>{t('subtitleStyle.accountSaveFailed')}</Text>}
              <Segmented label={t('subtitleStyle.castMode')} value={subStyle.castDefaults ? 'default' : 'custom'} onChange={(v) => changeStyle({ castDefaults: v === 'default' })} options={[['default', t('subtitleStyle.tvDefault')], ['custom', t('subtitleStyle.custom')]]} />
              {casting && <Text style={styles.muted}>{t('subtitleStyle.castLimitations')}</Text>}
              {casting && castStyleFallback && <Text style={styles.muted}>{t('subtitleStyle.castFallback')}</Text>}
              <Text style={styles.label}>{t('subtitleStyle.preview')}</Text>
              <View style={{ minHeight: 88, alignItems: 'center', justifyContent: 'center', backgroundColor: '#182332', padding: 8, borderRadius: radius.md }}>
                <Text style={subtitleTextStyle(casting ? (castStyleFallback ? TV_SUBTITLE_STYLE : castSubtitlePreview(subStyle)) : subStyle, 220)}>{t('subtitleStyle.previewText')}</Text>
              </View>
              <Segmented label={t('subtitleStyle.size')} value={subStyle.size} onChange={(v) => changeStyle({ size: v })} options={[['small', 'S'], ['medium', 'M'], ['large', 'L'], ['xlarge', 'XL']]} />
              <Segmented label={t('subtitleStyle.color')} value={subStyle.color} onChange={(v) => changeStyle({ color: v })} options={[['white', t('subtitleStyle.white')], ['yellow', t('subtitleStyle.yellow')]]} />
              <Segmented label={t('subtitleStyle.background')} value={subStyle.background} onChange={(v) => changeStyle({ background: v })} options={[['none', t('subtitleStyle.none')], ['translucent', t('subtitleStyle.dimmed')], ['solid', t('subtitleStyle.solid')]]} />
              <Segmented label={t('subtitleStyle.edge')} value={subStyle.edge} onChange={(v) => changeStyle({ edge: v })} options={[['shadow', t('subtitleStyle.shadow')], ['outline', t('subtitleStyle.outline')], ['none', t('subtitleStyle.none')]]} />
              <Stepper
                label={t('subtitleStyle.position')}
                hint={t('subtitleStyle.castLimitations')}
                value={subStyle.position === 0 ? t('subtitleStyle.bottom') : `+${subStyle.position}%`}
                onMinus={() => changeStyle({ position: clampPosition(subStyle.position - 5) })}
                onPlus={() => changeStyle({ position: clampPosition(subStyle.position + 5) })}
              />
              {!casting && <Stepper
                label={t('subtitleStyle.sync')}
                hint={t('subtitleStyle.syncHint')}
                value={subDelay === 0 ? t('subtitleStyle.inSync') : `${subDelay > 0 ? '+' : ''}${subDelay.toFixed(1)} s`}
                onMinus={() => setSubDelay((d) => stepDelay(d, -1))}
                onPlus={() => setSubDelay((d) => stepDelay(d, 1))}
                onReset={subDelay !== 0 ? () => setSubDelay(0) : undefined}
              />}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** How long the cast remote takes to slide up or down. */
const REMOTE_SLIDE_MS = 360;

function CastRemotePanel({ rise, title, subtitle, device, artwork, position, duration, playing, starting, preparing, volume, muted, insets, onSeek, onTogglePlay, onOpenTracks, onStop, onClose, onVolume, onToggleMute }: {
  /** Opened from the cast bar: the screen itself slides up, and down again when closed. */
  rise: boolean;
  title: string;
  subtitle: string | null;
  device: string | null;
  artwork: string | null;
  position: number;
  duration: number;
  playing: boolean;
  /** The TV is being given the title: shown instead of play/pause. */
  starting: boolean;
  /** The server reads a large file once before the TV can have it. */
  preparing: boolean;
  volume: number;
  muted: boolean;
  insets: { top: number; bottom: number; left: number; right: number };
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onOpenTracks: () => void;
  onStop: () => void;
  /** Leaves the remote; casting goes on (the TV saves where it is itself). */
  onClose: () => void;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
}) {
  const { t } = useSession();
  // The remote slides down out of view before the screen closes (back to the cast bar): soft, slow
  // enough to follow. Opened from the bar, the whole screen slides up and back down itself.
  const [height, setHeight] = useState(800);
  const drop = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    if (rise) return onClose();
    Animated.timing(drop, { toValue: height, duration: REMOTE_SLIDE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => onClose());
  };
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const action = { minWidth: 76, minHeight: 60, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4, paddingHorizontal: 8, borderRadius: radius.md };
  return (
    <Animated.View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 100, elevation: 100, backgroundColor: colors.bg, paddingTop: 12 + insets.top, paddingBottom: 12 + insets.bottom, paddingLeft: 18 + insets.left, paddingRight: 18 + insets.right, transform: [{ translateY: drop }] }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
        <IconButton name="chevron-down" label={t('player.closeRemote')} onPress={close} />
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: colors.faint, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>{t('player.castRemote').toUpperCase()}</Text>
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{device ?? t('player.casting')}</Text>
        </View>
        <IconButton name="cast" label={t('player.stopCasting')} onPress={onStop} />
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 12 }}>
        <Artwork path={artwork} size="w780" label={title} style={{ width: 184, height: 276, borderRadius: radius.lg }} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ color: colors.ink, fontSize: 21, fontWeight: '800', textAlign: 'center' }} numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={{ color: colors.muted, fontSize: 14 }}>{subtitle}</Text> : null}
          {starting ? (
            <View accessibilityRole="progressbar" accessibilityLabel={preparing ? t('player.castPreparing') : t('player.castLoading')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, maxWidth: 340 }}>
              <ActivityIndicator color={colors.accent} />
              <Text style={{ color: colors.muted, textAlign: 'center', flexShrink: 1 }}>{preparing ? t('player.castPreparing') : t('player.castLoading')}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ width: '100%', maxWidth: 520, gap: 4 }}>
          <SeekBar position={position} duration={duration} onScrub={() => undefined} onSeek={onSeek} label={t('player.seek')} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.ink, fontSize: 12 }}>{formatClock(position)}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{formatClock(duration)}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('player.backSeconds', { n: 10 })} onPress={() => onSeek(Math.max(0, position - 10))} style={({ pressed }) => [{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: pressed ? colors.raised : 'transparent' }]}>
            <Feather name="rotate-ccw" size={25} color={colors.ink} /><Text style={{ position: 'absolute', color: colors.ink, fontSize: 9, fontWeight: '800' }}>10</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={playing ? t('player.pause') : t('player.play')} onPress={onTogglePlay} style={({ pressed }) => [{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center', borderRadius: 38, backgroundColor: pressed ? colors.raised : colors.ink }]}>
            <Feather name={playing ? 'pause' : 'play'} size={34} color={colors.bg} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('player.forwardSeconds', { n: 10 })} onPress={() => onSeek(Math.min(duration, position + 10))} style={({ pressed }) => [{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: pressed ? colors.raised : 'transparent' }]}>
            <Feather name="rotate-cw" size={25} color={colors.ink} /><Text style={{ position: 'absolute', color: colors.ink, fontSize: 9, fontWeight: '800' }}>10</Text>
          </Pressable>
        </View>
      </View>
      {volumeOpen && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 6 }}>
          <IconButton name={muted ? 'volume-x' : 'volume-2'} label={muted ? t('player.unmute') : t('player.volume')} onPress={onToggleMute} />
          <View style={{ flex: 1 }}><SeekBar position={muted ? 0 : volume} duration={1} onScrub={() => undefined} onSeek={onVolume} label={t('player.volume')} /></View>
        </View>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 5 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('player.volume')} onPress={() => setVolumeOpen((v) => !v)} style={action}><Feather name={muted ? 'volume-x' : 'volume-2'} size={21} color={colors.ink} /><Text style={{ color: colors.muted, fontSize: 11 }}>{t('player.volume')}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('player.audioSubtitles')} onPress={onOpenTracks} style={action}><Feather name="message-square" size={21} color={colors.ink} /><Text style={{ color: colors.muted, fontSize: 11 }}>{t('player.audioSubtitles')}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('player.more')} onPress={() => setMoreOpen(true)} style={action}><Feather name="more-horizontal" size={21} color={colors.ink} /><Text style={{ color: colors.muted, fontSize: 11 }}>{t('player.more')}</Text></Pressable>
      </View>
      <Modal visible={moreOpen} transparent statusBarTranslucent animationType="slide" onRequestClose={() => setMoreOpen(false)}>
        <Pressable onPress={() => setMoreOpen(false)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <Pressable onPress={() => undefined} style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 22, paddingBottom: 24 + insets.bottom, gap: 12 }}>
            <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>{t('player.more')}</Text>
            <Text style={{ color: colors.muted }}>{device ? t('player.castingTo', { device }) : t('player.casting')}</Text>
            <Pressable accessibilityRole="button" onPress={() => { setMoreOpen(false); onStop(); }} style={{ minHeight: 52, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.danger, paddingHorizontal: 16 }}>
              <Text style={{ color: colors.ink, fontWeight: '700', textAlign: 'center' }}>{t('player.stopCasting')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

type AudioTrack = PlaybackAnswer['file']['audioTracks'][number];
type Translate = ReturnType<typeof useSession>['t'];

function audioLabel(a: AudioTrack, t: Translate): string {
  return [a.title || a.languageName || a.language || `#${a.index}`, a.channels ? (a.channels === 6 ? '5.1' : a.channels === 8 ? '7.1' : a.channels === 2 ? 'Stereo' : t('player.channels', { n: a.channels })) : null, a.codec?.toUpperCase()].filter(Boolean).join(' · ');
}

function subtitleLabel(s: SubtitleOption): string {
  return [s.languageName || s.label, s.title && s.title !== s.languageName ? s.title : null, s.forced ? 'Forced' : null].filter(Boolean).join(' · ');
}

function skipLabel(kind: 'recap' | 'intro' | 'credits', t: Translate): string {
  return kind === 'recap' ? t('player.skipRecap') : kind === 'intro' ? t('player.skipIntro') : t('player.skipCredits');
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
