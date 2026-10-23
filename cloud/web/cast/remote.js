/**
 * Vidalune's TV player operated with a remote (receiver.js draws it): which key does what, what is
 * on screen, and when to offer skipping the intro or the next episode. The same choices as the
 * website's player (lib/player.ts), for a remote with arrows, OK and Back.
 */

/** How far ←/→ jump (seconds); fast-forward and rewind keys jump further. */
export const SEEK_STEP = 10;
export const FAST_STEP = 30;
/** How long the controls stay up without a key while playing. */
export const CONTROLS_FOR_MS = 6000;
/** How long the "Next episode" card counts down. */
export const NEXT_COUNTDOWN = 10;

/** A key from the remote (or a keyboard while testing), by what it means; null for others. */
export function keyOf(event) {
  const key = String(event?.key ?? '');
  const code = Number(event?.keyCode ?? 0);
  if (key === 'ArrowLeft' || code === 37 || code === 21) return 'left';
  if (key === 'ArrowRight' || code === 39 || code === 22) return 'right';
  if (key === 'ArrowUp' || code === 38 || code === 19) return 'up';
  if (key === 'ArrowDown' || code === 40 || code === 20) return 'down';
  if (key === 'Enter' || key === ' ' || key === 'Select' || code === 13 || code === 23) return 'ok';
  if (key === 'MediaPlayPause' || key === 'MediaPlay' || key === 'MediaPause' || code === 179 || code === 85 || code === 126 || code === 127) return 'playpause';
  if (key === 'MediaFastForward' || code === 228 || code === 90) return 'forward';
  if (key === 'MediaRewind' || code === 227 || code === 89) return 'rewind';
  if (key === 'Escape' || key === 'GoBack' || key === 'BrowserBack' || key === 'Backspace' || code === 27 || code === 4 || code === 8 || code === 461 || code === 10009) return 'back';
  return null;
}

/** The buttons in the row, in order: only those that do something for this title. */
export function controlsFor({ audioTracks = 0, hasNext = false } = {}) {
  return ['back', 'play', 'forward', 'subtitles', ...(audioTracks > 1 ? ['audio'] : []), ...(hasNext ? ['next'] : [])];
}

/** The menu's tabs: audio only when there is a choice. */
export function tabsFor({ audioTracks = 0 } = {}) {
  return ['subtitles', ...(audioTracks > 1 ? ['audio'] : []), 'style'];
}

export const initialState = () => ({ open: 'none', focus: 1, tab: 'subtitles', item: 0, nextFocus: 0 });

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * What a key does. `ctx`: the buttons (`controls`), the menu's tabs and how many items each has
 * (`tabs`, `items`), whether a skip or the "Next episode" card is offered (`skip`, `upNext`).
 * Returns the new state, what the player should do (or null), and whether the key was used: an unused
 * Back is left to the TV (it closes the app there).
 */
export function press(state, key, ctx) {
  const s = { ...state };
  const controls = ctx.controls ?? controlsFor();
  const tabs = ctx.tabs ?? tabsFor();
  const done = (action = null) => ({ state: s, action, handled: true });
  if (key === 'playpause') return done({ type: 'toggle' });
  if (key === 'forward' || key === 'rewind') return done({ type: 'seek', by: key === 'forward' ? FAST_STEP : -FAST_STEP });

  if (s.open === 'menu') {
    const count = Math.max(1, ctx.items?.[s.tab] ?? 1);
    if (key === 'up') s.item = clamp(s.item - 1, 0, count - 1);
    else if (key === 'down') s.item = clamp(s.item + 1, 0, count - 1);
    else if (key === 'left' || key === 'right') {
      const at = Math.max(0, tabs.indexOf(s.tab));
      s.tab = tabs[clamp(at + (key === 'left' ? -1 : 1), 0, tabs.length - 1)];
      s.item = ctx.selected?.[s.tab] ?? 0;
    } else if (key === 'ok') return done({ type: 'pick', tab: s.tab, index: s.item });
    else if (key === 'back') s.open = 'bar';
    return done();
  }

  if (s.open === 'bar') {
    s.focus = clamp(s.focus, 0, controls.length - 1);
    if (key === 'left') s.focus = clamp(s.focus - 1, 0, controls.length - 1);
    else if (key === 'right') s.focus = clamp(s.focus + 1, 0, controls.length - 1);
    else if (key === 'down' || key === 'back') s.open = 'none';
    else if (key === 'ok') {
      const button = controls[s.focus];
      if (button === 'back') return done({ type: 'seek', by: -SEEK_STEP });
      if (button === 'forward') return done({ type: 'seek', by: SEEK_STEP });
      if (button === 'play') return done({ type: 'toggle' });
      if (button === 'next') return done({ type: 'next' });
      if (button === 'subtitles' || button === 'audio') {
        s.open = 'menu';
        s.tab = button;
        s.item = ctx.selected?.[button] ?? 0;
      }
    }
    return done({ type: 'show' });
  }

  // Nothing open: the card or the skip button has the focus, otherwise the keys play and jump.
  if (ctx.upNext) {
    if (key === 'left' || key === 'right') s.nextFocus = key === 'left' ? 0 : 1;
    else if (key === 'ok') return done(s.nextFocus === 0 ? { type: 'next' } : { type: 'dismissNext' });
    else if (key === 'back') return done({ type: 'dismissNext' });
    else if (key === 'up' || key === 'down') {
      s.open = 'bar';
      s.focus = controls.indexOf('play');
      return done({ type: 'show' });
    }
    return done();
  }
  if (key === 'ok') return done(ctx.skip ? { type: 'skip' } : { type: 'toggle' });
  if (key === 'left' || key === 'right') return done({ type: 'seek', by: key === 'left' ? -SEEK_STEP : SEEK_STEP });
  if (key === 'up' || key === 'down') {
    s.open = 'bar';
    s.focus = controls.indexOf('play');
    return done({ type: 'show' });
  }
  return { state: s, action: null, handled: false };
}

const MIN_VISIBLE = 5;
/** When a skip button shows for a part (as on the website: not in its last second). */
function skipWindow(span) {
  const margin = span.confidence === 'medium' ? 2 : span.confidence === 'high' ? 1 : 0;
  const until = span.end - 1;
  return { from: Math.max(span.start, Math.min(span.start + margin, until - MIN_VISIBLE)), until };
}

/** The skip offered at `time` (seconds in the file): recap, intro or credits, and where it leads. */
export function skipAt(segments, time) {
  if (!segments) return null;
  const inside = (span) => {
    if (!span) return false;
    const w = skipWindow(span);
    return time >= w.from && time < w.until;
  };
  if (inside(segments.recap)) return { kind: 'recap', to: segments.recap.end };
  if (inside(segments.intro)) return { kind: 'intro', to: segments.intro.end };
  if (inside(segments.credits)) {
    const post = segments.postCredits && segments.postCredits.start >= segments.credits.end - 1 ? segments.postCredits : null;
    return { kind: 'credits', to: post ? post.start : segments.credits.end };
  }
  return null;
}

/** When the "Next episode" card comes up: at the end credits (with nothing after them), or near the end. */
export function upNextStart(segments, duration) {
  if (!(duration > 0)) return null;
  const fallback = Math.max(0, duration - Math.max(10, NEXT_COUNTDOWN + 2));
  if (segments?.credits && !segments.postCredits && segments.credits.end >= duration - 5) return Math.min(fallback, segments.credits.start);
  return fallback;
}

/** Where the marks for the intro, recap and credits go on the bar (fractions of the length). */
export function segmentMarks(segments, length) {
  if (!segments || !(length > 0)) return [];
  return ['recap', 'intro', 'credits']
    .map((kind) => segments[kind])
    .filter(Boolean)
    .flatMap((span) => [span.start, span.end])
    .filter((t) => t > 0 && t < length)
    .map((t) => Math.round((t / length) * 10000) / 10000);
}

/** The subtitle style the viewer can choose on the TV: three rows, OK goes to the next value. */
export const STYLE_ROWS = [
  { key: 'size', values: ['small', 'medium', 'large', 'xlarge'] },
  { key: 'color', values: ['white', 'yellow'] },
  { key: 'background', values: ['none', 'translucent', 'solid'] },
];
export const DEFAULT_TV_STYLE = { size: 'medium', color: 'white', background: 'none' };

/** The next value of a row (OK on it). */
export function cycleStyle(style, row) {
  const def = STYLE_ROWS[row];
  if (!def) return style;
  const current = def.values.indexOf(style[def.key]);
  return { ...style, [def.key]: def.values[(current + 1) % def.values.length] };
}

/** The choice as a Cast text track style (the same values the website and app send). */
export function castStyle(style) {
  return {
    fontScale: { small: 0.8, medium: 1, large: 1.2, xlarge: 1.4 }[style.size] ?? 1,
    foregroundColor: style.color === 'yellow' ? '#FFE14DFF' : '#FFFFFFFF',
    backgroundColor: { none: '#00000001', translucent: '#00000099', solid: '#000000EB' }[style.background] ?? '#00000001',
    edgeType: 'DROP_SHADOW',
    edgeColor: '#000000FF',
  };
}

/** What a sender sent as Cast style, back as the TV's choice (to show it in the menu). */
export function tvStyleFrom(cast) {
  if (!cast || typeof cast !== 'object') return { ...DEFAULT_TV_STYLE };
  const scale = Number(cast.fontScale);
  const size = scale >= 1.35 ? 'xlarge' : scale >= 1.15 ? 'large' : scale > 0 && scale <= 0.85 ? 'small' : 'medium';
  const color = /^#FFE14D/i.test(String(cast.foregroundColor ?? '')) ? 'yellow' : 'white';
  const alpha = parseInt(String(cast.backgroundColor ?? '').slice(7, 9) || '00', 16);
  const background = alpha >= 200 ? 'solid' : alpha >= 40 ? 'translucent' : 'none';
  return { size, color, background };
}

/** An address on the server for the TV: absolute, with the cast token (as the website builds them). */
export function castUrl(base, path, token, start) {
  const u = new URL(path, `${base}/`);
  if (start && start > 0) u.searchParams.set('start', start.toFixed(3));
  u.searchParams.set('cast', token);
  return u.toString();
}

/** The server and cast token of what plays now, from the address the TV saves its progress to. */
export function serverOf(progressUrl) {
  try {
    const u = new URL(progressUrl);
    const token = u.searchParams.get('cast');
    return token ? { base: u.origin, token } : null;
  } catch {
    return null;
  }
}

/**
 * What the TV loads itself (the next episode, or another audio track): the same as the website sends
 * (lib/cast.ts), from a session the server gave the TV. `subtitleLanguage` picks the subtitle in the
 * language that was on (null: off).
 */
export function loadRequestFor(session, { base, at = 0, style, subtitleLanguage = null, audioIndex = null }) {
  const item = session.item;
  const media = {
    contentId: castUrl(base, session.decision.streamUrl, session.token),
    contentUrl: castUrl(base, session.decision.streamUrl, session.token),
    contentType: session.contentType,
    streamType: 'BUFFERED',
    duration: session.decision.durationSec ?? undefined,
    metadata: {
      metadataType: 0,
      title: item?.title ?? '',
      ...(item?.subtitle ? { subtitle: item.subtitle } : {}),
      ...(item?.posterPath ? { images: [{ url: castUrl(base, `/api/images/w342/${String(item.posterPath).replace(/^\//, '')}`, session.token) }] } : {}),
    },
    customData: { vidalune: { progressUrl: castUrl(base, '/api/cast/progress', session.token), offset: 0, durationSec: session.decision.durationSec, fileId: item?.fileId ?? null, item: item ? { kind: item.kind, id: item.id } : null, audioIndex } },
    tracks: session.subtitles.map((sub, i) => ({ trackId: i + 1, type: 'TEXT', trackContentId: castUrl(base, sub.url, session.token), trackContentType: 'text/vtt', subtype: 'SUBTITLES', name: sub.label, ...(sub.language ? { language: sub.language } : {}) })),
    ...(style ? { textTrackStyle: style } : {}),
  };
  const chosen = subtitleLanguage ? session.subtitles.findIndex((sub) => sub.language === subtitleLanguage) : -1;
  return { media, currentTime: at > 0 ? at : 0, autoplay: true, activeTrackIds: chosen >= 0 ? [chosen + 1] : [] };
}

/** The TV's own words, in the TV's language (Dutch or English). */
const WORDS = {
  en: { subtitles: 'Subtitles', audio: 'Audio', style: 'Style', next: 'Next episode', off: 'Off', skipIntro: 'Skip intro', skipRecap: 'Skip recap', skipCredits: 'Skip credits', nextIn: 'Next episode in {n} s', playNow: 'Play now', watchCredits: 'Watch credits', size: 'Size', color: 'Colour', background: 'Background', small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'Extra large', white: 'White', yellow: 'Yellow', none: 'None', translucent: 'Dimmed', solid: 'Solid', remembered: 'Your choice is remembered, in the app too.', keysOk: 'choose', keysSeek: '10 s', keysBar: 'controls', keysBack: 'back', subtitleLoading: 'Loading subtitle…', subtitleFailed: 'The subtitle could not be loaded' },
  nl: { subtitles: 'Ondertitels', audio: 'Audio', style: 'Stijl', next: 'Volgende aflevering', off: 'Uit', skipIntro: 'Intro overslaan', skipRecap: 'Samenvatting overslaan', skipCredits: 'Aftiteling overslaan', nextIn: 'Volgende aflevering over {n} s', playNow: 'Nu afspelen', watchCredits: 'Aftiteling kijken', size: 'Grootte', color: 'Kleur', background: 'Achtergrond', small: 'Klein', medium: 'Normaal', large: 'Groot', xlarge: 'Extra groot', white: 'Wit', yellow: 'Geel', none: 'Geen', translucent: 'Half', solid: 'Vol', remembered: 'Je keuze wordt onthouden, ook in de app.', keysOk: 'kiezen', keysSeek: '10 s spoelen', keysBar: 'bediening', keysBack: 'terug', subtitleLoading: 'Ondertitel laden…', subtitleFailed: 'De ondertitel kon niet geladen worden' },
};
export function words(language) {
  return String(language ?? '').toLowerCase().startsWith('nl') ? WORDS.nl : WORDS.en;
}
