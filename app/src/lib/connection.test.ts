import { describe, expect, it } from 'vitest';
import { connectionState, errorMessage, noAnswerMessage } from './connection';

describe('connectionState', () => {
  it('is offline when the device has no network, whatever the server did last', () => {
    expect(connectionState(false, true)).toBe('offline');
    expect(connectionState(false, false)).toBe('offline');
  });
  it('is unreachable when the device is online but the server does not answer', () => {
    expect(connectionState(true, false)).toBe('unreachable');
    expect(connectionState(null, false)).toBe('unreachable');
  });
  it('is fine otherwise', () => {
    expect(connectionState(true, true)).toBe('ok');
    expect(connectionState(null, true)).toBe('ok');
  });
});

describe('noAnswerMessage', () => {
  it('tells a timeout from no connection at all', () => {
    expect(noAnswerMessage('timeout')).toBe('common.timeout');
    expect(noAnswerMessage('unreachable')).toBe('common.unreachable');
  });
});

describe('errorMessage', () => {
  const t = (key: string) => `<${key}>`;
  it('explains a request without an answer', () => {
    expect(errorMessage({ status: 0, message: 'timeout' }, t)).toBe('<common.timeout>');
    expect(errorMessage({ status: 0, message: 'unreachable' }, t)).toBe('<common.unreachable>');
  });
  it("passes on the server's own message", () => {
    expect(errorMessage({ status: 400, message: 'Current password is incorrect.' }, t)).toBe('Current password is incorrect.');
  });
  it('falls back to a general error', () => {
    expect(errorMessage({ status: 500, message: 'HTTP 500' }, t)).toBe('<common.error>');
    expect(errorMessage(null, t)).toBe('<common.error>');
  });
});
