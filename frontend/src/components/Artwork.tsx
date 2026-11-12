import { useEffect, useState } from 'react';
import { imageUrl } from '../lib/format';

type Size = Parameters<typeof imageUrl>[1];

/** How long after a failed poster it is asked again. */
export const RETRY_MS = 1500;

/**
 * Lazy-loaded artwork with a typographic fallback, so items without TMDB artwork (or while offline)
 * still look intentional.
 */
export function Artwork({
  path,
  size = 'w342',
  title,
  className = '',
  aspect = 'poster',
  eager = false,
}: {
  path: string | null | undefined;
  size?: Size;
  title: string;
  className?: string;
  aspect?: 'poster' | 'wide';
  eager?: boolean;
}) {
  const src = imageUrl(path, size);
  // A poster that did not come (the server was busy, the connection dropped) is asked once more
  // before the title stands in for it. A new picture starts afresh.
  const [tries, setTries] = useState(0);
  // 0: first try, 1: waiting, 2: second try, 3: given up.
  const failed = tries > 2;
  useEffect(() => setTries(0), [src]);
  useEffect(() => {
    if (tries !== 1) return;
    const timer = setTimeout(() => setTries((n) => (n === 1 ? 2 : n)), RETRY_MS);
    return () => clearTimeout(timer);
  }, [tries]);
  const ratio = aspect === 'poster' ? 'aspect-[2/3]' : 'aspect-video';
  if (!src || failed) {
    const hue = [...title].reduce((h, c) => (h * 33 + c.charCodeAt(0)) % 360, 11);
    return (
      <div
        className={`relative flex ${ratio} items-end overflow-hidden p-3 ${className}`}
        style={{ background: `linear-gradient(155deg, oklch(0.36 0.07 ${hue}) 0%, oklch(0.22 0.04 ${(hue + 40) % 360}) 100%)` }}
        aria-label={title}
        role="img"
      >
        <span className="line-clamp-3 font-display text-lg leading-tight font-semibold text-ink/90">{title}</span>
      </div>
    );
  }
  // Waiting to ask again: the empty frame, not the broken picture.
  if (tries === 1) return <div className={`${ratio} w-full bg-raised ${className}`} aria-label={title} role="img" />;
  return (
    <img
      key={tries}
      src={src}
      alt={title}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setTries((n) => (n === 0 ? 1 : 3))}
      className={`${ratio} w-full bg-raised object-cover ${className}`}
    />
  );
}
