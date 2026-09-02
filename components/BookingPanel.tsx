//components/BookingPanel.tsx
import { useDelivery } from '@/app/context/DeliveryContext';
import { useUser } from '@/app/context/UserContext';
import PackageDetails from '@/components/PackageDetails';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';

interface BookingPanelProps {
  visible: boolean;
  onClose: () => void;
  onLocationsSelected?: (pickup: any, delivery: any) => void;
}

interface LocationSuggestion {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

const { width, height } = Dimensions.get('window');
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// Calculate safe area for the floating button
const BOTTOM_INSET = Platform.OS === 'ios' ? 34 : 20;

// Helper function to decode polyline
const decodePolyline = (encoded: string) => {
  const points: {latitude: number, longitude: number}[] = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
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

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5
    });
  }
  return points;
};

export default function BookingPanel({ visible, onClose, onLocationsSelected }: BookingPanelProps) {
  const [currentStep, setCurrentStep] = useState<'booking' | 'package-details'>('booking');
  
  // Inputs
  const [pickupLocation, setPickupLocation] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  
  // Coordinates
  const [pickupCoords, setPickupCoords] = useState<[number, number] | null>(null);
  const [deliveryCoords, setDeliveryCoords] = useState<[number, number] | null>(null);
  
  // Suggestions
  const [pickupSuggestions, setPickupSuggestions] = useState<LocationSuggestion[]>([]);
  const [deliverySuggestions, setDeliverySuggestions] = useState<LocationSuggestion[]>([]);
  
  // UI States
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<{latitude: number, longitude: number}[]>([]);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [focusedInput, setFocusedInput] = useState<'pickup' | 'delivery' | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const [mapRegion, setMapRegion] = useState({
    latitude: -17.8252,
    longitude: 31.0522,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });

  const { customer } = useUser();
  const { setDeliveryData } = useDelivery();

  // Refs
  const pickupTimeoutRef = useRef<number | null>(null);
  const deliveryTimeoutRef = useRef<number | null>(null);
  const skipNextPickupFetch = useRef(false);
  const skipNextDeliveryFetch = useRef(false);
  const hasAutoLocatedRef = useRef(false);
  const mapRef = useRef<MapView>(null);
  const pickupInputRef = useRef<TextInput>(null);
  const deliveryInputRef = useRef<TextInput>(null);

  // --- Google Maps Logic ---

  const getAddressFromCoords = async (lat: number, lng: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`
      );
      const data = await response.json();
      if (data.status === 'OK' && data.results.length > 0) {
        return data.results[0].formatted_address;
      }
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch (error) {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  };

  const getPlaceDetails = async (placeId: string): Promise<{ coords: [number, number]; address: string } | null> => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}&fields=geometry,formatted_address`
      );
      const data = await response.json();
      if (data.status === 'OK') {
        const { lat, lng } = data.result.geometry.location;
        return {
          coords: [lng, lat] as [number, number],
          address: data.result.formatted_address
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  };

  const fetchSuggestions = async (
    query: string,
    setSuggestions: React.Dispatch<React.SetStateAction<LocationSuggestion[]>>,
    isPickup: boolean = false
  ) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      let locationBias = '';
      if (isPickup && pickupCoords) {
        locationBias = `&location=${pickupCoords[1]},${pickupCoords[0]}&radius=50000`;
      } else if (!isPickup && deliveryCoords) {
        locationBias = `&location=${deliveryCoords[1]},${deliveryCoords[0]}&radius=50000`;
      }

      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}${locationBias}&components=country:zw`;

      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === 'OK') {
        setSuggestions(data.predictions.slice(0, 4));
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      setSuggestions([]);
    }
  };

  // --- Effects ---

  // Auto-locate on open
  useEffect(() => {
    if (!hasAutoLocatedRef.current && visible) {
      hasAutoLocatedRef.current = true;
      setTimeout(() => {
        getCurrentLocation();
      }, 300);
    }
  }, [visible]);

  // Debounced Search for pickup
  useEffect(() => {
    if (skipNextPickupFetch.current) {
      skipNextPickupFetch.current = false;
      return;
    }
    if (pickupTimeoutRef.current) clearTimeout(pickupTimeoutRef.current);
    pickupTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(pickupLocation, setPickupSuggestions, true);
    }, 200) as unknown as number;
    
    return () => {
      if (pickupTimeoutRef.current) clearTimeout(pickupTimeoutRef.current);
    };
  }, [pickupLocation]);

  // Debounced Search for delivery
  useEffect(() => {
    if (skipNextDeliveryFetch.current) {
      skipNextDeliveryFetch.current = false;
      return;
    }
    if (deliveryTimeoutRef.current) clearTimeout(deliveryTimeoutRef.current);
    deliveryTimeoutRef.current = setTimeout(() => {
      fetchSuggestions(deliveryLocation, setDeliverySuggestions, false);
    }, 200) as unknown as number;
    
    return () => {
      if (deliveryTimeoutRef.current) clearTimeout(deliveryTimeoutRef.current);
    };
  }, [deliveryLocation]);

  // Clear suggestions when losing focus
  useEffect(() => {
    if (!focusedInput) {
      const timer = setTimeout(() => {
        setPickupSuggestions([]);
        setDeliverySuggestions([]);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [focusedInput]);

  // --- Handlers ---

  const getCurrentLocation = async () => {
    setIsLocating(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setIsLocating(false);
        return;
      }

      let location = await Location.getCurrentPositionAsync({ 
        accuracy: Location.Accuracy.Balanced,
      });
      
      const { latitude, longitude } = location.coords;
      const coords: [number, number] = [longitude, latitude];
      
      setPickupCoords(coords);
      skipNextPickupFetch.current = true;
      
      const address = await getAddressFromCoords(latitude, longitude);
      setPickupLocation(address);
      setPickupSuggestions([]);

      setMapRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01 * (width / height),
      });

      setIsLocating(false);
    } catch (error) {
      setIsLocating(false);
    }
  };

  const handleSuggestionClick = async (suggestion: LocationSuggestion, isPickup: boolean) => {
    Keyboard.dismiss();
    setFocusedInput(null);

    const displayAddress = suggestion.structured_formatting?.main_text 
        ? `${suggestion.structured_formatting.main_text}, ${suggestion.structured_formatting.secondary_text}`
        : suggestion.description;

    if (isPickup) {
      skipNextPickupFetch.current = true;
      setPickupLocation(displayAddress);
      setPickupSuggestions([]);
    } else {
      skipNextDeliveryFetch.current = true;
      setDeliveryLocation(displayAddress);
      setDeliverySuggestions([]);
    }

    setTimeout(async () => {
      const placeDetails = await getPlaceDetails(suggestion.place_id);
      if (!placeDetails) return;

      const { coords, address } = placeDetails;

      if (isPickup) {
        setPickupCoords(coords);
        setPickupLocation(address);
        
        setMapRegion({
          latitude: coords[1],
          longitude: coords[0],
          latitudeDelta: 0.01,
          longitudeDelta: 0.01 * (width / height),
        });
        
        if (deliveryCoords) {
          calculateRouteWithPoints(coords, deliveryCoords);
        }
      } else {
        setDeliveryCoords(coords);
        setDeliveryLocation(address);
        
        if (pickupCoords) {
          calculateRouteWithPoints(pickupCoords, coords);
        }
      }
    }, 0);
  };

  const calculateRouteWithPoints = async (start: [number, number], end: [number, number]) => {
    setIsCalculatingRoute(true);
    
    const midPoint = {
      latitude: (start[1] + end[1]) / 2,
      longitude: (start[0] + end[0]) / 2,
    };
    
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        ...midPoint,
        latitudeDelta: Math.abs(start[1] - end[1]) * 1.5,
        longitudeDelta: Math.abs(start[0] - end[0]) * 1.5 * (width / height),
      }, 350);
    }

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=${start[1]},${start[0]}&destination=${end[1]},${end[0]}&key=${GOOGLE_API_KEY}&mode=driving`
      );
      const data = await response.json();
      
      if (data.status === 'OK') {
        const route = data.routes[0];
        setRouteDistance(route.legs[0].distance.value / 1000);

        const points: {latitude: number, longitude: number}[] = [];
        if (route.overview_polyline?.points) {
          points.push(...decodePolyline(route.overview_polyline.points));
        } else {
          route.legs[0].steps.forEach((step: any) => {
            points.push(...decodePolyline(step.polyline.points));
          });
        }
        setRouteCoordinates(points);

        if (mapRef.current && points.length > 0) {
          mapRef.current.fitToCoordinates(
            [
              { latitude: start[1], longitude: start[0] },
              { latitude: end[1], longitude: end[0] }
            ],
            { 
              edgePadding: { top: 60, right: 40, bottom: 120, left: 40 }, // Adjusted bottom padding for floating button
              animated: true 
            }
          );
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsCalculatingRoute(false);
    }
  };

  const handleSubmitBooking = () => {
    if (!pickupCoords || !deliveryCoords) return;
    
    if (setDeliveryData) {
      setDeliveryData({
        pickup: { address: pickupLocation, coordinates: pickupCoords },
        delivery: { address: deliveryLocation, coordinates: deliveryCoords },
        distance: routeDistance
      });
    }
    
    setCurrentStep('package-details');
  };

  const handleBackToBooking = () => setCurrentStep('booking');
  
  const handleFinalClose = () => { 
    setCurrentStep('booking'); 
    onClose(); 
  };
  
  const handleConfirmFare = () => handleFinalClose();

  if (currentStep === 'package-details') {
    return (
      <PackageDetails
        visible={visible}
        customerPhone={customer?.phoneNumber || ''}
        pickupLocation={pickupLocation}
        deliveryLocation={deliveryLocation}
        pickupCoords={pickupCoords}
        deliveryCoords={deliveryCoords}
        routeDistance={routeDistance}
        onBack={handleBackToBooking}
        onClose={handleFinalClose}
        onConfirmFare={handleConfirmFare}
      />
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeAreaContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          {/* Main Content Container */}
          <View style={styles.mainContainer}>
            
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={22} color="#9CA3AF" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>New Delivery</Text>
              <TouchableOpacity 
                onPress={getCurrentLocation} 
                style={styles.locationButton}
                disabled={isLocating}
              >
                {isLocating ? (
                  <ActivityIndicator size="small" color="#7C3AED" />
                ) : (
                  <Ionicons name="locate" size={20} color="#7C3AED" />
                )}
              </TouchableOpacity>
            </View>

            {/* Inputs Area */}
            <View style={styles.inputArea}>
              <View style={styles.inputWrapper}>
                <View style={styles.inputIcon}>
                  <Ionicons name="ellipse" size={10} color="#10B981" />
                </View>
                <TextInput
                  ref={pickupInputRef}
                  style={[styles.input, focusedInput === 'pickup' && styles.inputFocused]}
                  value={pickupLocation}
                  onChangeText={setPickupLocation}
                  onFocus={() => setFocusedInput('pickup')}
                  onBlur={() => setFocusedInput(null)}
                  placeholder="Pickup location"
                  placeholderTextColor="#6B7280"
                  returnKeyType="next"
                  onSubmitEditing={() => deliveryInputRef.current?.focus()}
                  blurOnSubmit={false}
                />
              </View>

              <View style={styles.inputDivider} />

              <View style={styles.inputWrapper}>
                <View style={styles.inputIcon}>
                  <Ionicons name="square" size={10} color="#EF4444" />
                </View>
                <TextInput
                  ref={deliveryInputRef}
                  style={[styles.input, focusedInput === 'delivery' && styles.inputFocused]}
                  value={deliveryLocation}
                  onChangeText={setDeliveryLocation}
                  onFocus={() => setFocusedInput('delivery')}
                  onBlur={() => setFocusedInput(null)}
                  placeholder="Delivery location"
                  placeholderTextColor="#6B7280"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmitBooking}
                />
              </View>
            </View>

            {/* Suggestions */}
            {(pickupSuggestions.length > 0 && focusedInput === 'pickup') && (
              <View style={styles.suggestionsContainer}>
                {pickupSuggestions.map((item) => (
                  <TouchableOpacity
                    key={item.place_id}
                    style={styles.suggestionItem}
                    onPress={() => handleSuggestionClick(item, true)}
                  >
                    <Ionicons name="location-outline" size={18} color="#10B981" style={styles.suggestionIcon} />
                    <View style={styles.suggestionTextContainer}>
                      <Text style={styles.suggestionMainText} numberOfLines={1}>
                        {item.structured_formatting?.main_text || item.description.split(',')[0]}
                      </Text>
                      <Text style={styles.suggestionSecondaryText} numberOfLines={1}>
                        {item.structured_formatting?.secondary_text || item.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {(deliverySuggestions.length > 0 && focusedInput === 'delivery') && (
              <View style={styles.suggestionsContainer}>
                {deliverySuggestions.map((item) => (
                  <TouchableOpacity
                    key={item.place_id}
                    style={styles.suggestionItem}
                    onPress={() => handleSuggestionClick(item, false)}
                  >
                    <Ionicons name="location-outline" size={18} color="#EF4444" style={styles.suggestionIcon} />
                    <View style={styles.suggestionTextContainer}>
                      <Text style={styles.suggestionMainText} numberOfLines={1}>
                        {item.structured_formatting?.main_text || item.description.split(',')[0]}
                      </Text>
                      <Text style={styles.suggestionSecondaryText} numberOfLines={1}>
                        {item.structured_formatting?.secondary_text || item.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Map Container - Takes ALL remaining space */}
            <View style={styles.mapContainer}>
              <MapView
                ref={mapRef}
                provider={PROVIDER_GOOGLE}
                style={styles.map}
                region={mapRegion}
                showsUserLocation={true}
                showsMyLocationButton={false}
                scrollEnabled={true}
                zoomEnabled={true}
                loadingEnabled={true}
                loadingIndicatorColor="#7C3AED"
                loadingBackgroundColor="#0F172A"
                // Add padding to bottom so Google logo/legal isn't hidden behind button
                mapPadding={{ top: 0, right: 0, bottom: 80, left: 0 }}
              >
                {pickupCoords && (
                  <Marker
                    coordinate={{ latitude: pickupCoords[1], longitude: pickupCoords[0] }}
                    pinColor="#10B981"
                    title="Pickup"
                  />
                )}
                
                {deliveryCoords && (
                  <Marker
                    coordinate={{ latitude: deliveryCoords[1], longitude: deliveryCoords[0] }}
                    pinColor="#EF4444"
                    title="Delivery"
                  />
                )}
                
                {routeCoordinates.length > 0 && (
                  <Polyline 
                    coordinates={routeCoordinates} 
                    strokeColor="#7C3AED" 
                    strokeWidth={4} 
                  />
                )}
              </MapView>

              {isCalculatingRoute && (
                <View style={styles.routeLoading}>
                  <ActivityIndicator size="small" color="#7C3AED" />
                  <Text style={styles.routeLoadingText}>Calculating route...</Text>
                </View>
              )}
            </View>

            {/* FLOATING BUTTON OVERLAY - Positioned absolutely at bottom */}
            <View style={styles.floatingButtonContainer}>
              <TouchableOpacity
                style={[
                  styles.continueButton, 
                  (!pickupCoords || !deliveryCoords) && styles.continueButtonDisabled
                ]}
                onPress={handleSubmitBooking}
                disabled={!pickupCoords || !deliveryCoords}
                activeOpacity={0.8}
              >
                <Text style={styles.continueButtonText}>
                  {routeDistance ? `Continue (${routeDistance.toFixed(1)} km)` : 'Continue'}
                </Text>
                <Ionicons name="arrow-forward" size={20} color="white" />
              </TouchableOpacity>
            </View>
          
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeAreaContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  keyboardView: {
    flex: 1,
  },
  mainContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 20) + 10 : 10,
    paddingBottom: 12,
    backgroundColor: '#0F172A',
    zIndex: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputArea: {
    backgroundColor: '#1E293B',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 14,
    padding: 2,
    borderWidth: 1,
    borderColor: '#334155',
    zIndex: 15,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    width: 30,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    color: 'white',
    fontSize: 16,
    height: '100%',
    paddingVertical: 0,
  },
  inputFocused: {},
  inputDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginHorizontal: 14,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 140, 
    left: 16,
    right: 16,
    backgroundColor: '#1E293B',
    borderRadius: 14,
    maxHeight: 200,
    zIndex: 100,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  suggestionIcon: {
    marginRight: 12,
  },
  suggestionTextContainer: {
    flex: 1,
  },
  suggestionMainText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  suggestionSecondaryText: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 14,
  },
  mapContainer: {
    flex: 1, 
    marginTop: 8,
    backgroundColor: '#0F172A',
    width: '100%',
    overflow: 'hidden'
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%'
  },
  routeLoading: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  routeLoadingText: {
    color: '#7C3AED',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  // New Styles for Floating Button
  floatingButtonContainer: {
    position: 'absolute',
    bottom: BOTTOM_INSET + 10, // Safe area + margin
    left: 16,
    right: 16,
    zIndex: 50,
  },
  continueButton: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 8,
  },
  continueButtonDisabled: {
    backgroundColor: '#374151',
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

