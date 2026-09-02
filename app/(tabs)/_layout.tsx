//app/(tabs)/_layout.tsx
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import React from 'react';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        // 👇 REMOVE ALL HEADERS IN THE TABS
        headerShown: false,
        // 👇 HIDE THE TAB BAR ITSELF
        tabBarStyle: { display: 'none' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          // 👇 REMOVE "TAB ONE" TITLE
          title: '',
          // 👇 REMOVE THE TAB BAR ICON
          tabBarIcon: () => null,
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          // 👇 REMOVE "TAB TWO" TITLE
          title: '',
          // 👇 REMOVE THE TAB BAR ICON
          tabBarIcon: () => null,
        }}
      />
    </Tabs>
  );
}
