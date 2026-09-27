import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { colors } from '../lib/theme';

export function Logo() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLabel="Vidalune">
      <Image source={require('../../assets/icon.png')} style={{ width: 40, height: 40, borderRadius: 10 }} />
      <Text style={{ color: colors.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>vidalune</Text>
    </View>
  );
}
