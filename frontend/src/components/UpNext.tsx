import { ListVideo, Play } from 'lucide-react';
import type { EpisodeDetail } from '../lib/types';
import { episodeCode, formatRuntime, imageUrl } from '../lib/format';
import { useT } from '../i18n';

type Next = NonNullable<EpisodeDetail['next']>;

/**
 * At the end of an episode (while the picture shrinks into a corner): what comes next, big enough
 * to decide at a glance. *Next episode* fills up while the autoplay countdown runs; *Watch credits*
 * brings the picture back; *Episodes* goes to the season.
 */
export function UpNext({
  next,
  countdown,
  countdownTotal,
  credits,
  ended,
  onPlay,
  onStay,
  onEpisodes,
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
  /** Leave the player for the list of episodes. */
  onEpisodes?: () => void;
}) {
  const { t } = useT();
  const title = next.title ?? t('series.episode', { n: next.episodeNumber });
  const length = formatRuntime(next.runtime ?? (next.durationSec ? Math.round(next.durationSec / 60) : null));
  const still = imageUrl(next.stillPath, 'w780');
  const filled = countdown === null ? 0 : Math.min(100, Math.max(0, ((countdownTotal - countdown) / Math.max(1, countdownTotal)) * 100));
  const stayLabel = ended ? (countdown !== null ? t('common.cancel') : null) : credits ? t('player.watchCredits') : t('common.cancel');
  return (
    <div
      role="dialog"
      aria-label={t('player.nextEpisode')}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-4 bottom-6 z-20 animate-rise sm:inset-x-auto sm:right-10 sm:bottom-10 sm:w-[32rem]"
    >
      {countdown !== null && <p className="mb-2 font-display text-lg font-semibold text-white drop-shadow sm:text-2xl [@media(max-height:500px)]:hidden" aria-hidden>{t('player.nextStartsIn', { count: countdown })}</p>}
      <div className="overflow-hidden rounded-xl bg-black/80 shadow-2xl ring-1 ring-white/10 backdrop-blur">
        {/* The next episode's picture (left out on low screens, such as a phone on its side). */}
        {still && (
        <button type="button" onClick={onPlay} aria-label={t('player.playName', { name: title })} className="group relative block aspect-video w-full bg-raised [@media(max-height:500px)]:hidden">
          <img src={still} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
          <span className="absolute inset-0 grid place-items-center bg-black/15 transition group-hover:bg-black/5">
            <span className="grid size-14 place-items-center rounded-full border-2 border-white bg-black/50 text-white shadow-lg transition group-hover:scale-110 sm:size-16">
              <Play className="size-7 translate-x-0.5 fill-current" />
            </span>
          </span>
        </button>
        )}
        <div className="p-4">
          <p className="text-xs text-white/60">
            {t('player.nextEpisode')} · {episodeCode(next.seasonNumber, next.episodeNumber)}
            {length && ` · ${length}`}
          </p>
          <p className="truncate font-semibold sm:text-lg">{title}</p>
          {next.overview && <p className="mt-1 line-clamp-2 text-xs text-white/70 sm:line-clamp-3 sm:text-sm">{next.overview}</p>}
        </div>
      </div>
      <div className="mt-3 flex gap-3">
        {stayLabel && (
          <button type="button" onClick={onStay} className="h-12 flex-1 rounded-md bg-[#5a5a5a] px-3 text-sm font-semibold whitespace-nowrap text-white shadow-lg transition hover:bg-[#6a6a6a] sm:px-4 sm:text-lg">
            {stayLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onPlay}
          aria-label={countdown !== null ? t('player.nextStartsIn', { count: countdown }) : t('player.nextEpisode')}
          className={`relative h-12 flex-1 overflow-hidden rounded-md text-sm font-semibold whitespace-nowrap text-black transition sm:text-lg shadow-lg ${countdown !== null ? 'bg-[#b3b3b3]' : 'bg-white hover:bg-[#e6e6e6]'}`}
        >
          {countdown !== null && <span aria-hidden data-testid="countdown-fill" className="absolute inset-y-0 left-0 bg-white transition-[width] duration-1000 ease-linear" style={{ width: `${filled}%` }} />}
          <span className="relative flex items-center justify-center gap-2">
            <Play className="hidden size-5 fill-current sm:block" /> {t('player.nextEpisode')}
          </span>
        </button>
        {onEpisodes && (
          <button type="button" onClick={onEpisodes} className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-[#5a5a5a] text-white shadow-lg transition hover:bg-[#6a6a6a]" aria-label={t('series.episodes')} title={t('series.episodes')}>
            <ListVideo className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
}
