import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { applyTv } = require('../../plugins/withTv.js') as { applyTv: (m: Manifest) => Manifest };

interface Tag { $: Record<string, string> }
interface Manifest {
  manifest: {
    'uses-feature'?: Tag[];
    application: (Tag & { activity: (Tag & { 'intent-filter': { action: Tag[]; category?: Tag[] }[] })[] })[];
  };
}

const manifest = (): Manifest => ({
  manifest: {
    'uses-feature': [{ $: { 'android:name': 'android.hardware.touchscreen', 'android:required': 'true' } }],
    application: [{
      $: { 'android:name': '.MainApplication' },
      activity: [{
        $: { 'android:name': '.MainActivity' },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] },
          { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }] },
        ],
      }],
    }],
  },
});

const names = (tags: Tag[] | undefined) => (tags ?? []).map((t) => t.$['android:name']);

describe('the app on Android TV / Google TV', () => {
  it('is in the plugins, so the TV launcher shows it', () => {
    const config = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')) as { expo: { plugins: unknown[] } };
    expect(config.expo.plugins).toContain('./plugins/withTv');
  });

  it('starts from the TV launcher, needs no touchscreen and has a banner', () => {
    const m = applyTv(manifest());
    const features = m.manifest['uses-feature'] ?? [];
    expect(features.map((f) => [f.$['android:name'], f.$['android:required']])).toEqual([
      ['android.hardware.touchscreen', 'false'],
      ['android.software.leanback', 'false'],
    ]);
    const app = m.manifest.application[0]!;
    expect(app.$['android:banner']).toBe('@drawable/tv_banner');
    const [launcher, view] = app.activity[0]!['intent-filter'];
    expect(names(launcher!.category)).toEqual(['android.intent.category.LAUNCHER', 'android.intent.category.LEANBACK_LAUNCHER']);
    expect(view!.category).toBeUndefined();
  });

  it('adds nothing twice when it runs again', () => {
    const m = applyTv(applyTv(manifest()));
    expect(m.manifest['uses-feature']).toHaveLength(2);
    expect(names(m.manifest.application[0]!.activity[0]!['intent-filter'][0]!.category)).toHaveLength(2);
  });

  it('has a banner of the size the TV launcher asks for (320 × 180)', () => {
    const png = readFileSync(new URL('../../assets/tv-banner.png', import.meta.url));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 180]);
  });
});
