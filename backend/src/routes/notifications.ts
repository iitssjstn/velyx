import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { HttpError } from '../http-error.js';
import { requestLanguage, tr } from '../i18n/index.js';
import { DISCORD_WEBHOOK } from '../services/notifications.js';
import { NOTIFICATION_EVENTS } from '../services/settings.js';

const settingsBody = z.object({
  events: z.object(Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, z.boolean()])) as Record<(typeof NOTIFICATION_EVENTS)[number], z.ZodBoolean>).partial().optional(),
  /** Empty removes the webhook. */
  discordWebhook: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || DISCORD_WEBHOOK.test(v), 'Paste the webhook address from Discord (Server settings → Integrations → Webhooks).')
    .optional(),
});

/** Messages for administrators: the bell in the admin pages and, optionally, a Discord channel. */
export async function notificationRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const view = () => {
    const c = ctx.notifications.config();
    // The webhook address works like a password (anyone with it can post): only a hint is returned.
    return { events: c.events, discord: { configured: c.discordWebhook !== '', hint: c.discordWebhook ? `…${c.discordWebhook.slice(-6)}` : null } };
  };

  app.get('/api/admin/notifications', { preHandler: requireAdmin }, async (request) => ctx.notifications.list(requestLanguage(request)));

  app.get('/api/admin/notifications/unread', { preHandler: requireAdmin }, async () => ({ unread: ctx.notifications.unread() }));

  app.post('/api/admin/notifications/read', { preHandler: requireAdmin }, async () => {
    ctx.notifications.markAllRead();
    return { ok: true };
  });

  app.get('/api/admin/notifications/settings', { preHandler: requireAdmin }, async () => view());

  app.put('/api/admin/notifications/settings', { preHandler: requireAdmin }, async (request) => {
    const body = settingsBody.parse(request.body);
    const current = ctx.notifications.config();
    const next = {
      events: { ...current.events, ...(body.events ?? {}) },
      discordWebhook: body.discordWebhook ?? current.discordWebhook,
      // Discord messages are written in the language of the administrator who sets this up.
      discordLanguage: requestLanguage(request),
    };
    ctx.settings.update({ notifications: next });
    const changes = [body.events ? 'events' : null, body.discordWebhook !== undefined ? (body.discordWebhook ? 'Discord webhook set' : 'Discord webhook removed') : null].filter(Boolean);
    ctx.audit.record('notifications.settings', { actor: request.user, ip: request.ip, detail: changes.join(', ') || null });
    return view();
  });

  /** Sends a test message to the Discord channel that is set up. */
  app.post('/api/admin/notifications/test', { preHandler: requireAdmin }, async (request) => {
    const lang = requestLanguage(request);
    const url = ctx.notifications.config().discordWebhook;
    if (!url) throw new HttpError(400, 'No Discord webhook is set up.');
    const error = await ctx.notifications.postDiscord(url, { title: tr(lang, 'Test message from Vidalune'), body: tr(lang, 'Notifications for administrators arrive in this channel.') }, lang);
    return { ok: error === null, error };
  });
}
