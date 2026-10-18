export const SEEK_STEP: number;
export const FAST_STEP: number;
export const CONTROLS_FOR_MS: number;
export const NEXT_COUNTDOWN: number;
export type Key = 'left' | 'right' | 'up' | 'down' | 'ok' | 'playpause' | 'forward' | 'rewind' | 'back';
export type Control = 'back' | 'play' | 'forward' | 'subtitles' | 'audio' | 'next';
export type Tab = 'subtitles' | 'audio' | 'style';
export interface RemoteState { open: 'none' | 'bar' | 'menu'; focus: number; tab: Tab; item: number; nextFocus: number }
export type Action = { type: 'toggle' } | { type: 'seek'; by: number } | { type: 'skip' } | { type: 'next' } | { type: 'dismissNext' } | { type: 'show' } | { type: 'pick'; tab: Tab; index: number };
export interface Span { start: number; end: number; confidence?: string }
export interface Segments { recap?: Span | null; intro?: Span | null; credits?: Span | null; postCredits?: Span | null }
export function keyOf(event: { key?: string; keyCode?: number }): Key | null;
export function controlsFor(o?: { audioTracks?: number; hasNext?: boolean }): Control[];
export function tabsFor(o?: { audioTracks?: number }): Tab[];
export function initialState(): RemoteState;
export function press(state: RemoteState, key: Key, ctx: { controls?: Control[]; tabs?: Tab[]; items?: Partial<Record<Tab, number>>; selected?: Partial<Record<Tab, number>>; skip?: boolean; upNext?: boolean }): { state: RemoteState; action: Action | null; handled: boolean };
export function skipAt(segments: Segments | null, time: number): { kind: 'recap' | 'intro' | 'credits'; to: number } | null;
export function upNextStart(segments: Segments | null, duration: number): number | null;
export function segmentMarks(segments: Segments | null, length: number): number[];
export interface TvStyle { size: string; color: string; background: string }
export const STYLE_ROWS: { key: keyof TvStyle; values: string[] }[];
export const DEFAULT_TV_STYLE: TvStyle;
export function cycleStyle(style: TvStyle, row: number): TvStyle;
export function castStyle(style: TvStyle): { fontScale: number; foregroundColor: string; backgroundColor: string; edgeType: string; edgeColor: string };
export function tvStyleFrom(cast: unknown): TvStyle;
export function castUrl(base: string, path: string, token: string, start?: number): string;
export function serverOf(progressUrl: string): { base: string; token: string } | null;
export function loadRequestFor(session: unknown, o: { base: string; at?: number; style?: unknown; subtitleLanguage?: string | null; audioIndex?: number | null }): { media: { contentId: string; metadata: Record<string, unknown>; customData: { vidalune: Record<string, unknown> }; tracks: Record<string, unknown>[]; [key: string]: unknown }; currentTime: number; autoplay: boolean; activeTrackIds: number[] };
export function words(language: string | null | undefined): Record<string, string>;
