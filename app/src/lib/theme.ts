import { Platform } from 'react-native';
import { palette } from './palette';

/** Vidalune's colours (the website's dark theme on a phone; grey-purple on a TV, see palette). */
export const colors = palette(Platform.isTV);

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
