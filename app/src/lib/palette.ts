/**
 * Vidalune's colours. A phone has the website's dark theme; a TV is grey with a touch of purple, with
 * muted grey-purple buttons (the owner's design for the TV app). Kept free of React Native so it is tested.
 */
export function palette(tv: boolean) {
  return {
    bg: tv ? '#1d1c25' : '#14121c',
    surface: tv ? '#26242f' : '#1e1b29',
    raised: tv ? '#302d3b' : '#282436',
    line: tv ? '#3a3648' : '#34304a',
    ink: '#ece8f4',
    muted: tv ? '#a49fb3' : '#9a93ad',
    faint: tv ? '#777189' : '#6f6884',
    accent: '#b69cff',
    accentInk: '#1b1430',
    danger: '#ff7a8a',
    ok: '#7bd88f',
    /** A filled button (Play, a chosen tab): the accent on a phone, grey-purple on a TV. */
    button: tv ? '#6b6582' : '#b69cff',
    buttonInk: tv ? '#ffffff' : '#1b1430',
    /** The edge of an outlined button on a TV (Details, Watchlist, Favorite). */
    outline: 'rgba(170, 150, 225, 0.55)',
  };
}

/**
 * The purple light on a TV: under the poster, card or episode you are on (it lifts a little), and a
 * small one under a filled button. CSS box shadows, which React Native draws on Android.
 */
export const GLOW = {
  focus: '0px 12px 26px -6px rgba(150, 120, 235, 0.8)',
  button: '0px 6px 18px -6px rgba(130, 110, 190, 0.55)',
} as const;

/** How far the chosen poster or card rises (points), with its glow under it. */
export const LIFT = -6;
