import { useId, useSyncExternalStore } from 'react';
import { TV } from './screen';
import { tvFocus } from '../lib/tvFocus';

/**
 * For anything the remote can choose on a TV: remembers it when it gets the focus, and asks for the
 * focus again when the player closes and it was the last one chosen (hasTVPreferredFocus).
 */
export function useTvFocus(): { remember: () => void; preferred: boolean } {
  const id = useId();
  const preferred = useSyncExternalStore(tvFocus.subscribe, () => TV && tvFocus.preferred(id));
  return {
    remember: () => {
      if (TV) tvFocus.remember(id);
    },
    preferred,
  };
}
