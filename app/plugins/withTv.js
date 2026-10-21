// Makes the Android app installable and startable on Android TV / Google TV (a Chromecast with
// Google TV), next to phones and tablets: the TV launcher category, no touchscreen required, and the
// banner the TV's home screen shows. The phone version stays as it is.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const BANNER = 'tv_banner';

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
