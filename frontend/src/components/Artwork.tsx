import { useState } from 'react';
import { imageUrl } from '../lib/format';

type Size = Parameters<typeof imageUrl>[1];

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
  const [failed, setFailed] = useState(false);
  const src = imageUrl(path, size);
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
  return (
    <img
      src={src}
      alt={title}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      className={`${ratio} w-full bg-raised object-cover ${className}`}
    />
  );
}
