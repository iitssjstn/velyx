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

/**
 * Networks an administrator may add as home: only private ones (and the 100.64.0.0/10 range that
 * VPNs such as Tailscale use), never a public range, which would make the whole internet "home".
 */
const ADDABLE_NETWORKS: Array<[string, number, 'ipv4' | 'ipv6']> = [...HOME_NETWORKS, ['100.64.0.0', 10, 'ipv4']];

/** A network an administrator may add as home: private, inside the ranges above. */
export function isPrivateNetwork(value: string): boolean {
  const parsed = parseNetwork(value);
  if (!parsed) return false;
  const [address, prefix, type] = parsed;
  return ADDABLE_NETWORKS.some(([network, min, family]) => {
    if (family !== type || prefix < min) return false;
    const list = new net.BlockList();
    list.addSubnet(network, min, family);
    return list.check(address, type);
  });
}

/** Whether an address is in the home network (the built-in private ranges, plus `extra`). */
export function isHomeAddress(ip: string, extra: string[] = []): boolean {
  const address = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  const type = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
  if (!type) return false;
  const list = new net.BlockList();
  for (const [network, prefix, family] of HOME_NETWORKS) list.addSubnet(network, prefix, family);
  for (const value of extra) {
    // A public range saved by an older version is ignored.
    if (!isPrivateNetwork(value)) continue;
    const parsed = parseNetwork(value);
    if (parsed) list.addSubnet(...parsed);
  }
  return list.check(address, type);
}

/** Headers in which proxies, tunnels and CDNs pass on who really asked. */
const FORWARD_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip', 'fastly-client-ip', 'x-cluster-client-ip'];

/** Every address a request says it came through or from ("unknown" and the like stay in, and count as away). */
export function forwardedAddresses(headers: Record<string, string | string[] | undefined>): string[] {
  const values = (name: string) => {
    const v = headers[name];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  };
  const clean = (raw: string) => {
    let a = raw.trim().replace(/^"|"$/g, '');
    if (a.startsWith('[')) a = a.slice(1, a.indexOf(']') === -1 ? undefined : a.indexOf(']'));
    else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(a)) a = a.slice(0, a.lastIndexOf(':'));
    return a;
  };
  const out: string[] = [];
  for (const name of FORWARD_HEADERS) for (const v of values(name)) out.push(...v.split(',').map(clean).filter(Boolean));
  for (const v of values('forwarded')) for (const m of v.matchAll(/for=("[^"]*"|[^;,\s]+)/gi)) out.push(clean(m[1]));
  return out;
}

/**
 * Home or away for a request. It is at home only when the connection and every address a proxy,
 * tunnel or CDN passed on are in the home network: a reverse proxy or tunnel on the home network
 * (without TRUST_PROXY) no longer makes visitors from the internet look at home, and a visitor
 * cannot claim a home address in a header, because the proxy adds the real one.
 */
export function isHomeRequest(request: { ip: string; socket?: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }, extra: string[] = []): boolean {
  const addresses = [request.ip, request.socket?.remoteAddress ?? request.ip, ...forwardedAddresses(request.headers)];
  return addresses.every((a) => isHomeAddress(a, extra));
}
