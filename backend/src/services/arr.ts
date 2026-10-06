import { z } from 'zod';
import { HttpError } from '../http-error.js';
import type { SettingsService } from './settings.js';
import type { FetchLike } from './tmdb.js';

export type ArrServiceName = 'sonarr' | 'radarr';

export interface ArrItem {
  id: number;
  title: string;
  year: number | null;
  monitored: boolean;
  status: string | null;
}

const itemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1).max(500),
  year: z.number().int().nullable().optional(),
  monitored: z.boolean().optional(),
  status: z.string().max(80).nullable().optional(),
});
const itemsSchema = z.array(itemSchema).max(10_000);
const statusSchema = z.object({ version: z.string().max(80).optional() });
const TIMEOUT_MS = 8000;

export function normalizeArrUrl(value: string): string {
  const input = value.trim();
  if (!input) return '';
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, 'Enter the full Sonarr/Radarr address, including http:// or https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new HttpError(400, 'Use an http:// or https:// address without a username, password, query, or fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

/** Talks to Sonarr/Radarr only from the server; browser clients never receive the API key. */
export class ArrService {
  constructor(private readonly deps: { settings: SettingsService; fetchImpl?: FetchLike }) {}

  configured(service: ArrServiceName): boolean {
    const value = this.deps.settings.get()[service];
    return Boolean(value.url && value.apiKey);
  }

  safeConfig(service: ArrServiceName): { url: string; hasKey: boolean } {
    const value = this.deps.settings.get()[service];
    return { url: value.url, hasKey: Boolean(value.apiKey) };
  }

  async test(service: ArrServiceName, url: string, apiKey: string): Promise<{ version: string | null }> {
    const data = await this.call(service, url, apiKey, 'system/status');
    const parsed = statusSchema.safeParse(data);
    if (!parsed.success) throw new HttpError(502, 'Sonarr/Radarr returned an unexpected status response.');
    return { version: parsed.data.version ?? null };
  }

  async testSaved(service: ArrServiceName): Promise<{ version: string | null }> {
    const config = this.deps.settings.get()[service];
    if (!config.url || !config.apiKey) throw new HttpError(409, `${service === 'sonarr' ? 'Sonarr' : 'Radarr'} is not configured.`);
    return this.test(service, config.url, config.apiKey);
  }

  async list(service: ArrServiceName): Promise<ArrItem[]> {
    const config = this.deps.settings.get()[service];
    if (!config.url || !config.apiKey) throw new HttpError(409, `${service === 'sonarr' ? 'Sonarr' : 'Radarr'} is not configured.`);
    const data = await this.call(service, config.url, config.apiKey, service === 'sonarr' ? 'series' : 'movie');
    const parsed = itemsSchema.safeParse(data);
    if (!parsed.success) throw new HttpError(502, 'Sonarr/Radarr returned an unexpected library response.');
    return parsed.data.map((item) => ({ id: item.id, title: item.title, year: item.year ?? null, monitored: item.monitored ?? false, status: item.status ?? null }));
  }

  async remove(service: ArrServiceName, id: number, deleteFiles: boolean): Promise<void> {
    const config = this.deps.settings.get()[service];
    if (!config.url || !config.apiKey) throw new HttpError(409, `${service === 'sonarr' ? 'Sonarr' : 'Radarr'} is not configured.`);
    const resource = service === 'sonarr' ? 'series' : 'movie';
    const exclusion = service === 'sonarr' ? 'addImportListExclusion' : 'addImportExclusion';
    const query = new URLSearchParams({ deleteFiles: String(deleteFiles), [exclusion]: 'false' });
    await this.call(service, config.url, config.apiKey, `${resource}/${id}?${query}`, 'DELETE');
  }

  private async call(service: ArrServiceName, baseUrl: string, apiKey: string, resource: string, method = 'GET'): Promise<unknown> {
    const name = service === 'sonarr' ? 'Sonarr' : 'Radarr';
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/v3/${resource.split('?')[0]}`;
    const query = resource.split('?')[1];
    if (query) url.search = query;
    let response: Response;
    try {
      response = await (this.deps.fetchImpl ?? fetch)(url.toString(), {
        method,
        headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = (error as Error).name === 'TimeoutError';
      throw new HttpError(502, timeout ? `${name} did not answer in time. Try again later.` : `Could not reach ${name}. Check its address.`);
    }
    if (response.status === 401 || response.status === 403) throw new HttpError(502, `${name} refused the API key. Check the key in its settings.`);
    if (response.status === 404) throw new HttpError(502, `Could not find the ${name} API. Check its address and URL base path.`);
    if (!response.ok) throw new HttpError(502, `${name} returned an error (${response.status}).`);
    if (response.status === 204 || method === 'DELETE') return null;
    try {
      return await response.json();
    } catch {
      throw new HttpError(502, `${name} returned an invalid response.`);
    }
  }
}