// app/_layout.tsx
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useNavigation } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { DeliveryProvider } from '@/app/context/DeliveryContext';
import { UserProvider } from '@/app/context/UserContext';
import { useColorScheme } from '@/components/useColorScheme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Configure notification handler for iOS/Android
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true, // For iOS
    shouldShowList: true, // Required property for NotificationBehavior
  }),
});

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  const navigation = useNavigation<any>(); // Use 'any' to bypass TypeScript navigation issues

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // Set up notification listeners
  useEffect(() => {
    // Request notification permissions
   
    const requestPermissions = async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        if (status !== 'granted') {
          console.log('Notification permission not granted');
        }
      } catch (error) {
        console.error('Error requesting notification permissions:', error);
      }
    };

    requestPermissions();

    // Listen for notifications received while app is foregrounded
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received in foreground:', notification);
      
      // You can handle foreground notifications here if needed
      // For example, update badge count or show in-app banner
    });

    // Listen for notification taps (when user taps notification)
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as {
        type: string;
        deliveryId: number;
        driverId: number;
      };
      console.log('Notification tapped with data:', data);
      
      // Handle navigation based on notification type
      if (data.type === 'message' || data.type === 'chat_message') {
        // Navigate to notifications or chat screen
        navigation.navigate('(tabs)', {
          screen: 'notifications',
          params: {
            deliveryId: data.deliveryId,
            driverId: data.driverId,
            openChat: true,
          },
        } as any); // Cast to any to bypass TypeScript issues
      } else if (data.type === 'booking_accepted') {
        // Navigate to active delivery screen
        navigation.navigate('customer-dashboard' as any);
      }
      
      // Clear badge count when notification is tapped
      Notifications.setBadgeCountAsync(0);
    });

    return () => {
      // Clean up listeners
      notificationListener.remove();
      responseListener.remove();
    };
  }, [navigation]);

  // Hide Splash Screen when fonts are loaded
  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    // Wrap everything with your context providers
    <UserProvider>
      <DeliveryProvider>
        <RootLayoutNav />
      </DeliveryProvider>
    </UserProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        {/* Login/Signup Screen */}
        <Stack.Screen 
          name="(tabs)" 
          options={{ 
            headerShown: false,
          }} 
        />
        
        {/* Modal for additional features */}
        <Stack.Screen 
          name="modal" 
          options={{ 
            presentation: 'modal',
            gestureEnabled: true
          }} 
        />
        
        {/* Customer Dashboard */}
        <Stack.Screen 
          name="customer-dashboard" 
          options={{ 
            headerShown: false,
          }} 
        />
      </Stack>
    </ThemeProvider>
  );
}
