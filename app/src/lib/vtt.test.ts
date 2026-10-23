import { describe, expect, it } from 'vitest';
import { cuesFrom } from './vtt';

const answer = (ok: boolean, status: number, body: string) => ({ ok, status, text: async () => body });

describe('cuesFrom', () => {
  it('reads the cues of a subtitle the server sent', async () => {
    expect(await cuesFrom(answer(true, 200, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello'))).toEqual([{ start: 1, end: 2.5, text: 'Hello' }]);
  });

  it('is an error when the server could not give it, not an empty subtitle', async () => {
    await expect(cuesFrom(answer(false, 500, '{"error":"could not read"}'))).rejects.toThrow('500');
  });
});
