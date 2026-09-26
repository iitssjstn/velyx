import { Redirect } from 'expo-router';
import { Loading } from '../components/ui';
import { useSession } from '../lib/session';

/** Where the app starts: choose a server, sign in, or straight to Home. */
export default function Start() {
  const { ready, serverUrl, signedIn } = useSession();
  if (!ready) return <Loading />;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (!signedIn) return <Redirect href="/sign-in" />;
  return <Redirect href="/home" />;
}
