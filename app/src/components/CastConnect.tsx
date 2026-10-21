import { useEffect, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { CastReceiver } from '../../modules/vidalune-tv';
import { castConnectRoute, type CastConnectLoad } from '../lib/castConnect';
import { useSession } from '../lib/session';
import { TV } from './screen';

/**
 * On a TV: a title cast from a phone or browser (Cast Connect) opens in the app's own player, also
 * when the cast started the app. Waits until the app knows its server and left the start screen.
 */
export function CastConnectListener() {
  const { ready, signedIn, cloudServerId } = useSession();
  // Not on the start screen: it sends the app on to Home or the account first.
  const path = usePathname();
  const [load, setLoad] = useState<CastConnectLoad | null>(null);
  useEffect(() => {
    if (!TV || !CastReceiver) return;
    const take = () => {
      const next = CastReceiver!.takeCastLoad();
      if (next) setLoad(next);
    };
    take();
    const sub = CastReceiver.addListener('onCastLoad', take);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!load || !ready || path === '/') return;
    setLoad(null);
    const route = castConnectRoute(load, signedIn ? cloudServerId : null, Date.now());
    if (!route) return;
    // In place of a player that is open, so Back leaves to where the viewer was.
    if (path.startsWith('/play/')) router.replace(route as never);
    else router.push(route as never);
  }, [load, ready, signedIn, cloudServerId, path]);
  return null;
}
