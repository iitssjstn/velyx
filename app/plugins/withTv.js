// Makes the Android app installable and startable on Android TV / Google TV (a Chromecast with
// Google TV), next to phones and tablets: the TV launcher category, no touchscreen required, and the
// banner the TV's home screen shows. And Cast Connect: casting from a phone or browser to a Google TV
// with the app opens the title in the app (receiver options and the cast intents on the TV, the
// phone's own cast options with Cast Connect on). The phone version plays as it did.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const BANNER = 'tv_banner';
const CAST_ACTIONS = ['com.google.android.gms.cast.tv.action.LAUNCH', 'com.google.android.gms.cast.tv.action.LOAD'];

/** The manifest changes, on the parsed AndroidManifest.xml (kept apart to test them). */
function applyTv(manifest) {
  const root = manifest.manifest;
  const features = (root['uses-feature'] = root['uses-feature'] ?? []);
  for (const name of ['android.software.leanback', 'android.hardware.touchscreen']) {
    const feature = features.find((f) => f.$['android:name'] === name);
    if (feature) feature.$['android:required'] = 'false';
    else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
  }
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  app.$['android:banner'] = `@drawable/${BANNER}`;
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  const launcher = (activity['intent-filter'] ?? []).find((f) => (f.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.MAIN'));
  if (!launcher) throw new Error('withTv: the main activity has no MAIN intent filter');
  const categories = (launcher.category = launcher.category ?? []);
  if (!categories.some((c) => c.$['android:name'] === 'android.intent.category.LEANBACK_LAUNCHER')) {
    categories.push({ $: { 'android:name': 'android.intent.category.LEANBACK_LAUNCHER' } });
  }
  // Cast Connect: the TV's receiver options, and the phone's cast options (instead of those of
  // react-native-google-cast, which cannot turn Cast Connect on).
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.android.gms.cast.tv.RECEIVER_OPTIONS_PROVIDER_CLASS_NAME', 'app.vidalune.tv.VidaluneReceiverOptions');
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME', 'app.vidalune.tv.VidaluneCastOptions');
  const filters = (activity['intent-filter'] = activity['intent-filter'] ?? []);
  for (const action of CAST_ACTIONS) {
    if (filters.some((f) => (f.action ?? []).some((a) => a.$['android:name'] === action))) continue;
    filters.push({ action: [{ $: { 'android:name': action } }], category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }] });
  }
  return manifest;
}

function withTv(config, { banner = './assets/tv-banner.png' } = {}) {
  config = withAndroidManifest(config, (c) => {
    c.modResults = applyTv(c.modResults);
    return c;
  });
  return withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/drawable-xhdpi');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.resolve(c.modRequest.projectRoot, banner), path.join(dir, `${BANNER}.png`));
      return c;
    },
  ]);
}

module.exports = withTv;
module.exports.applyTv = applyTv;
module.exports.CAST_ACTIONS = CAST_ACTIONS;
