/** The server's answer when a page asks for fresh metadata (see the server's FreshMetadata). */
export type FreshResult = { status: 'fresh' | 'pending' | 'skipped' } | { status: 'refreshed'; id: number };

const PENDING_WAIT_MS = 3_000;
const PENDING_TRIES = 5;

/**
 * Asks the server for fresh metadata of a movie or show (it fetches anew when the last refresh is
 * over an hour old). Resolves to the id of the item holding new metadata, or null when nothing changed.
 * While the server is still busy ("pending") it asks again a few times.
 */
export async function askFreshMetadata(
  type: 'movie' | 'show',
  id: number | string,
  deps: { post: (path: string) => Promise<FreshResult>; wait?: (ms: number) => Promise<void>; cancelled?: () => boolean },
): Promise<number | null> {
  const path = `/api/${type === 'movie' ? 'movies' : 'shows'}/${id}/refresh`;
  const wait = deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let r = await deps.post(path);
  let waited = false;
  for (let i = 0; r.status === 'pending' && i < PENDING_TRIES && !deps.cancelled?.(); i++) {
    waited = true;
    await wait(PENDING_WAIT_MS);
    r = await deps.post(path);
  }
  if (r.status === 'refreshed') return r.id;
  // Finished between two questions: the new metadata is there now.
  if (waited && r.status === 'fresh') return Number(id);
  return null;
}
