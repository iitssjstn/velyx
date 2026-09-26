import { Play } from 'lucide-react';
import type { EpisodeDetail } from '../lib/types';
import { episodeCode, formatRuntime, imageUrl } from '../lib/format';
import { useT } from '../i18n';

type Next = NonNullable<EpisodeDetail['next']>;

/**
 * Near the end of an episode: what comes next, with two clear choices. *Next episode* fills up while
 * the autoplay countdown runs; *Watch credits* stays in this episode.
 */
export function UpNext({
  next,
  countdown,
  countdownTotal,
  credits,
  ended,
  onPlay,
  onStay,
}: {
  next: Next;
  /** Seconds until the next episode starts; null when nothing starts on its own. */
  countdown: number | null;
  countdownTotal: number;
  /** The end credits are playing (so staying means watching them). */
  credits: boolean;
  ended: boolean;
  onPlay: () => void;
  /** Stay: dismiss the card (before the end) or stop the countdown (after it). */
  onStay: () => void;
}) {
  const { t } = useT();
  const title = next.title ?? t('series.episode', { n: next.episodeNumber });
  const length = formatRuntime(next.runtime ?? (next.durationSec ? Math.round(next.durationSec / 60) : null));
  const still = imageUrl(next.stillPath, 'w300');
  const filled = countdown === null ? 0 : Math.min(100, Math.max(0, ((countdownTotal - countdown) / Math.max(1, countdownTotal)) * 100));
  const stayLabel = ended ? (countdown !== null ? t('common.cancel') : null) : credits ? t('player.watchCredits') : t('common.cancel');
  return (
    <div
      role="dialog"
      aria-label={t('player.nextEpisode')}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-4 bottom-40 z-20 sm:inset-x-auto sm:right-8 sm:w-[30rem]"
    >
      <div className="flex gap-4 rounded-xl bg-black/85 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
        <div className="aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-raised sm:w-40">{still && <img src={still} alt="" className="h-full w-full object-cover" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-white/60">
            {t('player.nextEpisode')} · {episodeCode(next.seasonNumber, next.episodeNumber)}
            {length && ` · ${length}`}
          </p>
          <p className="truncate font-semibold sm:text-lg">{title}</p>
          {next.overview && <p className="mt-0.5 line-clamp-2 text-xs text-white/70 sm:text-sm">{next.overview}</p>}
        </div>
      </div>
      <div className="mt-3 flex gap-3">
        {stayLabel && (
          <button type="button" onClick={onStay} className="h-12 flex-1 rounded-md bg-[#5a5a5a] px-4 font-semibold text-white shadow-lg transition hover:bg-[#6a6a6a] sm:text-lg">
            {stayLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onPlay}
          aria-label={countdown !== null ? t('player.nextStartsIn', { count: countdown }) : t('player.nextEpisode')}
          className={`relative h-12 flex-1 overflow-hidden rounded-md font-semibold text-black transition sm:text-lg shadow-lg ${countdown !== null ? 'bg-[#b3b3b3]' : 'bg-white hover:bg-[#e6e6e6]'}`}
        >
          {countdown !== null && <span aria-hidden data-testid="countdown-fill" className="absolute inset-y-0 left-0 bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${filled}%` }} />}
          <span className="relative flex items-center justify-center gap-2">
            <Play className="size-5 fill-current" /> {t('player.nextEpisode')}
          </span>
        </button>
      </div>
    </div>
  );
}
