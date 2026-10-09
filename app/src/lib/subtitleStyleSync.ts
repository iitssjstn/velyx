import { readSubtitleStyle, type SubtitleStyle } from './subtitleStyle';

const accountQueues = new Map<string, Promise<unknown>>();
let deviceQueue: Promise<unknown> = Promise.resolve();

export function subtitleStyleAccountScope(session: { cloudServerId: string | null; serverUrl: string | null; userId: number | null }): string {
  return JSON.stringify([session.cloudServerId ?? session.serverUrl, session.userId]);
}

function enqueueAccount(scope: string, write: () => Promise<void>): Promise<unknown> {
  const pending = (accountQueues.get(scope) ?? Promise.resolve()).catch(() => undefined).then(write);
  accountQueues.set(scope, pending);
  const cleanup = () => { if (accountQueues.get(scope) === pending) accountQueues.delete(scope); };
  void pending.then(cleanup, cleanup);
  return pending;
}

/** Wait for the first account response, even with stale cache; never interrupt existing playback. */
export function subtitlePreferencesReady(query: { isLoading: boolean; isFetching: boolean; isFetchedAfterMount: boolean }): boolean {
  return !query.isLoading && (!query.isFetching || query.isFetchedAfterMount);
}

/** Account choices win at startup; without an account style, keep this device's choices. */
export function createSubtitleStyleSync(options: {
  scope: string;
  readDevice: () => Promise<SubtitleStyle>;
  writeDevice: (style: SubtitleStyle) => Promise<void>;
  writeAccount: (style: SubtitleStyle) => Promise<unknown>;
  change: (style: SubtitleStyle) => void;
  saved: (style: SubtitleStyle) => void;
  failed: (error: unknown) => void;
  active: () => boolean;
}) {
  let revision = 0;
  const writeDevice = (style: SubtitleStyle, expected: number) => {
    deviceQueue = deviceQueue.catch(() => undefined).then(() => {
      if (options.active() && revision === expected) return options.writeDevice(style);
    });
    return deviceQueue;
  };
  return {
    async load(account: unknown | Promise<unknown>) {
      const expected = revision;
      const [device, rawAccount] = await Promise.all([options.readDevice(), Promise.resolve(account).catch(() => null)]);
      if (!options.active() || revision !== expected) return;
      const style = readSubtitleStyle(rawAccount ?? device);
      options.change(style);
      if (rawAccount !== null && rawAccount !== undefined) await writeDevice(style, expected);
    },
    save(raw: SubtitleStyle) {
      const style = readSubtitleStyle(raw);
      const expected = ++revision;
      options.change(style);
      const device = writeDevice(style, expected);
      const account = enqueueAccount(options.scope, async () => {
        if (!options.active() || revision !== expected) return;
        try {
          await options.writeAccount(style);
          if (options.active() && revision === expected) options.saved(style);
        } catch (error) {
          if (options.active() && revision === expected) options.failed(error);
        }
      });
      return Promise.all([device, account]);
    },
  };
}
