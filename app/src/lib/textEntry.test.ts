import { describe, expect, it } from 'vitest';
import { textEntryDefaults } from './textEntry';

describe('typing in a text field', () => {
  it('starts a password without a capital letter and without autocorrect', () => {
    expect(textEntryDefaults(true)).toEqual({ autoCapitalize: 'none', autoCorrect: false });
  });

  it('leaves other fields as the field itself asks', () => {
    expect(textEntryDefaults(false)).toEqual({});
    expect(textEntryDefaults(undefined)).toEqual({});
  });
});
