import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack>
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="extra-stuff" options={{ title: 'Extra Stuff', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
