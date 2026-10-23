import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { colors } from '../lib/theme';

/** The logo; `small` in the TV's top bar. */
export function Logo({ small }: { small?: boolean }) {
  const icon = small ? 30 : 40;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: small ? 8 : 10 }} accessibilityLabel="Vidalune">
      <Image source={require('../../assets/icon.png')} style={{ width: icon, height: icon, borderRadius: icon / 4 }} />
      <Text style={{ color: colors.ink, fontSize: small ? 21 : 26, fontWeight: '700', letterSpacing: -0.5 }}>vidalune</Text>
    </View>
  );
}
