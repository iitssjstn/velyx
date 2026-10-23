/**
 * Vidalune's colours, the same on a phone, a TV and the website: grey with a touch of purple, with
 * muted grey-purple buttons (the owner's design). Kept free of React Native so it is tested.
 */
export const palette = {
  bg: '#1d1c25',
  surface: '#26242f',
  raised: '#302d3b',
  line: '#3a3648',
  ink: '#ece8f4',
  muted: '#a49fb3',
  faint: '#777189',
  /** Focus rings, progress and small highlights: the light purple shows on the grey. */
  accent: '#b69cff',
  accentInk: '#1b1430',
  danger: '#ff7a8a',
  ok: '#7bd88f',
  /** A filled button (Play, a chosen tab), with white text. */
  button: '#6b6582',
  buttonInk: '#ffffff',
  /** The edge of an outlined button (Details, Watchlist, Favorite). */
  outline: 'rgba(170, 150, 225, 0.55)',
};

/**
 * The purple light: under the poster, card or episode you are on (on a TV it lifts a little), and a
 * small one under a filled button. CSS box shadows, which React Native draws on Android.
 */
export const GLOW = {
  focus: '0px 12px 26px -6px rgba(150, 120, 235, 0.8)',
  button: '0px 6px 18px -6px rgba(130, 110, 190, 0.55)',
} as const;

/** How far the chosen poster or card rises (points), with its glow under it. */
export const LIFT = -6;
