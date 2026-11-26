import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { RelayClient } from '../src/services/relay-client.js';

// A stand-in relay: counts the tunnels the server opens.
let wss: WebSocketServer | null = null;
let client: RelayClient | null = null;

afterEach(async () => {
  client?.stop();
  client = null;
  for (const ws of wss?.clients ?? []) ws.terminate();
  await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
  wss = null;
});

const relay = async () => {
  const opened: WebSocket[] = [];
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws) => opened.push(ws));
  await new Promise<void>((r) => wss!.once('listening', () => r()));
  const url = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  return { url, opened };
};

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Mimics the internet falling away: the relay's side goes silent, without closing anything. */
const silence = (ws: WebSocket) => (ws as unknown as { _socket: { pause(): void } })._socket.pause();

describe('relay tunnel', () => {
  it('opens again when the tunnel goes quiet without closing (internet lost)', async () => {
    const { url, opened } = await relay();
    client = new RelayClient({ cloudUrl: url, localPort: 1, checkMs: 50, staleMs: 300 });
    client.start('Server srv-1:secret');
    await until(() => opened.length === 1 && client!.status().connected);

    silence(opened[0]!);
    await until(() => opened.length === 2, 4000);
    await until(() => client!.status().connected);
  });

  it('keeps a tunnel that the relay keeps answering', async () => {
    const { url, opened } = await relay();
    client = new RelayClient({ cloudUrl: url, localPort: 1, checkMs: 50, staleMs: 300 });
    client.start('Server srv-1:secret');
    await until(() => opened.length === 1 && client!.status().connected);

    // The stand-in relay answers the server's pings by itself (as the real one does).
    await new Promise((r) => setTimeout(r, 800));
    expect(opened).toHaveLength(1);
    expect(client.status().connected).toBe(true);
  });

  it('opens one tunnel when started again with other credentials', async () => {
    const { url, opened } = await relay();
    client = new RelayClient({ cloudUrl: url, localPort: 1, checkMs: 50, staleMs: 300 });
    client.start('Server srv-1:secret');
    await until(() => opened.length === 1 && client!.status().connected);
    client.start('Server srv-1:other');
    await until(() => opened.length === 2 && client!.status().connected);

    await new Promise((r) => setTimeout(r, 1500));
    expect(opened).toHaveLength(2);
  });
});
