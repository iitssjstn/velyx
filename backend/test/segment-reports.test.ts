import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { adminNotifications, episodes, segmentReports } from '../src/db/schema.js';
import { renderNotification } from '../src/services/notifications.js';
import { REPORTS_PER_HOUR, seasonComplaints } from '../src/services/segments/reports.js';

let env: TestEnv | null = null;
afterEach(async () => {
  await env?.cleanup();
  env = null;
});

/** A server with one show of two episodes, an admin, a viewer of that library and one of another. */
async function setup() {
  env = await createTestEnv({ prober: async () => fakeProbe({ durationSec: 1500 }) });
  const admin = await setupAdmin(env.app);
  for (const f of ['S01E01.mkv', 'S01E02.mkv']) touch(path.join(env.mediaDir, 'tv', 'The Show', 'Season 01', `The.Show.${f}`));
  const tv = await addLibrary(env, admin, 'shows', 'tv');
  const viewer = await createUser(env.app, admin, 'viewer');
  const outsider = await createUser(env.app, admin, 'outsider');
  await env.app.inject({ method: 'PUT', url: `/api/users/${outsider.id}`, headers: { cookie: admin }, payload: { libraryIds: [tv.id + 1000] } });
  const eps = env.ctx.db.select().from(episodes).all().sort((a, b) => a.episodeNumber - b.episodeNumber);
  return { env, admin, viewer, outsider, e1: eps[0]!, e2: eps[1]! };
}

const report = (e: TestEnv, cookie: string, id: number, payload: unknown) => e.app.inject({ method: 'POST', url: `/api/episodes/${id}/segment-report`, headers: { cookie }, payload: payload as object });

describe('viewers reporting a wrong intro, recap or credits', () => {
  it('lets a viewer of the library report, validates it, and tells the administrators', async () => {
    const { env, admin, viewer, outsider, e1 } = await setup();
    expect((await report(env, viewer.cookie, e1.id, { kind: 'intro', problem: 'ends-late', position: 82.5 })).json()).toEqual({ ok: true });
    // Not signed in, another library, an unknown episode, or nonsense: refused.
    expect((await env.app.inject({ method: 'POST', url: `/api/episodes/${e1.id}/segment-report`, payload: { kind: 'intro', problem: 'ends-late' } })).statusCode).toBe(401);
    expect((await report(env, outsider.cookie, e1.id, { kind: 'intro', problem: 'ends-late' })).statusCode).toBe(404);
    expect((await report(env, viewer.cookie, 999_999, { kind: 'intro', problem: 'ends-late' })).statusCode).toBe(404);
    for (const bad of [{ kind: 'opening', problem: 'ends-late' }, { kind: 'intro', problem: 'wrong' }, { kind: 'intro', problem: 'ends-late', position: -1 }, { kind: 'intro', problem: 'ends-late', extra: 1 }, {}]) {
      expect((await report(env, viewer.cookie, e1.id, bad)).statusCode).toBe(400);
    }

    const show = (await env.app.inject({ url: `/api/admin/segments/shows/${e1.showId}`, headers: { cookie: admin } })).json();
    const ep = show.seasons[0].episodes.find((e: { id: number }) => e.id === e1.id);
    expect(ep.reports).toEqual([{ id: expect.any(Number), kind: 'intro', problem: 'ends-late', position: 82.5, createdAt: expect.any(Number), user: 'viewer' }]);
    expect((await env.app.inject({ url: '/api/admin/segments', headers: { cookie: admin } })).json().status.counts.reports).toBe(1);
    // Viewers cannot see or resolve reports.
    expect((await env.app.inject({ url: `/api/admin/segments/shows/${e1.showId}`, headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: `/api/admin/segments/reports/${ep.reports[0].id}/resolve`, headers: { cookie: viewer.cookie } })).statusCode).toBe(403);

    // A message for the administrators, in their language.
    const note = env.ctx.db.select().from(adminNotifications).all().find((n) => n.event === 'segmentReport')!;
    const params = JSON.parse(note.params);
    expect(renderNotification('segmentReport', params, 'en').title).toBe('Intro of The Show S01E01: a viewer says it is not right');
    expect(renderNotification('segmentReport', { ...params, part: 'Credits' }, 'nl').title).toBe('Aftiteling van The Show S01E01: een kijker meldt dat het niet klopt');
    expect(renderNotification('segmentReport', params, 'nl').body).toContain('stopt te laat');
  });

  it('keeps one open report per viewer, episode and part, and limits how many a viewer sends', async () => {
    const { env, admin, viewer, e1, e2 } = await setup();
    await report(env, viewer.cookie, e1.id, { kind: 'intro', problem: 'ends-late' });
    await report(env, viewer.cookie, e1.id, { kind: 'intro', problem: 'starts-early' });
    await report(env, viewer.cookie, e1.id, { kind: 'credits', problem: 'missing' });
    await report(env, admin, e1.id, { kind: 'intro', problem: 'ends-late' });
    const open = env.ctx.db.select().from(segmentReports).all().filter((r) => r.resolvedAt === null);
    expect(open.map((r) => `${r.userId}:${r.kind}:${r.problem}`).sort()).toEqual([`1:intro:ends-late`, `${viewer.id}:credits:missing`, `${viewer.id}:intro:starts-early`].sort());
    for (let i = 3; i < REPORTS_PER_HOUR; i++) expect((await report(env, viewer.cookie, e2.id, { kind: 'recap', problem: 'not-there' })).statusCode).toBe(200);
    const tooMany = await report(env, viewer.cookie, e2.id, { kind: 'recap', problem: 'not-there' });
    expect(tooMany.statusCode).toBe(429);
    // Others are not held back by it.
    expect((await report(env, admin, e2.id, { kind: 'recap', problem: 'not-there' })).statusCode).toBe(200);
  });

  it('closes reports when marked done, when the episode is corrected, and when it is analysed again', async () => {
    const { env, admin, viewer, e1, e2 } = await setup();
    await report(env, viewer.cookie, e1.id, { kind: 'intro', problem: 'ends-late' });
    await report(env, viewer.cookie, e1.id, { kind: 'credits', problem: 'starts-early' });
    await report(env, viewer.cookie, e2.id, { kind: 'intro', problem: 'missing' });
    const openOf = (id: number) => env.ctx.db.select().from(segmentReports).where(eq(segmentReports.episodeId, id)).all().filter((r) => r.resolvedAt === null);

    const one = openOf(e1.id).find((r) => r.kind === 'credits')!;
    expect((await env.app.inject({ method: 'POST', url: `/api/admin/segments/reports/${one.id}/resolve`, headers: { cookie: admin } })).json()).toEqual({ ok: true });
    expect((await env.app.inject({ method: 'POST', url: `/api/admin/segments/reports/${one.id}/resolve`, headers: { cookie: admin } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'POST', url: '/api/admin/segments/reports/abc/resolve', headers: { cookie: admin } })).statusCode).toBe(400);
    expect(openOf(e1.id)).toHaveLength(1);
    expect((await env.app.inject({ url: '/api/admin/audit', headers: { cookie: admin } })).body).toContain('segments.reportResolved');

    const put = await env.app.inject({ method: 'PUT', url: `/api/admin/segments/episodes/${e1.id}`, headers: { cookie: admin }, payload: { intro: { start: 30, end: 70 }, credits: null, postCredits: null } });
    expect(put.statusCode).toBe(200);
    expect(openOf(e1.id)).toHaveLength(0);

    env.ctx.settings.update({ segmentDetection: true });
    await env.app.inject({ method: 'POST', url: '/api/admin/segments/analyze', headers: { cookie: admin }, payload: { scope: 'episode', episodeId: e2.id } });
    expect(openOf(e2.id)).toHaveLength(0);
    expect((await env.app.inject({ url: '/api/admin/segments', headers: { cookie: admin } })).json().status.counts.reports).toBe(0);
  });

  it('groups a season\'s open reports for vidalune.com, without users or positions', async () => {
    const { env, admin, viewer, e1 } = await setup();
    await report(env, viewer.cookie, e1.id, { kind: 'intro', problem: 'ends-late', position: 80 });
    await report(env, admin, e1.id, { kind: 'intro', problem: 'ends-late' });
    expect(seasonComplaints(env.ctx.db, e1.showId, 1)).toEqual([{ episode: 1, duration: 1500, kind: 'intro', problem: 'ends-late', count: 2 }]);
    expect(seasonComplaints(env.ctx.db, e1.showId, 2)).toEqual([]);
  });
});
