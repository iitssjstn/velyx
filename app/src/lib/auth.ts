/** "VidaluneApp/0.8.1 (Android 15; Pixel 8)" — how the server recognises the app. */
export function appUserAgent(version: string, os: string, osVersion: string | number | null, deviceName: string | null): string {
  const parts = [`${os}${osVersion ? ` ${osVersion}` : ''}`, deviceName].filter(Boolean);
  return `VidaluneApp/${version} (${parts.join('; ')})`;
}
