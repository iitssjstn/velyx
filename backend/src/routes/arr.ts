import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { HttpError, parseId } from '../http-error.js';
import { normalizeArrUrl, type ArrServiceName } from '../services/arr.js';

const serviceParam = z.enum(['sonarr', 'radarr']);
const configBody = z.object({ url: z.string().trim().max(300), apiKey: z.string().trim().min(8).max(200).optional() });
const removeQuery = z.object({ deleteFiles: z.enum(['true', 'false']).default('false') });

export async function arrRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/admin/arr', { preHandler: requireAdmin }, async () => ({
    sonarr: ctx.arr.safeConfig('sonarr'),
    radarr: ctx.arr.safeConfig('radarr'),
  }));

  app.put<{ Params: { service: string } }>('/api/admin/arr/:service', { preHandler: requireAdmin }, async (request) => {
    const service = serviceParam.parse(request.params.service) as ArrServiceName;
    const body = configBody.parse(request.body);
    const url = normalizeArrUrl(body.url);
    if (!url) {
      save(service, '', '');
      ctx.audit.record('settings.updated', { actor: request.user, ip: request.ip, detail: `${service} disabled` });
      return { url: '', hasKey: false, version: null };
    }
    const previous = ctx.settings.get()[service];
    const apiKey = body.apiKey || previous.apiKey;
    if (!apiKey) throw new HttpError(400, `Enter the API key from ${service === 'sonarr' ? 'Sonarr' : 'Radarr'} settings.`);
    const { version } = await ctx.arr.test(service, url, apiKey);
    save(service, url, apiKey);
    ctx.audit.record('settings.updated', { actor: request.user, ip: request.ip, detail: `${service} connected at ${url}` });
    return { url, hasKey: true, version };
  });

  app.post<{ Params: { service: string } }>('/api/admin/arr/:service/test', { preHandler: requireAdmin }, async (request) => {
    const service = serviceParam.parse(request.params.service) as ArrServiceName;
    const { version } = await ctx.arr.testSaved(service);
    return { ...ctx.arr.safeConfig(service), version, connected: true };
  });

  app.get<{ Params: { service: string } }>('/api/admin/arr/:service/items', { preHandler: requireAdmin }, async (request) => {
    const service = serviceParam.parse(request.params.service) as ArrServiceName;
    return { items: await ctx.arr.list(service) };
  });

  app.delete<{ Params: { service: string; id: string } }>('/api/admin/arr/:service/items/:id', { preHandler: requireAdmin }, async (request) => {
    const service = serviceParam.parse(request.params.service) as ArrServiceName;
    const id = parseId(request.params.id);
    const { deleteFiles } = removeQuery.parse(request.query);
    await ctx.arr.remove(service, id, deleteFiles === 'true');
    ctx.audit.record('settings.updated', { actor: request.user, ip: request.ip, detail: `${service} removed item ${id}${deleteFiles === 'true' ? ' and its files' : ' (files kept)'}` });
    return { ok: true };
  });

  function save(service: ArrServiceName, url: string, apiKey: string): void {
    if (service === 'sonarr') ctx.settings.update({ sonarr: { url, apiKey } });
    else ctx.settings.update({ radarr: { url, apiKey } });
  }
}