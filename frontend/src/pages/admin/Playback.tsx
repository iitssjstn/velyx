import { AheadSettings } from './SettingsPanels';
import { TranscodingSettings } from './TranscodingSettings';

/** Admin → Playback: how files are converted for devices that cannot play them, and how far ahead. Subtitles from
 *  online come through vidalune.com and need no settings. */
export function PlaybackPage() {
  return (
    <div className="space-y-6">
      <TranscodingSettings />
      <AheadSettings />
    </div>
  );
}
