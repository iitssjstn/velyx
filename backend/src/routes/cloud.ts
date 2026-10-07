import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { z } from 'zod';
import { isPrivateNetwork, parseNetwork } from '../services/remote-access.js';

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

  /** Networks that also count as home (for example a VPN between your own devices). */
  app.put('/api/admin/cloud/home-networks', { preHandler: requireAdmin }, async (request) => {
    const { networks } = z
      .object({ networks: z.array(z.string().trim().max(64).refine((n) => parseNetwork(n) !== null, 'Not a network such as 192.168.50.0/24.').refine((n) => parseNetwork(n) === null || isPrivateNetwork(n), 'Only private networks can count as home (such as 192.168.50.0/24, 10.8.0.0/24 or a VPN in 100.64.0.0/10).')).max(20) })
      .parse(request.body);
    ctx.settings.update({ homeNetworks: [...new Set(networks)] });
    ctx.audit.record('cloud.home_networks', { actor: request.user, ip: request.ip, detail: networks.join(', ') || '—' });
    return ctx.cloud.status();
  });

  /** Opening a port on the router with UPnP (opt-in), so the server is reachable from outside. */
  app.get('/api/admin/upnp', { preHandler: requireAdmin }, async () => ctx.upnp.status());

  app.put('/api/admin/upnp', { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ enabled: z.boolean(), externalPort: z.number().int().min(1024).max(65535) }).parse(request.body);
    const before = ctx.upnp.status();
    const status = await ctx.upnp.configure(body.enabled, body.externalPort);
    if (before.enabled !== body.enabled || before.externalPort !== body.externalPort) ctx.audit.record(body.enabled ? 'upnp.on' : 'upnp.off', { actor: request.user, ip: request.ip, detail: String(body.externalPort) });
    await ctx.cloud.check().catch(() => undefined);
    return status;
  });

  app.post('/api/admin/upnp/check', { preHandler: requireAdmin }, async () => {
    const status = await ctx.upnp.renew();
    await ctx.cloud.check().catch(() => undefined);
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

  /** Signed in by password after the Vidalune account did not know this user: connect them now. */
  app.post('/api/account/cloud/claim', { preHandler: requireUser }, async (request) => {
    const { ticket } = z.object({ ticket: z.string().min(20).max(200) }).parse(request.body);
    const email = await ctx.cloud.claim(ticket, request.user!.id);
    ctx.audit.record('cloud.account_linked', { actor: request.user, ip: request.ip, detail: email ?? undefined });
    return { email };
  });

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
