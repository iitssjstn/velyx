import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { z } from 'zod';

/** Admin → Vidalune account: link this server to an account (opt-in), check, unlink. */
export async function cloudRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/admin/cloud', { preHandler: requireAdmin }, async () => ctx.cloud.status());

  app.post('/api/admin/cloud/link', { preHandler: requireAdmin }, async (request) => {
    const wasOn = ctx.cloud.status().enabled;
    const status = await ctx.cloud.link(request.user!.id);
    if (!wasOn) ctx.audit.record('cloud.linking', { actor: request.user, ip: request.ip, detail: ctx.config.cloudUrl });
    return status;
  });

  app.post('/api/admin/cloud/check', { preHandler: requireAdmin }, async () => ctx.cloud.check());

  app.post('/api/admin/cloud/relay', { preHandler: requireAdmin }, async (request) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    const status = await ctx.cloud.setRelay(enabled);
    ctx.audit.record(enabled ? 'cloud.relay_on' : 'cloud.relay_off', { actor: request.user, ip: request.ip, detail: status.relay.url });
    return status;
  });

  // ---- every user: their own Vidalune account, to sign in here from app.vidalune.com and the app
  app.get('/api/account/cloud', { preHandler: requireUser }, async (request) => {
    const appUrl = ctx.cloud.appUrl();
    if (!appUrl) return { available: false, email: null, appUrl: null };
    const members = await ctx.cloud.members().catch(() => null);
    return { available: true, email: members?.find((m) => m.userRef === String(request.user!.id))?.email ?? null, appUrl, reachable: members !== null };
  });

  app.post('/api/account/cloud/link', { preHandler: requireUser }, async (request) => ctx.cloud.memberCode(request.user!.id));

  app.post('/api/account/cloud/unlink', { preHandler: requireUser }, async (request) => {
    await ctx.cloud.removeMember(request.user!.id);
    ctx.audit.record('cloud.account_unlinked', { actor: request.user, ip: request.ip });
    return { ok: true };
  });

  app.post('/api/admin/cloud/unlink', { preHandler: requireAdmin }, async (request) => {
    const was = ctx.cloud.status();
    const status = await ctx.cloud.unlink();
    if (was.enabled) ctx.audit.record('cloud.unlinked', { actor: request.user, ip: request.ip, detail: was.account });
    return status;
  });
}
