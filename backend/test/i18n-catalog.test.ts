import { describe, expect, it } from 'vitest';
import { hasTranslation, tr } from '../src/i18n/index.js';
import { serverMessages } from './i18n-messages.js';

describe('server translations', () => {
  const messages = serverMessages();

  it('finds the server texts', () => {
    expect(messages.length).toBeGreaterThan(150);
    for (const m of ['Incorrect username or password.', 'Movie not found.', 'The video does not need transcoding.', 'Never watched, added {time} ago']) expect(messages).toContain(m);
  });

  it('has a Dutch translation for every one of them', () => {
    const missing = messages.filter((m) => !hasTranslation(m));
    expect(missing).toEqual([]);
  });

  it('keeps every placeholder in the translation', () => {
    for (const m of messages) {
      const wanted = [...m.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      const got = [...tr('nl', m).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort();
      expect({ m, got }).toEqual({ m, got: wanted });
    }
  });
});
