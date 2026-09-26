import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { activityStats, playbackHistory } from '../services/activity.js';

const statsQuery = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 365].includes(d), 'Choose 7, 30, 90 or 365 days').default(30) });
const historyQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  userId: z.coerce.number().int().positive().optional(),
  kind: z.enum(['movie', 'episode']).optional(),
});

/** Activity: who watches what (admins), and everyone's own watch history. */
export async function activityRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/admin/activity', { preHandler: requireAdmin }, async (request) => {
    const { days } = statsQuery.parse(request.query);
    return { streams: ctx.streams.active(), stats: activityStats(ctx.db, days) };
  });

  app.get('/api/admin/activity/history', { preHandler: requireAdmin }, async (request) => playbackHistory(ctx.db, historyQuery.parse(request.query)));

  // Your own history only, whatever userId is asked for.
  app.get('/api/account/history', { preHandler: requireUser }, async (request) => {
    const q = historyQuery.parse(request.query);
    return playbackHistory(ctx.db, { page: q.page, limit: q.limit, kind: q.kind, userId: request.user!.id });
  });
}
