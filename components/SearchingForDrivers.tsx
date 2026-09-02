// components/customer/SearchingForDrivers.tsx

const defaultDriverImage = { uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAACLElEQVR4nO2WQU8TQRjF/7vTS6Pc5gM08W6i3ExkYxA8qgVxW2RaLFgLtIIE0RgvHk0MRo2aSCJ+eDz3QhATwQ/wBnyBJ5gYjL4xmd1mum65pLv06cFNPnQ7M2/mN7uzM7uAmZmZmZn9l9E+B1mLRqJx5rpHv2jTqsstf++3l3YLx3E8EV5XIm7XbX6nxvTg5c2Tde77w9LwxO81o7D7tnoKobEwAGg5p5Zt5nGcP3uG2qLbYf5jNfBzd4D9lA/6+wFfRfiG1P6eVPmCx/8SviA82fq8mfp8UQRU8rJfTkZP1N8uNVBbfJ1Kvq8O5Cl/gF7mqdcF/n0V+CoU3vYq/1MFfJXhU4fHL0r5Q6On84O1+SeY9/viWn5r9B2O71iUn6Y2X90iN0lln1ptPNB+FXia2jyu5U2Bx3g3e2aAlqYyv7e8Q7s4Jf/7l/In3xKb5ZxZlhJfVn0JztFkXGydQ89fnhmjn50S+MLJN3S+NXwB0ovW8KXBk5e5zdfZFr3k09QapbzdAzV0+FbyUeqfpq94a3izd4mPUmx/4G+X9wZvLv4uD2w8v58JXp+P0x49j7cPX8mcZ8IrfAkdWp7q9b/0d0J4A7+O8PigBHhVl0c/wyO8xWJv4alr9Vvn/7MDUUf5c6fpK23CF0v7MvDW4evm6aHF4n8IeK2U2qyTq4YnV7GUp8LP0OTUK2o80Ydp8dNQeN3ld3mJh1P2nddOTVtEeIabgNfgv3TjKwX+dBj8mXx9p4fQyOlwHT79RzEys7I9aM3MzMzMzKx7+xMqj2tLkq3vIgAAAABJRU5ErkJggg==' };
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

// Import your PubNub booking utilities
import { useUser } from '@/app/context/UserContext';
import {
  createPubNubClient,
  listenForBookingResponse,
  listenForDriverLocation,
  publishBookingRequest
} from '@/lib/Pubnub-booking';

const { width, height } = Dimensions.get('window');
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://www.velosdrop.com').replace(/\/$/, '');
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

interface SearchingForDriversProps {
  visible: boolean;
  initialFare: string;
  onFareChange: (newFare: string) => void;
  onCancel: () => void;
  onConfirm: (driver: any) => void;
  packageData: any;
  userLocation: { lat: number; lng: number };
  customerId: number;
  customerUsername: string;
}

interface Driver {
  id: number;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  vehicleType: string;
  carName: string;
  numberPlate: string;
  profilePictureUrl: string;
  distance: number;
  rating: number;
  isOnline: boolean;
  lastLocation: any;
  averageRating?: number;
  totalRatings?: number;
  latitude?: number;
  longitude?: number;
  profile_picture_url?: string;
  totalDeliveries?: number; 
  
}

interface RouteCoordinate {
  latitude: number;
  longitude: number;
}

export default function SearchingForDrivers({
  visible,
  initialFare,
  onFareChange,
  onCancel,
  onConfirm,
  packageData,
  userLocation,
  customerId,
  customerUsername
}: SearchingForDriversProps) {
  const [fare, setFare] = useState(initialFare);
  const [slideAnim] = useState(new Animated.Value(height));
  const [fadeAnim] = useState(new Animated.Value(0));
  const [searchProgress, setSearchProgress] = useState(0);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingFare, setIsUpdatingFare] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [bookingStatus, setBookingStatus] = useState<'searching' | 'waiting' | 'accepted' | 'failed'>('searching');
  const [currentRequestId, setCurrentRequestId] = useState<number | null>(null);
  const [acceptedDriver, setAcceptedDriver] = useState<Driver | null>(null);
  const [acceptedDrivers, setAcceptedDrivers] = useState<Driver[]>([]);
  const [driverLocation, setDriverLocation] = useState<{ 
    longitude: number; 
    latitude: number; 
    heading?: number; 
    speed?: number 
  } | null>(null);
  const [isTrackingDriver, setIsTrackingDriver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<RouteCoordinate[]>([]);
  const [isFetchingRoute, setIsFetchingRoute] = useState(false);
  
  const pubnubRef = useRef<any>(null);
  const mapRef = useRef<MapView>(null);
  const { customer } = useUser();

  // Function to fetch route from Google Directions API
  const fetchRoute = useCallback(async (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) => {
    if (!GOOGLE_MAPS_API_KEY) {
      console.warn('Google Maps API key not configured');
      return [];
    }

    try {
      setIsFetchingRoute(true);
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&key=${GOOGLE_MAPS_API_KEY}&mode=driving`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === 'OK') {
        const points = data.routes[0].overview_polyline.points;
        const decoded = decodePolyline(points);
        setRouteCoordinates(decoded);
        return decoded;
      } else {
        console.error('Directions API error:', data.status);
        // Fallback to straight line if API fails
        return [
          { latitude: origin.lat, longitude: origin.lng },
          { latitude: destination.lat, longitude: destination.lng }
        ];
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      // Fallback to straight line
      return [
        { latitude: origin.lat, longitude: origin.lng },
        { latitude: destination.lat, longitude: destination.lng }
      ];
    } finally {
      setIsFetchingRoute(false);
    }
  }, []);

  // Polyline decoder function (Google Maps encoded polyline)
  const decodePolyline = (encoded: string): RouteCoordinate[] => {
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;
    const coordinates: RouteCoordinate[] = [];
    
    while (index < len) {
      let b;
      let shift = 0;
      let result = 0;
      
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      
      const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += dlat;
      
      shift = 0;
      result = 0;
      
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      
      const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += dlng;
      
      coordinates.push({
        latitude: lat / 1e5,
        longitude: lng / 1e5
      });
    }
    
    return coordinates;
  };

  // Update route when driver location changes
  useEffect(() => {
    if (driverLocation && userLocation) {
      const origin = { lat: driverLocation.latitude, lng: driverLocation.longitude };
      const destination = { lat: userLocation.lat, lng: userLocation.lng };
      
      fetchRoute(origin, destination);
      
      // Fit map to show entire route
      if (mapRef.current && routeCoordinates.length > 0) {
        mapRef.current.fitToCoordinates(routeCoordinates, {
          edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
          animated: true,
        });
      }
    }
  }, [driverLocation, userLocation, fetchRoute]);

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
  }, []);

  // Calculate estimated time for search results (static) - ONLY USED WHEN SEARCHING
  const calculateEstimatedTime = (distance: number) => {
    const estimatedMinutes = Math.ceil((distance / 30) * 60 * 1.3); // 30km/h average with traffic factor
    
    if (estimatedMinutes < 5) return "Less than 5 min";
    if (estimatedMinutes < 10) return `${estimatedMinutes} min`;
    return `${Math.ceil(estimatedMinutes/5)*5} min`;
  };

  // Animation effects
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic) 
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic) 
        })
      ]).start();
      
      // Start search progress animation
      const progressInterval = setInterval(() => {
        setSearchProgress(prev => {
          if (prev >= 100) {
            clearInterval(progressInterval);
            if (drivers.length > 0 && bookingStatus === 'searching') {
              createBookingRequest();
            }
            return 100;
          }
          return prev + 1;
        });
      }, 50);

      return () => clearInterval(progressInterval);
    } else {
      fadeAnim.setValue(0);
      slideAnim.setValue(height);
      setSearchProgress(0);
      setBookingStatus('searching');
      setError(null);
      setRouteCoordinates([]);
    }
  }, [visible, bookingStatus, drivers.length]);

  // Initialize PubNub and fetch nearby drivers
  useEffect(() => {
    if (!customerId || !visible) return;

    const initialize = async () => {
      try {
        let authToken = null;
        try {
          authToken = await SecureStore.getItemAsync('pubnub-auth-token');
        } catch (storageError) {
          console.log('No PubNub auth token in storage');
        }
        
        const pubnubClient = createPubNubClient(
          `customer_${customerId}`,
          authToken || undefined
        );
        pubnubRef.current = pubnubClient;
    
        await fetchNearbyDrivers();
        
        const cleanup1 = listenForBookingResponse(customerId, {
          onBookingAccepted: (message) => {
            console.log('Booking accepted:', message);
            handleBookingAccepted(message.data);
          },
          onBookingRejected: (message) => {
            console.log('Booking rejected:', message);
            handleBookingRejected(message.data);
          },
        });

        const cleanup2 = listenForDriverLocation(undefined, (locationData) => {
          if (acceptedDriver?.id === locationData.driverId) {
            setDriverLocation({
              longitude: locationData.location.longitude,
              latitude: locationData.location.latitude,
              heading: locationData.location.heading,
              speed: locationData.location.speed
            });
            setIsTrackingDriver(true);
          }
        });

        return () => {
          cleanup1();
          cleanup2();
          if (pubnubRef.current) {
            pubnubRef.current.unsubscribeAll();
          }
        };
      } catch (error) {
        console.error('Initialization error:', error);
        setError('Unable to connect to booking service. Please check your connection.');
      }
    };

    initialize();
  }, [customerId, visible, acceptedDriver]);

  // Fetch nearby drivers from your API
  const fetchNearbyDrivers = useCallback(async (isRetry = false) => {
    try {
      if (!userLocation || userLocation.lat === undefined || userLocation.lng === undefined) {
        setError('We need your location to find nearby drivers. Please enable location services.');
        return [];
      }

      setIsLoading(true);
      setError(null);

      const vehicleType = packageData?.vehicleType || null;
      const url = `${API_BASE_URL}/api/drivers/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=5&excludeResponded=true${vehicleType ? `&vehicleType=${vehicleType}` : ''}`;

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Unable to find drivers at this time.');
      }

      const nearbyDrivers = await response.json();

      const transformedDrivers: Driver[] = (Array.isArray(nearbyDrivers) ? nearbyDrivers : []).map((driver: any) => ({
        id: driver.id || driver.driverId || Math.random(),
        firstName: driver.firstName || driver.first_name || 'Driver',
        lastName: driver.lastName || driver.last_name || '',
        phoneNumber: driver.phoneNumber || driver.phone_number || '',
        vehicleType: driver.vehicleType || driver.vehicle_type || 'car',
        carName: driver.carName || driver.car_name || 'Vehicle',
        numberPlate: driver.numberPlate || driver.number_plate || '',
        profilePictureUrl: driver.profilePictureUrl || driver.profile_picture_url || 'https://via.placeholder.com/150',
        distance: driver.distance || driver.distance_km || 0,
        isOnline: driver.isOnline || driver.is_online || true,
        lastLocation: driver.lastLocation || driver.last_location || null,
        averageRating: driver.averageRating || 0,  // ✅ Real rating from DB
        rating: driver.averageRating || 0,         // ✅ Same here
        totalDeliveries: driver.totalDeliveries || driver.total_deliveries || 0,
        latitude: driver.latitude || (driver.lastLocation?.latitude || userLocation.lat),
        longitude: driver.longitude || (driver.lastLocation?.longitude || userLocation.lng),
      }));

      setDrivers(transformedDrivers);
      setIsLoading(false);
      
      if (isRetry && transformedDrivers.length > 0) {
        setTimeout(() => {
          createBookingRequest();
        }, 1000);
      }
      
      return transformedDrivers;
    } catch (error) {
      console.error('Error finding drivers:', error);
      setError('Unable to find drivers in your area. Please try again.');
      setIsLoading(false);
      return [];
    }
  }, [userLocation, packageData?.vehicleType]);

  // Create booking request and publish to PubNub
  const createBookingRequest = useCallback(async (selectedDriver: Driver | null = null) => {
    try {
      setBookingStatus('waiting');
      setIsLoading(true);

      const pickupLng = packageData.pickupCoords?.[0] || userLocation.lng;
      const pickupLat = packageData.pickupCoords?.[1] || userLocation.lat;
      const dropoffLng = packageData.deliveryCoords?.[0] || userLocation.lng;
      const dropoffLat = packageData.deliveryCoords?.[1] || userLocation.lat;

      if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
        throw new Error('Please check your pickup and dropoff locations.');
      }

      const bookingData = {
        customerId,
        customerUsername,
        pickupAddress: packageData.pickupAddress || packageData.pickupLocation,
        pickupLatitude: pickupLat,
        pickupLongitude: pickupLng,
        dropoffAddress: packageData.dropoffAddress || packageData.deliveryLocation,
        dropoffLatitude: dropoffLat,
        dropoffLongitude: dropoffLng,
        fare: parseFloat(fare),
        distance: packageData.routeDistance || 0,
        packageDetails: packageData.packageDescription || '',
        vehicleType: packageData.vehicleType || 'car',
        recipientPhone: packageData.recipientPhone || '',
        userLocation: userLocation,
        ...(selectedDriver && { selectedDriverId: selectedDriver.id })
      };

      const response = await fetch(`${API_BASE_URL}/api/bookings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bookingData),
      });

      if (!response.ok) {
        throw new Error('Unable to create booking. Please try again.');
      }

      const result = await response.json();
      const bookingId = result.request?.id || result.bookingId || result.id;
      setCurrentRequestId(bookingId);

      let driverIds: number[] = [];
      
      if (selectedDriver) {
        driverIds = [selectedDriver.id];
      } else {
        if (drivers.length > 0) {
          driverIds = drivers.map(driver => driver.id);
        } else {
          const freshDrivers = await fetchNearbyDrivers();
          if (freshDrivers.length > 0) {
            driverIds = freshDrivers.map(driver => driver.id);
          }
        }
      }

      if (driverIds.length > 0) {
        await publishBookingRequest(driverIds, {
          bookingId: bookingId,
          customerId: customerId,
          customerUsername: customerUsername,
          customerProfilePictureUrl: customer?.profilePictureUrl || '',
          customerPhoneNumber: customer?.phoneNumber || '',
          recipientPhoneNumber: packageData.recipientPhone || '',
          pickupAddress: bookingData.pickupAddress,
          pickupLatitude: bookingData.pickupLatitude,
          pickupLongitude: bookingData.pickupLongitude,
          dropoffAddress: bookingData.dropoffAddress,
          dropoffLatitude: bookingData.dropoffLatitude,
          dropoffLongitude: bookingData.dropoffLongitude,
          fare: bookingData.fare,
          distance: bookingData.distance,
          vehicleType: bookingData.vehicleType,
          packageDetails: bookingData.packageDetails,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          isDirectAssignment: !!selectedDriver
        });
      } else {
        setBookingStatus('failed');
        setError('No drivers available nearby. Please try again later.');
      }
      
      setIsLoading(false);
      
    } catch (error) {
      console.error('Booking error:', error);
      setBookingStatus('failed');
      setError('Unable to send booking request. Please check your connection and try again.');
      setIsLoading(false);
    }
  }, [customerId, customerUsername, fare, packageData, userLocation, drivers, customer]);

  // Handle booking accepted
  const handleBookingAccepted = (data: any) => {
    console.log('🎉 Driver accepted booking:', data);
    console.log('📋 Current drivers array:', drivers.map(d => ({ id: d.id, plate: d.numberPlate })));
    
    setBookingStatus('accepted');
    setIsLoading(false);
    
    // Find the accepted driver from the current drivers list
    const acceptedDriverFromList = drivers.find(driver => driver.id === data.driverId);
    
    console.log('🔍 Found driver in list?', acceptedDriverFromList ? 'YES' : 'NO');
    
    if (acceptedDriverFromList) {
      console.log('✅ Driver found! Number plate:', acceptedDriverFromList.numberPlate);
      setAcceptedDriver(acceptedDriverFromList);
      setAcceptedDrivers([acceptedDriverFromList]);
      setIsTrackingDriver(true);
      
      // Fetch initial route when driver is accepted
      if (acceptedDriverFromList.lastLocation) {
        setDriverLocation({
          latitude: acceptedDriverFromList.lastLocation.latitude,
          longitude: acceptedDriverFromList.lastLocation.longitude
        });
        
        // Fetch initial route
        fetchRoute(
          { lat: acceptedDriverFromList.lastLocation.latitude, lng: acceptedDriverFromList.lastLocation.longitude },
          { lat: userLocation.lat, lng: userLocation.lng }
        );
      }
    } else {
      console.warn('❌ Driver not found in list! drivers.length:', drivers.length);
      console.warn('Looking for driverId:', data.driverId);
      
      // BETTER FALLBACK: Fetch the driver details from API
      fetchDriverDetails(data.driverId);
    }
  };
  
  // Add this new function to fetch driver details
  const fetchDriverDetails = async (driverId: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/driver/${driverId}`);
      if (!response.ok) throw new Error('Failed to fetch driver');
      
      const driverData = await response.json();
      
      const driver: Driver = {
        id: driverData.id,
        firstName: driverData.firstName || driverData.first_name,
        lastName: driverData.lastName || driverData.last_name,
        phoneNumber: driverData.phoneNumber || driverData.phone_number,
        vehicleType: driverData.vehicleType || driverData.vehicle_type,
        carName: driverData.carName || driverData.car_name,
        numberPlate: driverData.numberPlate || driverData.number_plate, // ✅ From database
        profilePictureUrl: driverData.profilePictureUrl || driverData.profile_picture_url,
        distance: 0,
        rating: driverData.averageRating || 4.5,
        isOnline: true,
        lastLocation: null,
        totalRatings: driverData.totalRatings || 0
      };
      
      console.log('✅ Fetched driver from API, plate:', driver.numberPlate);
      setAcceptedDriver(driver);
      setAcceptedDrivers([driver]);
      setIsTrackingDriver(true);
    } catch (error) {
      console.error('Failed to fetch driver details:', error);
    }
  };
  
  // Handle booking rejected
  const handleBookingRejected = (data: any) => {
    console.log('Booking rejected:', data);
    setIsLoading(false);
    
    if (data.expired) {
      setBookingStatus('failed');
      setError('No drivers accepted your request. Please try again with a different fare or vehicle type.');
    } else if (data.rejected) {
      setBookingStatus('searching');
      setError('Driver unavailable. Finding other drivers...');
      
      setTimeout(() => {
        setError(null);
        fetchNearbyDrivers(true);
      }, 2000);
    }
  };

  // Handle driver selection
  const handleSelectDriver = (driver: Driver) => {
    setSelectedDriver(driver.id);
    createBookingRequest(driver);
  };

  // Handle fare adjustment
  const handleFareAdjust = (amount: number) => {
    const currentFare = parseFloat(fare) || 0;
    const newFare = Math.max(2.00, currentFare + amount).toFixed(2);
    setFare(newFare);
    onFareChange(newFare);
  };

  // Handle fare update
  const handleUpdateFare = async () => {
    setIsUpdatingFare(true);
    await fetchNearbyDrivers();
    setTimeout(() => setIsUpdatingFare(false), 1000);
  };

  // Handle retry
  const handleRetry = () => {
    setError(null);
    setBookingStatus('searching');
    setSearchProgress(0);
    setCurrentRequestId(null);
    setAcceptedDriver(null);
    setAcceptedDrivers([]);
    setSelectedDriver(null);
    setDriverLocation(null);
    setIsTrackingDriver(false);
    setRouteCoordinates([]);
    fetchNearbyDrivers();
  };

  // Call driver
  const callDriver = (phoneNumber: string) => {
    Linking.openURL(`tel:${phoneNumber}`).catch(err => 
      Alert.alert('Call Failed', 'Unable to make a call. Please try again or use another phone.')
    );
  };

  // Get vehicle type label
  const vehicleTypeLabel = packageData?.vehicleType ? 
    packageData.vehicleType.charAt(0).toUpperCase() + packageData.vehicleType.slice(1) : 
    'All Vehicles';

  // Show loading overlay
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent={true}
      onRequestClose={onCancel}
      statusBarTranslucent={true}
    >
      <BlurView intensity={90} style={StyleSheet.absoluteFill} tint="dark" />
      
      <Animated.View 
        style={[
          styles.container,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }]
          }
        ]}
      >
        <View style={styles.panel}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onCancel} style={styles.backButton}>
              <Ionicons name="close" size={22} color="#A855F7" />
            </TouchableOpacity>
            
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>
                {bookingStatus === 'waiting' ? 'Waiting for Driver' :
                 bookingStatus === 'accepted' ? 'Driver Accepted!' : 'Finding Drivers'}
              </Text>
              <Text style={styles.headerSubtitle}>
                {bookingStatus === 'waiting' ? 'Request sent to driver' :
                 bookingStatus === 'accepted' ? 'Your driver is coming!' : 'Looking for the best match'}
              </Text>
              {packageData?.vehicleType && (
                <View style={styles.vehicleBadge}>
                  <Text style={styles.vehicleBadgeText}>
                    🚗 {vehicleTypeLabel}
                  </Text>
                </View>
              )}
            </View>
            
            <View style={styles.driverCount}>
              <Text style={styles.driverCountText}>
                {acceptedDrivers.length > 0 ? acceptedDrivers.length : drivers.length}
              </Text>
            </View>
          </View>

          <ScrollView 
            style={styles.scrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <View style={styles.errorContent}>
                  <Ionicons name="information-circle" size={22} color="#FBBF24" />
                  <View style={styles.errorTextContainer}>
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity
                      onPress={handleRetry}
                      style={styles.retryButton}
                    >
                      <Text style={styles.retryText}>Try Again</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

            {/* Waiting for Driver Response */}
            {bookingStatus === 'waiting' && selectedDriver && (
              <View style={styles.waitingContainer}>
                <View style={styles.waitingHeader}>
                  <Text style={styles.waitingTitle}>Request Sent!</Text>
                  <View style={styles.pulseDot} />
                </View>
                
                <View style={styles.driverWaitingInfo}>
                  <Image
                    source={{ uri: drivers.find(d => d.id === selectedDriver)?.profilePictureUrl || defaultDriverImage.uri }}
                    style={styles.driverImage}
                    defaultSource={defaultDriverImage}
                  />
                  <View style={styles.driverWaitingDetails}>
                    <Text style={styles.driverWaitingName}>
                      {drivers.find(d => d.id === selectedDriver)?.firstName} {drivers.find(d => d.id === selectedDriver)?.lastName}
                    </Text>
                    <Text style={styles.driverWaitingStatus}>Waiting for response...</Text>
                    <Text style={styles.driverWaitingTime}>Please wait 30 seconds</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Driver Tracking Section */}
            {bookingStatus === 'accepted' && acceptedDriver && (
              <View style={styles.trackingContainer}>
                <View style={styles.trackingHeader}>
                  <View style={styles.trackingTitleContainer}>
                    <Text style={styles.trackingTitle}>Driver is on the way!</Text>
                    <Ionicons name="car" size={20} color="#10B981" />
                  </View>
                  <View style={styles.liveIndicator}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>Live tracking</Text>
                  </View>
                </View>
                
                {/* Larger Map */}
                <View style={styles.mapContainer}>
                  <MapView
                    ref={mapRef}
                    style={styles.map}
                    initialRegion={{
                      latitude: userLocation.lat,
                      longitude: userLocation.lng,
                      latitudeDelta: 0.0922,
                      longitudeDelta: 0.0421,
                    }}
                  >
                    {/* Pickup Marker */}
                    <Marker
                      coordinate={{
                        latitude: userLocation.lat,
                        longitude: userLocation.lng,
                      }}
                      title="Pickup"
                      description={packageData.pickupAddress}
                    >
                      <View style={styles.pickupMarker}>
                        <Ionicons name="location" size={20} color="#7C3AED" />
                      </View>
                    </Marker>
                    
                    {/* Driver Marker */}
                    {driverLocation && (
                      <Marker
                        coordinate={{
                          latitude: driverLocation.latitude,
                          longitude: driverLocation.longitude,
                        }}
                        title="Driver"
                        description={acceptedDriver.firstName}
                        rotation={driverLocation.heading || 0}
                      >
                        <View style={styles.driverMarker}>
                          <Ionicons name="car" size={20} color="#10B981" />
                        </View>
                      </Marker>
                    )}
                    
                    {/* Route Line - Following Roads */}
                    {routeCoordinates.length > 0 && (
                      <Polyline
                        coordinates={routeCoordinates}
                        strokeColor="#7C3AED"
                        strokeWidth={4}
                        lineCap="round"
                        lineJoin="round"
                      />
                    )}
                    
                    {/* Straight line fallback (only show if no route coordinates) */}
                    {routeCoordinates.length === 0 && driverLocation && (
                      <Polyline
                        coordinates={[
                          { latitude: userLocation.lat, longitude: userLocation.lng },
                          { latitude: driverLocation.latitude, longitude: driverLocation.longitude },
                        ]}
                        strokeColor="#7C3AED"
                        strokeWidth={3}
                        lineDashPattern={[10, 10]}
                      />
                    )}
                  </MapView>
                  
                  {/* Route Loading Indicator */}
                  {isFetchingRoute && (
                    <View style={styles.routeLoading}>
                      <ActivityIndicator size="small" color="#7C3AED" />
                      <Text style={styles.routeLoadingText}>Calculating route...</Text>
                    </View>
                  )}
                </View>
                
                {/* Driver Information - Compact Design */}
                <View style={styles.driverInfo}>
                  <View style={styles.driverProfile}>
                    <Image
                      source={{ 
                        uri: acceptedDriver?.profilePictureUrl || 
                              acceptedDriver?.profile_picture_url || 
                              'https://via.placeholder.com/150' 
                      }}
                      style={styles.acceptedDriverImage}
                      defaultSource={defaultDriverImage}
                    />
                    <View style={styles.driverProfileDetails}>
                      <Text style={styles.driverName}>
                        {acceptedDriver.firstName} {acceptedDriver.lastName}
                      </Text>
                      <Text style={styles.driverRole}>Your driver</Text>
                      <View style={styles.driverStats}>
                        <View style={styles.driverStat}>
                          <Ionicons name="star" size={12} color="#FBBF24" />
                          <Text style={styles.driverStatText}>{acceptedDriver.rating?.toFixed(1) || '4.5'}</Text>
                        </View>
                        <View style={styles.driverStat}>
                          <Ionicons name="call" size={12} color="#9CA3AF" />
                          <Text style={styles.driverStatText}>{acceptedDriver.phoneNumber}</Text>
                        </View>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.callButton}
                      onPress={() => callDriver(acceptedDriver.phoneNumber)}
                    >
                      <Ionicons name="call" size={18} color="white" />
                    </TouchableOpacity>
                  </View>
                  
                  {/* Vehicle Info - Compact Grid */}
                  <View style={styles.vehicleInfoGrid}>
                    <View style={styles.vehicleInfoCard}>
                      <Ionicons name="car-sport" size={16} color="#9CA3AF" />
                      <Text style={styles.vehicleInfoLabel}>Vehicle</Text>
                      <Text style={styles.vehicleInfoValue}>{acceptedDriver.carName}</Text>
                      <Text style={styles.vehicleInfoSubtext}>{acceptedDriver.vehicleType}</Text>
                    </View>
                    <View style={styles.vehicleInfoCard}>
                      <Ionicons name="receipt" size={16} color="#9CA3AF" />
                      <Text style={styles.vehicleInfoLabel}>License Plate</Text>
                      <Text style={styles.vehicleInfoPlate}>{acceptedDriver.numberPlate || 'N/A'}</Text>
                    </View>
                  </View>
                  
                  {/* Tracking Status */}
                  {isTrackingDriver && driverLocation && (
                    <View style={styles.trackingStatus}>
                      <View style={styles.trackingStatusHeader}>
                        <Ionicons name="navigate" size={14} color="#10B981" />
                        <Text style={styles.trackingStatusText}>Live tracking active</Text>
                      </View>
                      <View style={styles.trackingDetails}>
                        {driverLocation.heading && (
                          <View style={styles.trackingDetail}>
                            <Text style={styles.trackingDetailLabel}>Direction</Text>
                            <Text style={styles.trackingDetailValue}>{driverLocation.heading}°</Text>
                          </View>
                        )}
                        {driverLocation.speed && (
                          <View style={styles.trackingDetail}>
                            <Text style={styles.trackingDetailLabel}>Speed</Text>
                            <Text style={styles.trackingDetailValue}>
                              {(driverLocation.speed * 3.6).toFixed(0)} km/h
                            </Text>
                          </View>
                        )}
                        {routeCoordinates.length > 0 && (
                          <View style={styles.trackingDetail}>
                            <Text style={styles.trackingDetailLabel}>Route</Text>
                            <Text style={styles.trackingDetailValue}>Following roads</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}
                </View>

                {/* Centered X Button with Purple Hover Effect */}
                <View style={styles.centeredXButtonContainer}>
                  <TouchableOpacity 
                    style={styles.centeredXButton}
                    onPress={onCancel}
                  >
                    <Ionicons name="close" size={24} color="white" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Progress Bar */}
            {bookingStatus !== 'accepted' && (
              <View style={styles.progressContainer}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressTitle}>Finding available drivers</Text>
                  <Text style={styles.progressPercent}>{searchProgress}%</Text>
                </View>
                <View style={styles.progressBar}>
                  <Animated.View 
                    style={[
                      styles.progressFill,
                      { width: `${searchProgress}%` }
                    ]}
                  />
                </View>
              </View>
            )}

            {/* Fare Offer Section */}
            {bookingStatus !== 'accepted' && (
              <View style={styles.fareContainer}>
                <View style={styles.fareHeader}>
                  <Text style={styles.fareTitle}>Your Fare Offer</Text>
                  <Ionicons name="cash-outline" size={20} color="#A855F7" />
                </View>
                
                <View style={styles.fareControls}>
                  <TouchableOpacity
                    style={styles.fareButton}
                    onPress={() => handleFareAdjust(-1)}
                    disabled={parseFloat(fare) <= 2.00}
                  >
                    <Ionicons name="remove" size={22} color="#EF4444" />
                  </TouchableOpacity>
                  
                  <View style={styles.fareDisplay}>
                    <Text style={styles.fareSymbol}>$</Text>
                    <Text style={styles.fareAmount}>{fare}</Text>
                  </View>
                  
                  <TouchableOpacity
                    style={styles.fareButton}
                    onPress={() => handleFareAdjust(1)}
                  >
                    <Ionicons name="add" size={22} color="#10B981" />
                  </TouchableOpacity>
                </View>
                
                <TouchableOpacity
                  style={styles.updateFareButton}
                  onPress={handleUpdateFare}
                  disabled={isUpdatingFare}
                >
                  {isUpdatingFare ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={16} color="white" />
                      <Text style={styles.updateFareText}>Update Search</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Available Drivers Section */}
            {drivers.length > 0 && bookingStatus === 'searching' && (
              <View style={styles.driversContainer}>
                <View style={styles.driversHeader}>
                  <Text style={styles.driversTitle}>Available Drivers</Text>
                  <View style={styles.driversCount}>
                    <Text style={styles.driversCountText}>{drivers.length} nearby</Text>
                  </View>
                </View>
                
                {drivers.map((driver) => (
  <TouchableOpacity
    key={driver.id}
    style={[
      styles.driverCard,
      selectedDriver === driver.id && styles.driverCardSelected
    ]}
    onPress={() => handleSelectDriver(driver)}
  >
    <View style={styles.driverCardLeft}>
      <Image
        source={{ 
          uri: driver.profilePictureUrl || 
                driver.profile_picture_url || 
                'https://via.placeholder.com/150' 
        }}
        style={styles.driverCardImage}
        defaultSource={defaultDriverImage}
      />
      <View style={styles.driverCardInfo}>
        {/* Name */}
        <Text style={styles.driverCardName}>
          {driver.firstName} {driver.lastName}
        </Text>
        
        {/* Row 1: Vehicle Only (Distance removed from here) */}
        <View style={styles.driverCardDetails}>
          <View style={styles.driverDetail}>
            <Ionicons name="car" size={12} color="#9CA3AF" />
            <Text style={styles.driverDetailText}>
               {driver.vehicleType} • {driver.carName}
            </Text>
          </View>
        </View>
  
        {/* Row 2: Plate & Deliveries */}
        <View style={styles.driverBottomInfo}>
          <Text style={styles.driverCardPlate}>{driver.numberPlate || 'No Plate'}</Text>
          <Text style={styles.separatorText}>•</Text>
          <View style={styles.miniDeliveryBadge}>
             <Ionicons name="cube-outline" size={11} color="#A855F7" />
             <Text style={styles.miniDeliveryText}>
               {driver.totalDeliveries || 0} Deliveries
             </Text>
          </View>
        </View>
      </View>
    </View>
  
    {/* Right Side - Time TOP, Distance BOTTOM */}
    <View style={styles.driverCardRight}>
      <Text style={styles.driverTime}>
        {calculateEstimatedTime(driver.distance)}
      </Text> 
      <Text style={styles.driverDistanceRight}>
        {driver.distance?.toFixed(1)} km
      </Text>
    </View>
  </TouchableOpacity>
))}
              </View>
            )}

            {/* No Drivers Found */}
            {drivers.length === 0 && searchProgress >= 100 && !error && bookingStatus !== 'accepted' && (
              <View style={styles.noDriversContainer}>
                <Ionicons name="search-outline" size={48} color="#7C3AED" />
                <Text style={styles.noDriversTitle}>No Drivers Found</Text>
                <Text style={styles.noDriversText}>
                  {packageData?.vehicleType 
                    ? `No ${packageData.vehicleType} drivers in your area right now. Try adjusting your fare or selecting a different vehicle type.`
                    : 'No drivers available nearby. Try increasing your fare or search again in a few minutes.'
                  }
                </Text>
                <TouchableOpacity
                  style={styles.retrySearchButton}
                  onPress={handleRetry}
                >
                  <Text style={styles.retrySearchText}>Search Again</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Action Buttons - Hidden when driver accepted */}
            {bookingStatus !== 'accepted' && (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={onCancel}
                >
                  <Ionicons name="close" size={20} color="white" />
                </TouchableOpacity>
                
                {drivers.length > 0 && bookingStatus === 'searching' && (
                  <TouchableOpacity
                    style={styles.broadcastButton}
                    onPress={() => createBookingRequest()}
                    disabled={isLoading}
                  >
                    <Ionicons name="radio" size={20} color="white" />
                    <Text style={styles.broadcastButtonText}>
                      {isLoading ? 'Sending...' : 'Send to All Drivers'}
                    </Text>
                    <View style={styles.broadcastBadge}>
                      <Text style={styles.broadcastBadgeText}>{drivers.length}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            )}
            
            {/* Bottom padding */}
            <View style={{ height: Platform.OS === 'ios' ? 30 : 20 }} />
          </ScrollView>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    marginTop: Platform.OS === 'ios' ? 50 : 30,
  },
  panel: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#A855F7',
    marginTop: 2,
    textAlign: 'center',
  },
  vehicleBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  vehicleBadgeText: {
    fontSize: 11,
    color: '#A855F7',
    fontWeight: '500',
  },
  driverCount: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverCountText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: 'white',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
  },
  errorContainer: {
    marginBottom: 16,
    padding: 14,
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.3)',
  },
  errorContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  errorTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#FBBF24',
    lineHeight: 20,
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    alignSelf: 'flex-start',
  },
  retryText: {
    fontSize: 13,
    color: '#FBBF24',
    fontWeight: '500',
  },
  waitingContainer: {
    marginBottom: 16,
    padding: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  waitingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  waitingTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#60A5FA',
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#60A5FA',
  },
  driverWaitingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: '#60A5FA',
  },
  driverWaitingDetails: {
    flex: 1,
    marginLeft: 12,
  },
  driverWaitingName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 4,
  },
  driverWaitingStatus: {
    fontSize: 14,
    color: '#60A5FA',
    marginBottom: 2,
  },
  driverWaitingTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  trackingContainer: {
    marginBottom: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  trackingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  trackingTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  trackingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#10B981',
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  liveText: {
    fontSize: 12,
    color: '#10B981',
  },
  mapContainer: {
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  routeLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeLoadingText: {
    color: 'white',
    marginTop: 8,
    fontSize: 14,
  },
  pickupMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  driverMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  driverInfo: {
    gap: 12,
  },
  driverProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
  },
  acceptedDriverImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#10B981',
  },
  driverProfileDetails: {
    flex: 1,
    marginLeft: 12,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 2,
  },
  driverRole: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 6,
  },
  driverStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  driverStatText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  callButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleInfoGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  vehicleInfoCard: {
    flex: 1,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 12,
  },
  vehicleInfoLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
    marginBottom: 4,
  },
  vehicleInfoValue: {
    fontSize: 15,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 2,
  },
  vehicleInfoSubtext: {
    fontSize: 12,
    color: '#6B7280',
  },
  vehicleInfoPlate: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  trackingStatus: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  trackingStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    gap: 6,
  },
  trackingStatusText: {
    fontSize: 13,
    color: '#10B981',
    fontWeight: '500',
  },
  trackingDetails: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  trackingDetail: {
    alignItems: 'center',
  },
  trackingDetailLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  trackingDetailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#10B981',
  },
  // Centered X Button Container
  centeredXButtonContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  centeredXButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  progressContainer: {
    marginBottom: 24,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 15,
    color: '#A855F7',
    fontWeight: '500',
  },
  progressPercent: {
    fontSize: 15,
    color: '#A855F7',
    fontWeight: 'bold',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#1F2937',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 3,
  },
  fareContainer: {
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  fareHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  fareTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#7C3AED',
  },
  fareControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 20,
  },
  fareButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  fareDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  fareSymbol: {
    fontSize: 22,
    color: '#A855F7',
    fontWeight: 'bold',
    marginRight: 4,
  },
  fareAmount: {
    fontSize: 42,
    color: 'white',
    fontWeight: 'bold',
  },
  updateFareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
    gap: 8,
  },
  updateFareText: {
    fontSize: 14,
    color: '#A855F7',
    fontWeight: '500',
  },
  driversContainer: {
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  driversHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  driversTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#7C3AED',
  },
  driversCount: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  driversCountText: {
    fontSize: 13,
    color: 'white',
    fontWeight: '600',
  },
  driverCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  driverCardSelected: {
    borderColor: '#7C3AED',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
  },
  driverCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  driverDistanceRight: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  driverCardImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#374151',
  },
  driverCardInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  separatorText: {
    color: '#4B5563',
    marginHorizontal: 6,
    fontSize: 10,
  },
  miniDeliveryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.15)', // Light Purple BG
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  miniDeliveryText: {
    fontSize: 10,
    color: '#10B981', // Purple Text
    fontWeight: '600',
  },
  driverCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
    marginBottom: 4,
  },
  driverCardDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  driverBottomInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  driverDetailText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  driverCardPlate: {
    fontSize: 12,
    color: '#A855F7',
    fontWeight: '500',
  },
  driverCardRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 8,
  },
  driverTime: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '600',
    marginBottom: 2,
  },
  deliveryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.8)', // Darker background for contrast
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 1)',
    gap: 4, // Spacing between icon and text
  },
  driverRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  driverRatingText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  driverDeliveriesText: { // Renamed from driverDeliveries to avoid conflicts
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  noDriversContainer: {
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  noDriversTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#7C3AED',
    marginTop: 16,
    marginBottom: 8,
  },
  noDriversText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  retrySearchButton: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retrySearchText: {
    fontSize: 15,
    color: 'white',
    fontWeight: '600',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  cancelButton: {
    width: 60,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  broadcastButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
    position: 'relative',
  },
  broadcastButtonText: {
    fontSize: 15,
    color: 'white',
    fontWeight: 'bold',
  },
  broadcastBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverDeliveries: {
    fontSize: 11,
    color: '#9CA3AF',
    marginLeft: 4,
  },
  broadcastBadgeText: {
    fontSize: 11,
    color: 'white',
    fontWeight: 'bold',
  },
});