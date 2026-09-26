import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { libraries } from '../db/schema.js';
import { HttpError, parseId } from '../http-error.js';
import { CLEANUP_RULES, cleanupCandidates, deleteFiles, effectiveRules, keepFiles, keptFiles, libraryWritable, summarize, unkeepFile } from '../services/cleanup.js';

const listQuery = z.object({
  rule: z.enum(CLEANUP_RULES as [string, ...string[]]).optional(),
  libraryId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const days = z.number().int().min(1).max(3650);
const rulesBody = z.object({
  unwatched: z.object({ enabled: z.boolean(), days }),
  stale: z.object({ enabled: z.boolean(), days }),
  large: z.object({ enabled: z.boolean(), gb: z.number().min(1).max(10_000) }),
  duplicates: z.object({ enabled: z.boolean() }),
  missingInfo: z.object({ enabled: z.boolean() }),
});
const settingsBody = z.object({ rules: rulesBody.optional(), deletion: z.boolean().optional() });
const ids = z.array(z.number().int().positive()).min(1).max(500);
const keepBody = z.object({ fileIds: ids });
// Deleting needs an explicit confirmation in the request itself, not only in the page.
const deleteBody = z.object({ fileIds: ids, confirm: z.literal(true) });

/** Library clean-up: suggestions from rules, reviewed and acted on by an administrator. */
export async function cleanupRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;
  const rules = () => effectiveRules(ctx.settings.get().cleanupRules);
  const libs = () => db.select({ id: libraries.id, name: libraries.name, path: libraries.path }).from(libraries).orderBy(libraries.name).all().map((l) => ({ ...l, writable: libraryWritable(l.path) }));

  app.get('/api/admin/cleanup', { preHandler: requireAdmin }, async (request) => {
    const q = listQuery.parse(request.query);
    const r = rules();
    const { candidates, kept } = cleanupCandidates(db, r);
    const scoped = q.libraryId ? candidates.filter((c) => c.libraryId === q.libraryId) : candidates;
    const filtered = q.rule ? scoped.filter((c) => c.reasons.some((x) => x.rule === q.rule)) : scoped;
    return {
      summary: summarize(r, scoped, kept),
      deletion: { enabled: ctx.settings.get().cleanupDeletion, libraries: libs() },
      total: filtered.length,
      bytes: filtered.reduce((n, c) => n + c.size, 0),
      items: filtered.slice((q.page - 1) * q.limit, q.page * q.limit),
    };
  });

  app.put('/api/admin/cleanup/settings', { preHandler: requireAdmin }, async (request) => {
    const body = settingsBody.parse(request.body);
    if (body.rules) ctx.settings.update({ cleanupRules: body.rules });
    if (body.deletion !== undefined) ctx.settings.update({ cleanupDeletion: body.deletion });
    const changes = [body.rules ? 'rules' : null, body.deletion !== undefined ? `deleting files ${body.deletion ? 'allowed' : 'off'}` : null].filter(Boolean);
    ctx.audit.record('cleanup.settings', { actor: request.user, ip: request.ip, detail: changes.join(', ') });
    return { rules: rules(), deletion: ctx.settings.get().cleanupDeletion };
  });

  app.post('/api/admin/cleanup/keep', { preHandler: requireAdmin }, async (request) => {
    const { fileIds } = keepBody.parse(request.body);
    const n = keepFiles(db, fileIds, request.user!.username);
    ctx.audit.record('cleanup.kept', { actor: request.user, ip: request.ip, detail: `${n} file(s) kept` });
    return { kept: n };
  });

  app.get('/api/admin/cleanup/kept', { preHandler: requireAdmin }, async () => keptFiles(db));

  app.delete<{ Params: { id: string } }>('/api/admin/cleanup/kept/:id', { preHandler: requireAdmin }, async (request) => {
    const removed = unkeepFile(db, parseId(request.params.id));
    return { ok: true, removed };
  });

  app.post('/api/admin/cleanup/delete', { preHandler: requireAdmin }, async (request) => {
    if (!ctx.settings.get().cleanupDeletion) throw new HttpError(403, 'Deleting files is turned off. Allow it in the clean-up settings first.');
    const { fileIds } = deleteBody.parse(request.body);
    const candidates = new Set(cleanupCandidates(db, rules()).candidates.map((c) => c.fileId));
    // Never pull a file away from under someone who is watching it.
    const playing = new Set(ctx.streams.active().map((s) => s.mediaFileId));
    const allowed = fileIds.filter((id) => !playing.has(id));
    const results = [...deleteFiles(db, allowed, candidates), ...fileIds.filter((id) => playing.has(id)).map((id) => ({ fileId: id, libraryId: null, path: null, size: 0, ok: false, error: 'Someone is watching this file right now.' }))];
    const deleted = results.filter((x) => x.ok);
    for (const r of deleted) ctx.audit.record('cleanup.deleted', { actor: request.user, ip: request.ip, target: r.path, detail: `${(r.size / 1024 ** 3).toFixed(2)} GB` });
    // A normal scan then removes the deleted files from the library (and keeps their watch history aside).
    for (const libraryId of new Set(deleted.map((r) => r.libraryId!))) ctx.scans.enqueue(libraryId);
    return { results };
  });
}
