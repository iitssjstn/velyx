import { useEffect } from 'react';
import { AppState } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { homeReset, idle, resettable } from '../lib/idleReset';

/**
 * TV only: after half an hour without use the app goes back to Home with fresh lists. A paused
 * player closes too (it saves where it was when it closes, so Continue Watching picks it up).
 */
export function TvIdleReset() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  useEffect(() => {
    const check = () => {
      if (!resettable(pathname) || !idle.due()) return;
      if (router.canDismiss()) router.dismissAll();
      router.navigate('/home');
      void queryClient.invalidateQueries();
      homeReset.fire();
    };
    const timer = setInterval(check, 60_000);
    // Coming back after the TV was off or showed its screensaver: the time away counts.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      check();
      idle.touch();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [pathname, queryClient]);
  return null;
}
