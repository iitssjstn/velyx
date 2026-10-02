import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from './db/client.js';
import { serviceSettings } from './db/schema.js';

/** The invite link used until the CEO sets another one in the Control Center. */
export const DEFAULT_DISCORD_URL = 'https://discord.gg/S9X7yDNqEP';
const SETTING = 'discord';
const DISCORD_HOSTS = new Set(['discord.gg', 'discord.com', 'www.discord.com', 'discordapp.com']);

/** An https link to Discord (so vidalune.com/discord never leads anywhere else). */
export const discordLink = z
  .string()
  .trim()
  .max(200)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && DISCORD_HOSTS.has(u.hostname.toLowerCase()) && !u.username && !u.password && u.pathname.length > 1;
    } catch {
      return false;
    }
  }, 'Enter a Discord invite link, like https://discord.gg/abc123.');

/** The links to the Vidalune community, set in the Control Center. */
export class Community {
  private saved: string | null | undefined;

  constructor(private readonly deps: { db: DB; now: () => number }) {}

  /** Where vidalune.com/discord leads (null: turned off, the Discord links are hidden). */
  discord(): string | null {
    if (this.saved === undefined) {
      const row = this.deps.db.select().from(serviceSettings).where(eq(serviceSettings.key, SETTING)).get();
      this.saved = row ? (JSON.parse(row.value) as { url: string | null }).url : DEFAULT_DISCORD_URL;
    }
    return this.saved;
  }

  saveDiscord(url: string | null, by: string): void {
    const value = JSON.stringify({ url });
    const t = this.deps.now();
    this.deps.db.insert(serviceSettings).values({ key: SETTING, value, updatedAt: t, updatedBy: by }).onConflictDoUpdate({ target: serviceSettings.key, set: { value, updatedAt: t, updatedBy: by } }).run();
    this.saved = url;
  }
}

const body = z.object({ discordUrl: z.union([discordLink, z.literal('').transform(() => null), z.null()]) }).strict();

export function communityRoutes(app: FastifyInstance, deps: { community: Community; ceo: (request: FastifyRequest) => { email: string }; limit: (key: string) => void }): void {
  const { community } = deps;
  app.get('/api/ceo/community', async (request) => {
    deps.ceo(request);
    return { discordUrl: community.discord() };
  });
  app.put('/api/ceo/community', async (request) => {
    const me = deps.ceo(request);
    deps.limit(`community-settings:${me.email}`);
    const { discordUrl } = body.parse(request.body);
    community.saveDiscord(discordUrl, me.email);
    return { discordUrl: community.discord() };
  });
  /** vidalune.com/discord: the Vidalune community (not found while it is turned off). */
  app.get('/discord', async (_request, reply) => {
    const url = community.discord();
    if (!url) return reply.code(404).send({ error: 'Not found.' });
    return reply.header('Cache-Control', 'no-cache').redirect(url);
  });
}
