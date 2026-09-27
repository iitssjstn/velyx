/**
 * The app's connection as the viewer sees it: fine, the device is offline, or the device is online
 * but the Velyx server does not answer (down, restarting, or out of reach on this network).
 */
export type Connection = 'ok' | 'offline' | 'unreachable';

/** `deviceOnline` null means not known yet (then only the server's answers count). */
export function connectionState(deviceOnline: boolean | null, serverReachable: boolean): Connection {
  if (deviceOnline === false) return 'offline';
  return serverReachable ? 'ok' : 'unreachable';
}

/** The message key for a request that got no answer ('timeout' when it took too long). */
export function noAnswerMessage(message: string): 'common.timeout' | 'common.unreachable' {
  return message === 'timeout' ? 'common.timeout' : 'common.unreachable';
}

/**
 * What to tell the viewer about a failed request: no answer (offline, timeout) in their language,
 * otherwise the server's own message (already in the account's language), or a general error.
 */
export function errorMessage(err: unknown, t: (key: 'common.timeout' | 'common.unreachable' | 'common.error') => string): string {
  const e = err as { status?: number; message?: string } | null;
  if (e?.status === 0) return t(noAnswerMessage(e.message ?? ''));
  const text = e?.message;
  return text && !text.startsWith('HTTP ') ? text : t('common.error');
}
