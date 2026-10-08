import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { parseId } from '../http-error.js';
import { requestLanguage, tr } from '../i18n/index.js';
import { OPTIMIZATION_PROFILES, type OptimizationProfile } from '../services/optimization.js';

const profileSchema = z.enum(['compat-720p', 'compat-1080p']);

export async function optimizationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/admin/optimizations', { preHandler: requireAdmin }, async (request) => {
    const lang = requestLanguage(request);
    const { paused, items } = ctx.optimizations.overview();
    return { paused, items: items.map((item) => ({ ...item, error: item.error ? tr(lang, item.error) : null })) };
  });

  app.get<{ Params: { fileId: string } }>('/api/admin/media/:fileId/optimizations', { preHandler: requireAdmin }, async (request) => {
    const fileId = parseId(request.params.fileId);
      const lang = requestLanguage(request);
      const variants = ctx.optimizations.list(fileId).map((variant) => ({ ...variant, error: variant.error ? tr(lang, variant.error) : null }));
      return { profiles: OPTIMIZATION_PROFILES, variants };
  });

  app.post<{ Params: { fileId: string } }>('/api/admin/media/:fileId/optimizations', { preHandler: requireAdmin }, async (request) => {
    const fileId = parseId(request.params.fileId);
    const body = z.object({ profile: profileSchema }).parse(request.body) as { profile: OptimizationProfile };
    return { variant: ctx.optimizations.queue(fileId, body.profile) };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/optimizations/:id', { preHandler: requireAdmin }, async (request) => {
    ctx.optimizations.remove(parseId(request.params.id));
    return { ok: true };
  });
}