import net from 'node:net';

/**
 * Home or away: requests from these networks count as at home (free); everything else is playing
 * away from home, which needs remote access on the Vidalune account that owns the server.
 */
const HOME_NETWORKS: Array<[string, number, 'ipv4' | 'ipv6']> = [
  ['127.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
];

/** "192.168.50.0/24", "100.64.0.0/10" or "fd7a::/48": a network an administrator adds as home. */
export function parseNetwork(value: string): [string, number, 'ipv4' | 'ipv6'] | null {
  const m = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/.exec(value.trim());
  if (!m) return null;
  const type = net.isIPv4(m[1]) ? 'ipv4' : net.isIPv6(m[1]) ? 'ipv6' : null;
  const prefix = Number(m[2]);
  if (!type || prefix > (type === 'ipv4' ? 32 : 128)) return null;
  return [m[1], prefix, type];
}

/** Whether an address is in the home network (the built-in private ranges, plus `extra`). */
export function isHomeAddress(ip: string, extra: string[] = []): boolean {
  const address = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  const type = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
  if (!type) return false;
  const list = new net.BlockList();
  for (const [network, prefix, family] of HOME_NETWORKS) list.addSubnet(network, prefix, family);
  for (const value of extra) {
    const parsed = parseNetwork(value);
    if (parsed) list.addSubnet(...parsed);
  }
  return list.check(address, type);
}
