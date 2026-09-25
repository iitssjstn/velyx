import type { User } from '../lib/types';
import { displayName } from '../lib/auth';

export function Avatar({ user, size = 36 }: { user: Pick<User, 'username' | 'displayName' | 'avatarUrl'>; size?: number }) {
  const name = displayName(user);
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  // Deterministic hue from the username so every user gets a stable colour.
  const hue = [...user.username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-display font-semibold text-bg"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.8 0.1 ${hue})` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
