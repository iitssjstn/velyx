/**
 * Logic for the settings pages in the Admin tab (Playback, Integrations, Maintenance, Server, Vidalune
 * account): which fields changed, checks before saving, and which text to show. No React Native here.
 */

/** The server settings the phone pages edit (part of `GET /api/admin/settings`). */
export interface ServerSettings {
  serverName: string;
  updateCheck: boolean;
  version: string;
  mediaRoots: string[];
  segmentDetection: boolean;
  segmentVideo: boolean;
  shareDetection: boolean;
  subtitlePrefetch: boolean;
  subtitlePrefetchStatus: { enabled: boolean; pending: number; running: boolean; waitingFor: 'off' | 'playback' | 'scan' | 'window' | 'quiet' | null };
  maintenanceStart: string;
  maintenanceEnd: string;
  maintenanceOutside: boolean;
  aheadSeconds: number;
  serverTime: string;
  serverTimeZone: string;
}

export type Encoder = 'software' | 'vaapi' | 'nvenc';
export const ENCODERS: Encoder[] = ['nvenc', 'vaapi', 'software'];

export interface TranscodingState {
  settings: { enabled: boolean; encoder: 'auto' | Encoder; maxStreams: number | null };
  support: { software: boolean; vaapi: string | null; nvenc: boolean; noKeyframes?: Encoder[]; checkedAt: number } | null;
  inUse: Encoder | null;
  active: number;
}

export interface ServiceConfig {
  url: string;
  hasKey: boolean;
  version?: string | null;
}

export interface ArrItem {
  id: number;
  title: string;
  year: number | null;
  monitored: boolean;
  status: string | null;
}

export interface CloudStatus {
  enabled: boolean;
  account: string | null;
  code: { code: string; expiresAt: number; linkUrl: string } | null;
  serviceUrl: string;
  relay: { enabled: boolean; url: string | null; connected: boolean; error: 'refused' | 'subscription' | 'unreachable' | 'closed' | null; allowed: boolean };
  directAccess?: { configured: boolean; hostname: string; port: number; dnsReady: boolean; tlsReady: boolean; portOpen: boolean; url: string | null } | null;
  remoteAccess: boolean;
  homeNetworks: string[];
}

export interface DirectPortStatus {
  publicPort: number;
  internalPort: number;
}

/** The fields of `form` that differ from `saved` (what a panel sends; nothing else). */
export function changedFields<T extends object>(saved: T, form: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(form) as (keyof T)[]) {
    if (form[key] !== saved[key]) out[key] = form[key];
  }
  return out;
}

export function hasChanges(changes: object): boolean {
  return Object.keys(changes).length > 0;
}

/** "02:00": hours and minutes, as the server accepts for the maintenance window. */
export function isTimeOfDay(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** "2:5" or "0230" typed on a phone keyboard → "02:05" / "02:30"; anything else stays as typed. */
export function normalizeTime(text: string): string {
  const s = text.trim().replace('.', ':');
  const parts = /^(\d{1,2}):(\d{1,2})$/.exec(s) ?? /^(\d{2})(\d{2})$/.exec(s);
  if (!parts) return s;
  return `${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
}

/** A whole number from min to max, or null when it is not one. */
export function wholeNumberIn(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** The "at most at once" field of video conversion: empty = no limit (null), else 1 to 100. */
export function streamLimit(text: string): { ok: true; value: number | null } | { ok: false } {
  if (!text.trim()) return { ok: true, value: null };
  const n = wholeNumberIn(text, 1, 100);
  return n === null ? { ok: false } : { ok: true, value: n };
}

/** Status line of video conversion. */
export function transcodingStatus(d: TranscodingState): { key: 'off' | 'onWith' | 'noEncoder'; encoder?: Encoder; active: number } {
  if (!d.settings.enabled) return { key: 'off', active: 0 };
  if (!d.inUse) return { key: 'noEncoder', active: 0 };
  return { key: 'onWith', encoder: d.inUse, active: d.active };
}

/** What the last hardware check found for one encoder (null: not checked yet). */
export function encoderNote(support: TranscodingState['support'], e: Encoder): 'works' | 'noKeyframes' | 'notFound' | null {
  if (!support) return null;
  const works = e === 'software' ? support.software : e === 'vaapi' ? !!support.vaapi : support.nvenc;
  if (works) return 'works';
  return support.noKeyframes?.includes(e) ? 'noKeyframes' : 'notFound';
}

/** The body to save Seerr, Sonarr or Radarr: the key only when one is typed (an empty field keeps the saved one). */
export function serviceBody(url: string, apiKey: string): { url: string; apiKey?: string } {
  const key = apiKey.trim();
  return { url: url.trim(), ...(key ? { apiKey: key } : {}) };
}

/** Saving needs an address, and a key unless one is saved already. */
export function canSaveService(url: string, apiKey: string, hasKey: boolean): boolean {
  return url.trim().length > 0 && (hasKey || apiKey.trim().length > 0);
}

export function filterItems(items: ArrItem[], filter: string): ArrItem[] {
  const f = filter.trim().toLocaleLowerCase();
  return f ? items.filter((i) => i.title.toLocaleLowerCase().includes(f)) : items;
}

/** "One per line" (or separated by commas or spaces), as the website reads home networks. */
export function parseNetworks(text: string): string[] {
  return text.split(/[\s,]+/).map((n) => n.trim()).filter(Boolean);
}

/** A public port from 1024 to 65535 (as the server accepts), or null. */
export function publicPort(text: string): number | null {
  return wholeNumberIn(text, 1024, 65535);
}

/** The one step that is still missing for the direct connection (null: ready). */
export function directStep(a: NonNullable<CloudStatus['directAccess']>): 'notConfigured' | 'dns' | 'tls' | 'port' | null {
  if (!a.configured) return 'notConfigured';
  if (!a.dnsReady) return 'dns';
  if (!a.tlsReady) return 'tls';
  if (!a.portOpen) return 'port';
  return null;
}

/** The relay's state line, while it is on. */
export function relayLine(r: CloudStatus['relay']): 'connected' | 'connecting' | 'refused' | 'subscription' | 'unreachable' | 'closed' {
  if (r.connected) return 'connected';
  return r.error ?? 'connecting';
}

/** Which "files still to do" line to show under Prepare files (null: none). */
export function prefetchLine(s: Pick<ServerSettings, 'subtitlePrefetch' | 'subtitlePrefetchStatus'>): { key: 'done' | 'one' | 'other'; count: number; waitsForWindow: boolean } | null {
  if (!s.subtitlePrefetch) return null;
  const n = s.subtitlePrefetchStatus.pending;
  return { key: n === 0 ? 'done' : n === 1 ? 'one' : 'other', count: n, waitsForWindow: n > 0 && s.subtitlePrefetchStatus.waitingFor === 'window' };
}
