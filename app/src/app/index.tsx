import { Redirect } from 'expo-router';
import { Loading } from '../components/ui';
import { useSession } from '../lib/session';
import { startRoute } from '../lib/start';

/** Where the app starts: the Vidalune account (an address is the other way in), sign in, or straight to Home. */
export default function Start() {
  const { ready, serverUrl, signedIn } = useSession();
  if (!ready) return <Loading />;
  return <Redirect href={startRoute({ serverUrl, signedIn })} />;
}
