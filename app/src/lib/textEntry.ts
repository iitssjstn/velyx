/**
 * How a text field types by default. A password is not a sentence: no capital letter at the start
 * and no autocorrect. The field's own props come after these, so a field can still choose otherwise.
 */
export function textEntryDefaults(secure: boolean | undefined): { autoCapitalize?: 'none'; autoCorrect?: false } {
  return secure ? { autoCapitalize: 'none', autoCorrect: false } : {};
}
