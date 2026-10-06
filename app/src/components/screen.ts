import { Dimensions } from 'react-native';
import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { NavigationBar } from 'expo-navigation-bar';
import { isTablet, playerScreen, type DeviceKind } from '../lib/screen';

const kind: DeviceKind = Device.deviceType === Device.DeviceType.TABLET ? 'tablet' : Device.deviceType === Device.DeviceType.PHONE ? 'phone' : 'unknown';
const { width, height } = Dimensions.get('screen');
export const TABLET = isTablet(kind, Math.min(width, height));

const ignore = () => undefined;

/** The app's own orientation: upright on a phone, free on a tablet. */
export function appOrientation(): void {
  if (TABLET) void ScreenOrientation.unlockAsync().catch(ignore);
  else void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(ignore);
}

/** The cast remote is upright on a phone; tablets keep their preferred orientation. */
export function castRemoteOrientation(): void {
  NavigationBar.setHidden(false);
  appOrientation();
}

/** Local video playback remains landscape and immersive. */
export function playbackOrientation(): void {
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(ignore);
  NavigationBar.setHidden(true);
}

/**
 * The player's screen: landscape without the navigation bar. The bar is switched directly: the
 * <NavigationBar hidden /> component makes "hidden" its default, so the bar stayed away after
 * playback and the tab bar moved into its place.
 */
export const playerScreenState = playerScreen({
  player: playbackOrientation,
  app() {
    NavigationBar.setHidden(false);
    appOrientation();
  },
});
