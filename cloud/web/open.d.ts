export interface OpenableServer {
  relayUrl?: string | null;
  relayConnected?: boolean;
  directAccess?: { url?: string | null } | null;
  endpoints?: Array<{ url?: string | null }> | null;
}
export function pageAddresses(addresses: string[] | null | undefined, server: OpenableServer | null | undefined): string[];
export const RELAY_TRIES: number;
export const RELAY_WAIT_MS: number;
export function waitForRelay<S extends OpenableServer>(
  server: S,
  load: () => Promise<S | null>,
  options?: { tries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<S>;
