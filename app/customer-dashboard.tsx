//app/customer-dashboard.tsx
import { useDelivery } from '@/app/context/DeliveryContext';
import { useUser } from '@/app/context/UserContext';
import BookingPanel from '@/components/BookingPanel';
import CustomerMap from '@/components/CustomerMap';
import FeedbackSection from '@/components/FeedbackSection';
import HelpCenterSection from '@/components/HelpCenterSection';
import NotificationsSection from '@/components/NotificationsSection';
import OrdersSection from '@/components/OrdersSection';
import RatingModal from '@/components/RatingModal';
import SettingsSection from '@/components/SettingsSection';
import { uploadCustomerProfilePicture } from '@/lib/uploadCustomerProfilePicture';
import { executeTursoQuery } from '@/src/db';
import { fetchActiveDeliveryAndDriver } from '@/utils/databaseHelper';
import { Feather, FontAwesome5, Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

const { width, height } = Dimensions.get('window');
const isTablet = width >= 768;

export default function CustomerDashboard() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [showBookingPanel, setShowBookingPanel] = useState(false);
  const [pickupLocation, setPickupLocation] = useState<{longitude: number; latitude: number; address?: string} | undefined>();
  const [deliveryLocation, setDeliveryLocation] = useState<{longitude: number; latitude: number; address?: string} | undefined>();
  const [driverLocation, setDriverLocation] = useState<{
    longitude: number; 
    latitude: number; 
    heading?: number; 
    eta?: number;
    driverId?: number;
  } | null>(null);
  
  // Initial state logic: Tablet always open, Phone starts closed
  const [isSidebarOpen, setIsSidebarOpen] = useState(isTablet);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [activeDelivery, setActiveDelivery] = useState<any>(null);
  
  // Feedback related state
  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [completedDelivery, setCompletedDelivery] = useState<{
    deliveryId: number;
    driverId: number;
    driverName: string;
    driverProfilePicture?: string | null;
  } | null>(null);
  
  // Animation values
  const sidebarAnim = useState(new Animated.Value(isSidebarOpen ? 1 : 0))[0];
  const pulseAnim = useState(new Animated.Value(1))[0];
  
  const navigation = useNavigation();
  const { customer, clearUser, updateProfilePicture, isLoading: userLoading } = useUser();
  const { deliveryData, setDeliveryData } = useDelivery();

  // Pulse animation for Book Now button
  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    
    pulseAnimation.start();
    
    return () => pulseAnimation.stop();
  }, []);

  // Fetch active delivery and driver location from database
  useEffect(() => {
    const fetchDeliveryData = async () => {
      if (!customer) return;
      
      try {
        const { activeDelivery, driverLocation } = await fetchActiveDeliveryAndDriver(customer.id);
        setActiveDelivery(activeDelivery);
        setDriverLocation(driverLocation);
      } catch (error) {
        console.error('Error fetching delivery data:', error);
      }
    };
    
    if (customer) {
      fetchDeliveryData();
    }
  }, [customer]);

  // Listen for recently completed deliveries
  useEffect(() => {
    if (!customer) return;
    
    const checkCompletedDeliveries = async () => {
      try {
        const result = await executeTursoQuery(
          `SELECT dr.id, dr.driver_id, 
                  d.first_name || ' ' || d.last_name as driver_name,
                  d.profile_picture_url
           FROM delivery_requests dr
           LEFT JOIN drivers d ON dr.driver_id = d.id
           WHERE dr.customer_id = ? 
           AND dr.status IN ('completed', 'delivered')
           AND dr.customer_confirmed_at IS NULL
           AND datetime(dr.delivery_completed_at) >= datetime('now', '-30 minutes')
           ORDER BY dr.delivery_completed_at DESC
           LIMIT 1`,
          [customer.id]
        );
        
        const rows = result[0]?.results?.rows || [];
        const cols = result[0]?.results?.columns || [];
        
        if (rows.length > 0) {
          const row = rows[0];
          const item: any = {};
          cols.forEach((col: string, index: number) => {
            item[col] = row[index];
          });
          
          setCompletedDelivery({
            deliveryId: item.id,
            driverId: item.driver_id,
            driverName: item.driver_name,
            driverProfilePicture: item.profile_picture_url
          });
          setShowRatingModal(true);
        }
      } catch (error) {
        console.error('Error checking completed deliveries:', error);
      }
    };
    
    // Check immediately and then every 15 seconds
    checkCompletedDeliveries();
    const interval = setInterval(checkCompletedDeliveries, 15000);
    
    return () => clearInterval(interval);
  }, [customer]);

  useEffect(() => {
    console.log('📱 Dashboard useEffect running...');
    console.log('🔍 Customer in context:', customer);
    console.log('🔄 User loading state:', userLoading);
    
    // Wait for UserContext to finish loading
    if (userLoading) {
      console.log('⏳ UserContext is still loading, waiting...');
      return;
    }
    
    // Now check if customer exists
    if (!customer) {
      console.log('❌ No customer found after UserContext loaded, redirecting...');
      router.replace('/(tabs)');
      return;
    }

    console.log('✅ Customer found in context:', customer.username);
    
    // Set profile image if available
    if (customer.profilePictureUrl) {
      setProfileImage(customer.profilePictureUrl);
    } else {
      setProfileImage(null);
    }

    // If we have delivery data from booking panel, update the map
    if (deliveryData) {
      console.log('📍 Setting locations from delivery data:', deliveryData);
      setPickupLocation({
        longitude: deliveryData.pickup.coordinates[0],
        latitude: deliveryData.pickup.coordinates[1],
        address: deliveryData.pickup.address
      });
      setDeliveryLocation({
        longitude: deliveryData.delivery.coordinates[0],
        latitude: deliveryData.delivery.coordinates[1],
        address: deliveryData.delivery.address
      });
    }

    setIsLoading(false);
  }, [customer, deliveryData, userLoading]);

  // Sidebar animation logic
  useEffect(() => {
    Animated.timing(sidebarAnim, {
      toValue: isSidebarOpen ? 1 : 0,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [isSidebarOpen]);

  // Define the interpolation for the sidebar position
  const sidebarLeft = sidebarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 0.8, 0],
  });

  // Camera function
  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera permissions to take photos');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await handleUploadProfilePicture(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  // Gallery pick function
  const pickImage = async () => {
    try {
      // Request permissions
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera roll permissions to upload photos');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        await handleUploadProfilePicture(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  // Main upload function
  const handleUploadProfilePicture = async (localImageUri: string) => {
    try {
      setIsUploading(true);

      if (!customer?.id) {
        throw new Error('Customer ID not found');
      }

      console.log('📤 Uploading profile picture for customer:', customer.id);

      // Upload to Cloudinary
      const uploadedImageUrl = await uploadCustomerProfilePicture(
        localImageUri,
        customer.id
      );

      console.log('✅ Customer profile image uploaded:', uploadedImageUrl);

      // Update local state with Cloudinary URL
      setProfileImage(uploadedImageUrl);

      // Update in UserContext (this updates database too)
      await updateProfilePicture(uploadedImageUrl);

      Alert.alert('Success', 'Profile picture updated successfully!');
      
    } catch (error: any) {
      console.error('❌ Profile upload error:', error);
      
      let errorMessage = 'Failed to upload profile picture';
      if (error.message.includes('Network request failed')) {
        errorMessage = 'Network error. Check your internet connection.';
      } else if (error.message.includes('Cloudinary configuration')) {
        errorMessage = 'Upload service configuration error.';
      } else if (error.message.includes('Upload failed')) {
        errorMessage = 'Upload failed. Please try again.';
      }
      
      Alert.alert('Upload Failed', errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  // Image selection options
  const showImageOptions = () => {
    Alert.alert(
      'Update Profile Picture',
      'Choose an option',
      [
        { text: 'Take Photo', onPress: takePhoto },
        { text: 'Choose from Gallery', onPress: pickImage },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            // Clear all customer data from SecureStore
            await SecureStore.deleteItemAsync('customerData');
            await SecureStore.deleteItemAsync('customer-auth-token');
            
            // Clear user context
            clearUser();
            
            console.log('✅ Customer logged out, redirecting to login...');
            router.replace('/(tabs)');
          }
        }
      ]
    );
  };

  const handleBookDelivery = () => {
    console.log('📝 Opening Booking Panel...');
    setShowBookingPanel(true);
  };

  const handleCloseBookingPanel = () => {
    console.log('❌ Closing Booking Panel...');
    setShowBookingPanel(false);
  };

  const handleLocationsSelected = (pickup: any, delivery: any) => {
    console.log('📍 Locations selected:', { pickup, delivery });
    
    if (pickup) {
      setPickupLocation({
        longitude: pickup.coordinates[0],
        latitude: pickup.coordinates[1],
        address: pickup.address
      });
    }
    
    if (delivery) {
      setDeliveryLocation({
        longitude: delivery.coordinates[0],
        latitude: delivery.coordinates[1],
        address: delivery.address
      });
    }
  };

  const handleSectionChange = (sectionId: string) => {
    setActiveSection(sectionId);
    if (!isTablet) {
      setIsSidebarOpen(false);
    }
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const handleRatingModalClose = () => {
    setShowRatingModal(false);
    setCompletedDelivery(null);
  };

  const handleRatingSubmit = () => {
    setShowRatingModal(false);
    setCompletedDelivery(null);
    setPendingFeedbackCount(prev => prev + 1);
    
    // Refresh feedback section if it's open
    if (activeSection === 'feedback') {
      // Force re-render by toggling the section
      setActiveSection('dashboard');
      setTimeout(() => setActiveSection('feedback'), 50);
    }
  };

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'orders':
        return <OrdersSection />;
      case 'settings':
        return <SettingsSection />;
      case 'notifications':
        return <NotificationsSection />;
      case 'help': 
        return <HelpCenterSection />;
      case 'feedback':
        return (
          <FeedbackSection 
            customerId={customer?.id || 0}
            onPendingCountChange={setPendingFeedbackCount}
          />
        );
      default:
        // DASHBOARD / MAP SECTION
        return (
          <View style={{ flex: 1, position: 'relative' }}>
            {/* Full Screen Map Container */}
            <CustomerMap
              pickupLocation={pickupLocation}
              deliveryLocation={deliveryLocation}
              driverLocation={driverLocation}
              customerProfile={customer ? {
                id: customer.id,
                username: customer.username,
                profilePictureUrl: customer.profilePictureUrl
              } : undefined}
              showRoute={true}
              showCurrentLocation={true}
              style={{
                flex: 1,
              }}
            />
            
            {/* Gradient overlay at bottom for better button visibility */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 150,
                zIndex: 5
              }}
              pointerEvents="none"
            />

            {/* Book Now Button - Bottom Center */}
            <View style={{
              position: 'absolute',
              bottom: 70,
              left: 0,
              right: 0,
              alignItems: 'center',
              zIndex: 10,
            }}>
              <Animated.View style={{
                transform: [{ scale: pulseAnim }],
                width: '80%',
                maxWidth: 350,
              }}>
                <TouchableOpacity
                  onPress={handleBookDelivery}
                  style={{
                    backgroundColor: '#7c3aed',
                    paddingVertical: 18,
                    borderRadius: 30,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#a855f7',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.5,
                    shadowRadius: 12,
                    elevation: 10,
                  }}
                >
                  <Text style={{ fontSize: 20, color: 'white', fontWeight: 'bold', letterSpacing: 0.5 }}>
                    Book
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          </View>
        );
    }
  };

  // Show loading state while checking authentication
  if (userLoading || isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#030712', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#a855f7" />
          <Text style={{ color: '#a855f7', fontSize: 18, marginTop: 16 }}>Loading your dashboard...</Text>
          <Text style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>Please wait a moment</Text>
        </View>
      </View>
    );
  }

  // Also add an early return if no customer after loading
  if (!customer) {
    return null; // Will redirect in useEffect
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#030712' }}>
      <StatusBar barStyle="light-content" backgroundColor="#030712" />
      
      {/* Main Container */}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Sidebar Overlay for mobile */}
        {!isTablet && isSidebarOpen && (
          <TouchableOpacity
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 40,
            }}
            onPress={() => setIsSidebarOpen(false)}
            activeOpacity={1}
          />
        )}

        {/* Sidebar */}
        <Animated.View 
          style={{
            width: isTablet ? 280 : width * 0.8,
            backgroundColor: '#111827',
            borderRightWidth: 1,
            borderRightColor: 'rgba(147, 51, 234, 0.3)',
            flexDirection: 'column',
            shadowColor: '#a855f7',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.1,
            shadowRadius: 20,
            elevation: 10,
            zIndex: 50,
            position: isTablet ? 'relative' : 'absolute',
            left: isTablet ? 0 : sidebarLeft,
            height: '100%',
          }}
        >
          <LinearGradient
            colors={['#1e1b4b', '#111827']}
            style={{ 
              flex: 1,
              paddingTop: Platform.OS === 'android' ? 40 : 20 
            }}
          >
            {/* Mobile Close Button */}
            {!isTablet && (
              <View style={{ 
                alignItems: 'flex-end', 
                paddingRight: 16, 
                paddingTop: 16,
                zIndex: 60,
              }}>
                <TouchableOpacity
                  onPress={() => setIsSidebarOpen(false)}
                  style={{
                    padding: 8,
                    borderRadius: 12,
                    backgroundColor: 'rgba(31, 41, 55, 0.5)',
                    borderWidth: 1,
                    borderColor: 'rgba(147, 51, 234, 0.3)',
                  }}
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={24} color="#a855f7" />
                </TouchableOpacity>
              </View>
            )}

            {/* Profile Section */}
            <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(147, 51, 234, 0.3)' }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ position: 'relative' }}>
                  <TouchableOpacity
                    onPress={showImageOptions}
                    disabled={isUploading}
                    style={{
                      width: 100,
                      height: 100,
                      borderRadius: 50,
                      overflow: 'hidden',
                      borderWidth: 3,
                      borderColor: 'rgba(168, 85, 247, 0.8)',
                      shadowColor: '#a855f7',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 20,
                    }}
                  >
                    {profileImage ? (
                      <Image
                        source={{ uri: profileImage }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={{ width: '100%', height: '100%', backgroundColor: 'rgba(168, 85, 247, 0.5)', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="person" size={48} color="#a855f7" />
                      </View>
                    )}
                    {isUploading && (
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', alignItems: 'center', justifyContent: 'center' }}>
                        <ActivityIndicator color="#a855f7" />
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={showImageOptions}
                    disabled={isUploading}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      right: 0,
                      backgroundColor: '#7c3aed',
                      borderRadius: 20,
                      padding: 10,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 8,
                      elevation: 5,
                    }}
                  >
                    <Ionicons name="camera" size={18} color="white" />
                  </TouchableOpacity>
                </View>
                
                <Text style={{ marginTop: 16, fontSize: 20, fontWeight: '600', color: 'white' }}>
                  {customer.username}
                </Text>
                <Text style={{ fontSize: 14, color: '#9ca3af', marginTop: 4 }}>{customer.phoneNumber}</Text>
              </View>
            </View>

            {/* Navigation */}
            <ScrollView style={{ flex: 1, padding: 16 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 10 }}>
                {[
                  {
                    id: 'dashboard',
                    name: 'Dashboard',
                    icon: (active: boolean) => (
                      <MaterialIcons 
                        name="dashboard" 
                        size={22} 
                        color={active ? '#c084fc' : '#9ca3af'} 
                      />
                    )
                  },
                  {
                    id: 'orders',
                    name: 'Orders',
                    icon: (active: boolean) => (
                      <FontAwesome5 
                        name="shopping-bag" 
                        size={20} 
                        color={active ? '#c084fc' : '#9ca3af'} 
                      />
                    )
                  },
                  {
                    id: 'notifications',
                    name: 'Notifications',
                    icon: (active: boolean) => (
                      <View style={{ position: 'relative' }}>
                        <Ionicons 
                          name="notifications" 
                          size={22} 
                          color={active ? '#c084fc' : '#9ca3af'} 
                        />
                        {unreadMessageCount > 0 && (
                          <View style={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            minWidth: 20,
                            height: 20,
                            backgroundColor: '#7c3aed',
                            borderRadius: 10,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 2,
                            borderColor: '#111827',
                          }}>
                            <Text style={{ fontSize: 10, color: 'white', fontWeight: 'bold' }}>
                              {unreadMessageCount > 9 ? '9+' : unreadMessageCount}
                            </Text>
                          </View>
                        )}
                      </View>
                    )
                  },
                  {
                    id: 'feedback',
                    name: 'Your Feedback',
                    icon: (active: boolean) => (
                      <View style={{ position: 'relative' }}>
                        <MaterialIcons 
                          name="rate-review" 
                          size={22} 
                          color={active ? '#c084fc' : '#9ca3af'} 
                        />
                        {pendingFeedbackCount > 0 && (
                          <View style={{
                            position: 'absolute',
                            top: -6,
                            right: -8,
                            minWidth: 20,
                            height: 20,
                            backgroundColor: '#7c3aed',
                            borderRadius: 10,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: 2,
                            borderColor: '#111827',
                          }}>
                            <Text style={{ fontSize: 10, color: 'white', fontWeight: 'bold' }}>
                              {pendingFeedbackCount > 9 ? '9+' : pendingFeedbackCount}
                            </Text>
                          </View>
                        )}
                      </View>
                    )
                  },
                  {
                    id: 'help',
                    name: 'Help Center',
                    icon: (active: boolean) => (
                      <MaterialIcons 
                        name="help-center" 
                        size={22} 
                        color={active ? '#c084fc' : '#9ca3af'} 
                      />
                    )
                  },
                  {
                    id: 'settings',
                    name: 'Settings',
                    icon: (active: boolean) => (
                      <Ionicons 
                        name="settings" 
                        size={22} 
                        color={active ? '#c084fc' : '#9ca3af'} 
                      />
                    )
                  }
                ].map((item) => {
                  const isActive = activeSection === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => handleSectionChange(item.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                        borderRadius: 14,
                        backgroundColor: isActive ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                        borderWidth: 1,
                        borderColor: isActive ? 'rgba(168, 85, 247, 0.3)' : 'transparent',
                      }}
                    >
                      {item.icon(isActive)}
                      <Text style={{
                        marginLeft: 14,
                        fontWeight: '500',
                        fontSize: 16,
                        color: isActive ? 'white' : '#9ca3af',
                      }}>
                        {item.name}
                      </Text>
                      {isActive && (
                        <View style={{ marginLeft: 'auto' }}>
                          <View style={{
                            width: 8,
                            height: 8,
                            backgroundColor: '#a855f7',
                            borderRadius: 4,
                          }} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Logout Button at Bottom */}
            <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: 'rgba(147, 51, 234, 0.3)' }}>
              <TouchableOpacity
                onPress={handleLogout}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(239, 68, 68, 0.2)',
                  borderWidth: 1,
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  paddingVertical: 14,
                  borderRadius: 14,
                  shadowColor: '#ef4444',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.2,
                  shadowRadius: 8,
                  elevation: 5,
                }}
              >
                <MaterialIcons name="logout" size={20} color="#f87171" />
                <Text style={{ 
                  color: '#f87171', 
                  fontWeight: '600', 
                  fontSize: 16, 
                  marginLeft: 12 
                }}>
                  Logout
                </Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Main Content */}
        <View style={{ flex: 1, flexDirection: 'column' }}>
          {/* Header */}
          <LinearGradient
            colors={['#1e1b4b', '#111827']}
            style={{
              borderBottomWidth: 1,
              borderBottomColor: 'rgba(147, 51, 234, 0.3)',
              paddingHorizontal: 16,
              paddingTop: Platform.OS === 'android' ? 45 : 20,
              paddingBottom: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 10,
              elevation: 3,
              zIndex: 20,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                {/* Mobile Menu Button */}
                {!isTablet && (
                  <TouchableOpacity
                    onPress={toggleSidebar}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      backgroundColor: 'rgba(31, 41, 55, 0.5)',
                      borderWidth: 1,
                      borderColor: 'rgba(147, 51, 234, 0.3)',
                    }}
                  >
                    <Feather 
                      name="menu" 
                      size={24} 
                      color="#a855f7" 
                    />
                  </TouchableOpacity>
                )}
                
                <Text style={{
                  fontSize: 22,
                  fontWeight: 'bold',
                  color: 'white',
                }}>
                  {activeSection === 'feedback' 
                    ? 'Your Feedback' 
                    : activeSection === 'notifications' && unreadMessageCount > 0 
                    ? `Messages (${unreadMessageCount} unread)`
                    : activeSection.charAt(0).toUpperCase() + activeSection.slice(1)
                  }
                </Text>
              </View>
              
              {activeSection === 'dashboard' && pickupLocation && deliveryLocation && (
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: 'rgba(31, 41, 55, 0.5)',
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: 'rgba(147, 51, 234, 0.3)',
                }}>
                  <Text style={{ color: '#10b981', fontWeight: '600', fontSize: 16 }}>A</Text>
                  <MaterialIcons name="arrow-forward" size={18} color="#9ca3af" style={{ marginHorizontal: 10 }} />
                  <Text style={{ color: '#ef4444', fontWeight: '600', fontSize: 16 }}>B</Text>
                </View>
              )}
            </View>
          </LinearGradient>

          {/* Content Area */}
          <LinearGradient
            colors={['#030712', '#0f172a']}
            style={{ 
              flex: 1, 
              padding: activeSection === 'dashboard' ? 0 : 16 
            }}
          >
            {renderActiveSection()}
          </LinearGradient>
        </View>
      </View>

      {/* Booking Panel Modal */}
      <BookingPanel
        visible={showBookingPanel}
        onClose={handleCloseBookingPanel}
        onLocationsSelected={handleLocationsSelected}
      />

      {/* Rating Modal - Auto appears when delivery is completed */}
      {completedDelivery && customer && (
        <RatingModal
          visible={showRatingModal}
          onClose={handleRatingModalClose}
          onSubmit={handleRatingSubmit}
          deliveryId={completedDelivery.deliveryId}
          driverId={completedDelivery.driverId}
          driverName={completedDelivery.driverName}
          driverProfilePicture={completedDelivery.driverProfilePicture}
          customerId={customer.id}
        />
      )}
    </SafeAreaView>
  );
}