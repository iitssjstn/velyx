import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { findService } from '../src/services/upnp.js';

const DESCRIPTION = `<?xml version="1.0"?><root><device><deviceList><device><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/ctl/CmnIfCfg</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service>
</serviceList></device></deviceList></device></root>`;

// A stand-in router: answers the search on the home network, and "opens" ports.
let router: dgram.Socket;
let routerPort: number;
let mappings: Map<string, string>;
let soapCalls: string[];
let refuse: boolean;
const fakeRouter = async (url: string, init?: RequestInit) => {
  const path = new URL(url).pathname;
  if (path === '/rootDesc.xml') return new Response(DESCRIPTION, { status: 200 });
  if (path === '/ctl/IPConn') {
    const action = String((init?.headers as Record<string, string>).SOAPAction).split('#')[1].replace('"', '');
    const body = String(init?.body);
    soapCalls.push(action);
    const arg = (n: string) => new RegExp(`<${n}>([^<]*)</${n}>`).exec(body)?.[1] ?? '';
    if (action === 'AddPortMapping') {
      if (refuse) return new Response('<errorDescription>ConflictInMappingEntry</errorDescription>', { status: 500 });
      mappings.set(arg('NewExternalPort'), `${arg('NewInternalClient')}:${arg('NewInternalPort')}`);
      return new Response('<ok/>', { status: 200 });
    }
    if (action === 'DeletePortMapping') {
      mappings.delete(arg('NewExternalPort'));
      return new Response('<ok/>', { status: 200 });
    }
    if (action === 'GetExternalIPAddress') return new Response('<NewExternalIPAddress>203.0.113.9</NewExternalIPAddress>', { status: 200 });
  }
  return new Response('', { status: 404 });
};

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  mappings = new Map();
  soapCalls = [];
  refuse = false;
  router = dgram.createSocket('udp4');
  router.on('message', (msg, from) => {
    if (msg.toString().startsWith('M-SEARCH')) router.send(`HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: http://127.0.0.1:5000/rootDesc.xml\r\n\r\n`, from.port, from.address);
  });
  await new Promise<void>((r) => router.bind(0, '127.0.0.1', r));
  routerPort = (router.address() as AddressInfo).port;
  env = await createTestEnv({ fetchImpl: fakeRouter, ssdp: { host: '127.0.0.1', port: routerPort } });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => {
  env.ctx.upnp.stop();
  router.close();
  await env.cleanup();
});

const put = (payload: unknown, cookie = admin) => env.app.inject({ method: 'PUT', url: '/api/admin/upnp', headers: { cookie }, payload: payload as Record<string, unknown> });

describe('opening a port on the router (UPnP)', () => {
  it('reads where to ask the router from its description', () => {
    expect(findService(DESCRIPTION, 'http://192.168.1.1:5000/rootDesc.xml')).toEqual({ serviceType: 'urn:schemas-upnp-org:service:WANIPConnection:1', controlUrl: 'http://192.168.1.1:5000/ctl/IPConn' });
    expect(findService('<root/>', 'http://192.168.1.1/')).toBeNull();
  });

  it('is off until an administrator turns it on, then opens the port and says where', async () => {
    expect(env.ctx.config.directTlsPort).toBe(8443);
    expect((await env.app.inject({ url: '/api/admin/upnp', headers: { cookie: admin } })).json()).toMatchObject({ enabled: false, externalPort: 8443, open: false });
    expect(soapCalls).toEqual([]);
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await put({ enabled: true, externalPort: 18443 }, viewer.cookie)).statusCode).toBe(403);
    expect((await put({ enabled: true, externalPort: 80 })).statusCode).toBe(400);

    const on = await put({ enabled: true, externalPort: 43000 });
    expect(on.json()).toMatchObject({ enabled: true, externalPort: 43000, open: true, address: '203.0.113.9:43000', problem: null });
    expect(mappings.get('43000')).toBe(`127.0.0.1:${env.ctx.config.directTlsPort}`);

    // Another port: the old one is closed.
    await put({ enabled: true, externalPort: 43001 });
    expect([...mappings.keys()]).toEqual(['43001']);
    // Off: closed on the router too.
    expect((await put({ enabled: false, externalPort: 43001 })).json()).toMatchObject({ enabled: false, open: false, address: null });
    expect(mappings.size).toBe(0);
  });

  it('says so when the router refuses, or cannot be found', async () => {
    refuse = true;
    expect((await put({ enabled: true, externalPort: 43000 })).json()).toMatchObject({ open: false, problem: 'refused' });
    refuse = false;
    expect((await env.app.inject({ method: 'POST', url: '/api/admin/upnp/check', headers: { cookie: admin } })).json()).toMatchObject({ open: true });

    // No router answers.
    router.removeAllListeners('message');
    await put({ enabled: false, externalPort: 43000 });
    env.ctx.upnp['gateway'] = null;
    expect((await put({ enabled: true, externalPort: 43000 })).json()).toMatchObject({ open: false, problem: 'noRouter' });
  }, 15_000);
});
