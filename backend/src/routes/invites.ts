import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { invites, users } from '../db/schema.js';
import { hashPassword } from '../auth/password.js';
import { notFound } from '../http-error.js';
import { createLogger } from '../logger.js';

const log = createLogger('invites');
/** How long an invitation stays in the list after it could no longer be accepted. */
const SHOW_EXPIRED_MS = 7 * 86_400_000;

/** A username from an email address ("lisa.jansen@…" → "lisa.jansen"), unique on this server. */
export function usernameFor(email: string, taken: (name: string) => boolean): string {
  let base = (email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 28);
  if (base.length < 3) base = `${base}user`.slice(0, 28).padEnd(3, '0');
  let name = base;
  for (let n = 2; taken(name); n++) name = `${base}${n}`;
  return name;
}

const ref = z.object({ id: z.string().regex(/^[\w-]{6,40}$/) });

/**
 * Admin → Users → Invite: a link for someone to use this server with their Vidalune account. It
 * works once, for seven days, and can be withdrawn. Whoever accepts it gets a normal user (never an
 * administrator) with the libraries chosen here, the first time they open the server.
 */
export async function inviteRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const view = (i: typeof invites.$inferSelect, accepted: Map<string, string>) => ({
    id: i.id,
    label: i.label,
    libraryIds: i.libraryIds ? (JSON.parse(i.libraryIds) as number[]) : null,
    url: i.url,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    /** Accepted on vidalune.com by this account; the user is made when they first open the server. */
    acceptedBy: accepted.get(`invite:${i.id}`) ?? null,
  });

  app.get('/api/admin/invites', { preHandler: requireAdmin }, async () => {
    const members = await ctx.cloud.members().catch(() => []);
    const accepted = new Map(members.map((m) => [m.userRef, m.email]));
    return ctx.db
      .select()
      .from(invites)
      .where(sql`${invites.revokedAt} IS NULL AND ${invites.usedAt} IS NULL AND ${invites.expiresAt} > ${Date.now() - SHOW_EXPIRED_MS}`)
      .orderBy(desc(invites.createdAt))
      .all()
      .map((i) => view(i, accepted));
  });

  app.post('/api/admin/invites', { preHandler: requireAdmin }, async (request) => {
    const body = z
      .object({
        label: z.string().trim().max(60).optional(),
        libraryIds: z.array(z.number().int().positive()).max(1000).nullable(),
      })
      .parse(request.body);
    const id = `inv-${crypto.randomBytes(12).toString('base64url')}`;
    const { url, expiresAt } = await ctx.cloud.createInvite(id);
    const row = ctx.db
      .insert(invites)
      .values({ id, label: body.label || null, libraryIds: body.libraryIds ? JSON.stringify([...new Set(body.libraryIds)]) : null, url, expiresAt, createdBy: request.user!.id })
      .returning()
      .get();
    ctx.audit.record('invite.created', { actor: request.user, ip: request.ip, detail: body.label || undefined });
    return view(row, new Map());
  });

  app.delete('/api/admin/invites/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = ref.parse(request.params);
    const row = ctx.db.select().from(invites).where(eq(invites.id, id)).get();
    if (!row || row.revokedAt || row.usedAt) throw notFound('Invitation');
    // Withdrawn here first: even when vidalune.com cannot be told now, it no longer makes a user.
    ctx.db.update(invites).set({ revokedAt: Date.now() }).where(eq(invites.id, id)).run();
    ctx.audit.record('invite.revoked', { actor: request.user, ip: request.ip, detail: row.label || undefined });
    await ctx.cloud.revokeInvite(id).catch((err: Error) => log.warn(`Could not withdraw the invitation on vidalune.com: ${err.message}`));
    return { ok: true };
  });
}

/**
 * Someone opens this server for the first time with the Vidalune account that accepted invitation
 * `id`: a normal user is made for them with the chosen libraries, and the administrators are told.
 * Null when the invitation was withdrawn or already used.
 */
export async function redeemInvite(ctx: AppContext, id: string, email: string | null, ip: string) {
  const row = ctx.db.select().from(invites).where(eq(invites.id, id)).get();
  if (!row || row.revokedAt) return null;
  if (row.usedAt) {
    // Used, but vidalune.com did not hear about the user yet (it could not be reached): try again.
    const made = row.userId ? ctx.db.select().from(users).where(eq(users.id, row.userId)).get() : undefined;
    if (!made) return null;
    await ctx.cloud.inviteUser(id, made.id);
    return made;
  }
  // Taken first, so two requests at once never make two users.
  const claimed = ctx.db.update(invites).set({ usedAt: Date.now() }).where(sql`${invites.id} = ${id} AND ${invites.usedAt} IS NULL`).run();
  if (!claimed.changes) return null;
  const taken = (name: string) => !!ctx.db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${name}`).get();
  const username = usernameFor(email ?? row.label ?? 'guest', taken);
  // Nobody knows this password: they sign in with their Vidalune account (an administrator can set one).
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('base64url'));
  const user = ctx.db
    .insert(users)
    .values({ username, displayName: row.label || null, role: 'user', passwordHash })
    .returning()
    .get();
  ctx.access.setGrants(user.id, row.libraryIds ? (JSON.parse(row.libraryIds) as number[]) : null);
  ctx.db.update(invites).set({ userId: user.id }).where(eq(invites.id, id)).run();
  ctx.audit.record('invite.used', { actorName: email ?? username, ip, target: username, detail: row.label || undefined });
  ctx.notifications.notify('inviteAccepted', { user: row.label || username, email: email ?? '—', username });
  // When vidalune.com cannot be told now, the next sign-in with this account tries again (above).
  await ctx.cloud.inviteUser(id, user.id).catch((err: Error) => log.warn(`Could not tell vidalune.com about the new user: ${err.message}`));
  return user;
}
