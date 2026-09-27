import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';

/** Admin → Vidalune account: link this server to an account (opt-in), check, unlink. */
export async function cloudRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/admin/cloud', { preHandler: requireAdmin }, async () => ctx.cloud.status());

  app.post('/api/admin/cloud/link', { preHandler: requireAdmin }, async (request) => {
    const wasOn = ctx.cloud.status().enabled;
    const status = await ctx.cloud.link();
    if (!wasOn) ctx.audit.record('cloud.linking', { actor: request.user, ip: request.ip, detail: ctx.config.cloudUrl });
    return status;
  });

  app.post('/api/admin/cloud/check', { preHandler: requireAdmin }, async () => ctx.cloud.check());

  app.post('/api/admin/cloud/unlink', { preHandler: requireAdmin }, async (request) => {
    const was = ctx.cloud.status();
    const status = await ctx.cloud.unlink();
    if (was.enabled) ctx.audit.record('cloud.unlinked', { actor: request.user, ip: request.ip, detail: was.account });
    return status;
  });
}
