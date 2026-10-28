import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/app.js';

describe('URLs in the log', () => {
  it('leave out the tokens that open media', () => {
    expect(redactUrl('/api/media/1/stream?cast=abc.def&offset=3')).toBe('/api/media/1/stream?cast=…&offset=3');
    expect(redactUrl('/api/x?a=1&ticket=secret')).toBe('/api/x?a=1&ticket=…');
    expect(redactUrl('/api/libraries')).toBe('/api/libraries');
  });
});
