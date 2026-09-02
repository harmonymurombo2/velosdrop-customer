//components/CustomerMap.tsx
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, {
  LatLng,
  MapViewProps,
  Marker,
  PROVIDER_GOOGLE,
  Polyline,
  Region
} from 'react-native-maps';

// Types matching your database schema
interface MapLocation {
  longitude: number;
  latitude: number;
  address?: string;
}

// Updated to match your UserContext (profilePictureUrl)
interface CustomerProfile {
  id?: number;
  username?: string;
  profilePicture?: string;     // Legacy
  profilePictureUrl?: string;  // Matches UserContext
}

interface CustomerMapProps {
  pickupLocation?: MapLocation;
  deliveryLocation?: MapLocation;
  driverLocation?: {
    longitude: number;
    latitude: number;
    heading?: number;
    speed?: number;
    route?: any;
    eta?: number;
    driverName?: string;
    vehicleType?: string;
  } | null;
  customerLocation?: MapLocation;
  customerProfile?: CustomerProfile;
  showRoute?: boolean;
  showCurrentLocation?: boolean;
  onLocationUpdate?: (location: MapLocation) => void;
  onCustomerLocationUpdate?: (location: MapLocation) => void;
  customerId?: number;
  style?: MapViewProps['style'];
  isTrackingEnabled?: boolean;
}

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.0922;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// Default to Harare, Zimbabwe
const DEFAULT_REGION: Region = {
  latitude: -17.8292,
  longitude: 31.0522,
  latitudeDelta: LATITUDE_DELTA,
  longitudeDelta: LONGITUDE_DELTA,
};

// Helper function to decode polyline (returns array of coordinates)
const decodePolyline = (encoded: string): LatLng[] => {
  const points: LatLng[] = [];
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

// Calculate distance using Haversine formula
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Calculate ETA based on distance and average speed (40 km/h)
const calculateETA = (distanceKm: number): number => {
  const averageSpeed = 40; // km/h
  const timeHours = distanceKm / averageSpeed;
  return Math.round(timeHours * 60); // Convert to minutes
};

// --- CUSTOM MARKER COMPONENT TO FIX BLINKING ---
// Separating this ensures internal state manages the repaint logic
const StableCustomerMarker = ({ coordinate, profileUrl }: { coordinate: LatLng, profileUrl?: string | null }) => {
  // We keep tracksViewChanges true initially to let the image load, then false to stop blinking
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    // If coordinate changes, we briefly allow tracking to smooth the movement, then lock it
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 500); // Allow 500ms for movement update
    return () => clearTimeout(timer);
  }, [coordinate.latitude, coordinate.longitude]);

  return (
    <Marker
      coordinate={coordinate}
      title="You"
      tracksViewChanges={tracksViewChanges}
      zIndex={10}
    >
      <View style={styles.customerMarker}>
        {profileUrl ? (
          <Image 
            source={{ uri: profileUrl }}
            style={styles.customerImage}
            resizeMode="cover"
            onLoadEnd={() => {
              // Once image loads, stop tracking changes to prevent blinking
              setTracksViewChanges(false);
            }}
          />
        ) : (
          <View style={styles.customerIcon}>
            <MaterialIcons name="person" size={20} color="#fff" />
          </View>
        )}
      </View>
    </Marker>
  );
};

export default function CustomerMap({
  pickupLocation,
  deliveryLocation,
  driverLocation,
  customerLocation,
  customerProfile,
  showRoute = true,
  showCurrentLocation = true,
  onLocationUpdate,
  onCustomerLocationUpdate,
  customerId,
  style,
  isTrackingEnabled = true,
}: CustomerMapProps) {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [driverRouteCoordinates, setDriverRouteCoordinates] = useState<LatLng[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [customerEta, setCustomerEta] = useState<number | null>(null);
  const [customerDistance, setCustomerDistance] = useState<number | null>(null);
  const [liveCustomerLocation, setLiveCustomerLocation] = useState<MapLocation | null>(customerLocation || null);
  const [isLocating, setIsLocating] = useState(false);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);

  // Initialize map and start location tracking
  useEffect(() => {
    const initMap = async () => {
      try {
        // Request location permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status !== 'granted') {
          setError('Location permission denied');
          setIsLoading(false);
          return;
        }

        // Get initial location
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const { latitude, longitude } = location.coords;
        const newLocation = { latitude, longitude };
        
        setCurrentLocation(newLocation);
        setLiveCustomerLocation({
          longitude,
          latitude,
          address: 'Current Location'
        });
        
        // Update map region
        setRegion({
          ...newLocation,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01 * ASPECT_RATIO,
        });

        // Callback for location update
        if (onLocationUpdate) {
          onLocationUpdate({
            longitude,
            latitude,
            address: 'Current Location',
          });
        }

        // Start location tracking if enabled
        if (isTrackingEnabled) {
          startLocationTracking();
        }

        setIsLoading(false);
      } catch (err) {
        console.error('Map initialization error:', err);
        setError('Failed to initialize map');
        setIsLoading(false);
      }
    };
    
    initMap();

    return () => {
      // Cleanup tracking
      setIsTracking(false);
    };
  }, [isTrackingEnabled]);

  // Fetch route from Google Directions API
  const fetchRoute = async (origin: LatLng, destination: LatLng): Promise<LatLng[]> => {
    if (!GOOGLE_API_KEY) {
      console.warn('Google Maps API key not found');
      return [origin, destination]; // Fallback to straight line
    }

    try {
      const originStr = `${origin.latitude},${origin.longitude}`;
      const destinationStr = `${destination.latitude},${destination.longitude}`;
      
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?` +
        `origin=${originStr}` +
        `&destination=${destinationStr}` +
        `&key=${GOOGLE_API_KEY}` +
        `&mode=driving`
      );

      const data = await response.json();
      
      if (data.status === 'OK') {
        const route = data.routes[0];
        const points: LatLng[] = [];
        
        // Decode polyline from overview_polyline
        if (route.overview_polyline?.points) {
          const decodedPoints = decodePolyline(route.overview_polyline.points);
          points.push(...decodedPoints);
        } else {
          // Fallback: extract coordinates from steps
          route.legs[0].steps.forEach((step: any) => {
            const decoded = decodePolyline(step.polyline.points);
            points.push(...decoded);
          });
        }
        
        return points.length > 0 ? points : [origin, destination];
      } else {
        console.warn('Directions API error:', data.status);
        return [origin, destination]; // Fallback to straight line
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      return [origin, destination]; // Fallback to straight line
    }
  };

  // Start location tracking
  const startLocationTracking = async () => {
    try {
      setIsTracking(true);
      
      // Watch position for real-time updates
      const locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (newLocation) => {
          const { latitude, longitude } = newLocation.coords;
          const updatedLocation = {
            latitude,
            longitude,
            address: 'Current Location'
          };
          
          setLiveCustomerLocation(updatedLocation);
          
          // Update customer location callback
          if (onCustomerLocationUpdate) {
            onCustomerLocationUpdate({
              longitude,
              latitude,
              address: 'Current Location',
            });
          }

          // Update distance and ETA calculations
          updateCustomerLocationCalculations(updatedLocation);
        }
      );

      return () => {
        if (locationSubscription) {
          locationSubscription.remove();
        }
      };
    } catch (error) {
      console.error('Error starting location tracking:', error);
      setIsTracking(false);
    }
  };

  // Update calculations based on customer location
  const updateCustomerLocationCalculations = (customerLoc: MapLocation) => {
    if (driverLocation) {
      const distance = calculateDistance(
        customerLoc.latitude,
        customerLoc.longitude,
        driverLocation.latitude,
        driverLocation.longitude
      );
      setCustomerDistance(distance);
      setCustomerEta(calculateETA(distance));
    }
  };

  // Fit map to show all markers
  const fitToMarkers = () => {
    if (!mapRef.current) return;

    const coordinates: LatLng[] = [];
    
    if (liveCustomerLocation) {
      coordinates.push({
        latitude: liveCustomerLocation.latitude,
        longitude: liveCustomerLocation.longitude,
      });
    }
    
    if (pickupLocation) {
      coordinates.push({
        latitude: pickupLocation.latitude,
        longitude: pickupLocation.longitude,
      });
    }
    
    if (deliveryLocation) {
      coordinates.push({
        latitude: deliveryLocation.latitude,
        longitude: deliveryLocation.longitude,
      });
    }
    
    if (driverLocation) {
      coordinates.push({
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
      });
    }

    if (coordinates.length > 0) {
      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
        animated: true,
      });
    }
  };

  // Get current location
  const getCurrentLocation = async () => {
    try {
      setIsLocating(true);
      
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const { latitude, longitude } = location.coords;
      const newLocation = { latitude, longitude };
      
      setCurrentLocation(newLocation);
      setLiveCustomerLocation({
        longitude,
        latitude,
        address: 'Current Location'
      });
      
      // Animate map to location
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          ...newLocation,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01 * ASPECT_RATIO,
        }, 1000);
      }

      // Callback for location update
      if (onLocationUpdate) {
        onLocationUpdate({
          longitude,
          latitude,
          address: 'Current Location',
        });
      }

      setTimeout(() => setIsLocating(false), 1000);
    } catch (error) {
      Alert.alert('Location Error', 'Unable to get your location. Please check permissions.');
      setIsLocating(false);
    }
  };

  // Update route when pickup/delivery locations change
  useEffect(() => {
    const calculateAndSetRoute = async () => {
      if (pickupLocation && deliveryLocation && showRoute) {
        setIsCalculatingRoute(true);
        try {
          const start: LatLng = {
            latitude: pickupLocation.latitude,
            longitude: pickupLocation.longitude,
          };
          const end: LatLng = {
            latitude: deliveryLocation.latitude,
            longitude: deliveryLocation.longitude,
          };
          
          const route = await fetchRoute(start, end);
          setRouteCoordinates(route);
        } catch (error) {
          console.error('Error calculating route:', error);
          // Fallback to straight line
          setRouteCoordinates([
            { latitude: pickupLocation.latitude, longitude: pickupLocation.longitude },
            { latitude: deliveryLocation.latitude, longitude: deliveryLocation.longitude }
          ]);
        } finally {
          setIsCalculatingRoute(false);
        }
      } else {
        setRouteCoordinates([]);
      }
    };

    calculateAndSetRoute();
  }, [pickupLocation, deliveryLocation, showRoute]);

  // Update driver route
  useEffect(() => {
    const calculateDriverRoute = async () => {
      if (driverLocation && liveCustomerLocation) {
        const driverPos: LatLng = {
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
        };
        const customerPos: LatLng = {
          latitude: liveCustomerLocation.latitude,
          longitude: liveCustomerLocation.longitude,
        };
        
        try {
          const driverRoute = await fetchRoute(driverPos, customerPos);
          setDriverRouteCoordinates(driverRoute);
        } catch (error) {
          console.error('Error calculating driver route:', error);
          // Fallback to straight line
          setDriverRouteCoordinates([driverPos, customerPos]);
        }
        
        // Calculate distance and ETA
        const distance = calculateDistance(
          liveCustomerLocation.latitude,
          liveCustomerLocation.longitude,
          driverLocation.latitude,
          driverLocation.longitude
        );
        setCustomerDistance(distance);
        setCustomerEta(calculateETA(distance));
      } else {
        setDriverRouteCoordinates([]);
      }
    };

    calculateDriverRoute();
  }, [driverLocation, liveCustomerLocation]);

  // Fit map when markers change
  useEffect(() => {
    const timer = setTimeout(() => {
      fitToMarkers();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [pickupLocation, deliveryLocation, driverLocation, liveCustomerLocation]);

  // Resolve profile picture from either property
  const resolvedProfilePicture = useMemo(() => {
    return customerProfile?.profilePictureUrl || customerProfile?.profilePicture;
  }, [customerProfile]);

  // Custom Marker Components
  const PickupMarker = () => (
    <Marker
      coordinate={{
        latitude: pickupLocation!.latitude,
        longitude: pickupLocation!.longitude,
      }}
      title="Pickup Location"
      description={pickupLocation?.address || 'Pickup Point'}
      tracksViewChanges={false} // Static marker optimization
    >
      <View style={styles.pickupMarker}>
        <View style={styles.markerInner}>
          <MaterialIcons name="storefront" size={20} color="#10b981" />
        </View>
      </View>
    </Marker>
  );

  const DeliveryMarker = () => (
    <Marker
      coordinate={{
        latitude: deliveryLocation!.latitude,
        longitude: deliveryLocation!.longitude,
      }}
      title="Delivery Location"
      description={deliveryLocation?.address || 'Delivery Point'}
      tracksViewChanges={false} // Static marker optimization
    >
      <View style={styles.deliveryMarker}>
        <View style={styles.markerInner}>
          <MaterialIcons name="home" size={20} color="#ef4444" />
        </View>
      </View>
    </Marker>
  );

  const DriverMarker = () => (
    <Marker
      coordinate={{
        latitude: driverLocation!.latitude,
        longitude: driverLocation!.longitude,
      }}
      title={`Driver ${driverLocation?.driverName || ''}`}
      description={driverLocation?.vehicleType || 'Delivery Vehicle'}
      rotation={driverLocation?.heading || 0}
      tracksViewChanges={true} // Driver moves often, allow tracking
    >
      <View style={styles.driverMarker}>
        <MaterialIcons name="directions-car" size={28} color="#7c3aed" />
        {driverLocation?.eta && (
          <View style={styles.driverEtaBadge}>
            <Text style={styles.driverEtaText}>{driverLocation.eta}</Text>
          </View>
        )}
      </View>
    </Marker>
  );

  const CurrentLocationMarker = () => (
    <Marker
      coordinate={currentLocation!}
      title="Your Location"
      description="Current position"
      tracksViewChanges={false}
    >
      <View style={styles.currentLocationMarker}>
        <View style={styles.currentLocationInner}>
          <View style={styles.currentLocationDot} />
        </View>
      </View>
    </Marker>
  );

  if (error) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#6b7280" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity 
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              setIsLoading(true);
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#7c3aed" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}

      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        region={region}
        onRegionChangeComplete={setRegion}
        showsUserLocation={false} 
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={true}
        zoomEnabled={true}
        rotateEnabled={true}
        scrollEnabled={true}
        pitchEnabled={true}
        loadingEnabled={true}
        loadingIndicatorColor="#7c3aed"
        loadingBackgroundColor="#030712"
        onMapReady={() => setIsLoading(false)}
      >
        {/* Pickup to Delivery Route - Solid Line */}
        {routeCoordinates.length > 0 && showRoute && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#8b5cf6"
            strokeWidth={4}
          />
        )}

        {/* Driver to Customer Route - Solid Line */}
        {driverRouteCoordinates.length > 0 && showRoute && (
          <Polyline
            coordinates={driverRouteCoordinates}
            strokeColor="#f59e0b"
            strokeWidth={3}
          />
        )}

        {/* Markers */}
        {liveCustomerLocation && (
          <StableCustomerMarker 
            coordinate={{
              latitude: liveCustomerLocation.latitude,
              longitude: liveCustomerLocation.longitude
            }}
            profileUrl={resolvedProfilePicture}
          />
        )}
        
        {pickupLocation && <PickupMarker />}
        {deliveryLocation && <DeliveryMarker />}
        {driverLocation && <DriverMarker />}
        {currentLocation && showCurrentLocation && !liveCustomerLocation && <CurrentLocationMarker />}
      </MapView>

      {/* Status Bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusItem}>
          <View style={[styles.statusDot, { backgroundColor: isTracking ? '#10b981' : '#ef4444' }]} />
          <Text style={styles.statusText}>
            {isTracking ? 'Live Tracking Active' : 'Tracking Off'}
          </Text>
        </View>
        {liveCustomerLocation?.address && (
          <Text style={styles.addressText} numberOfLines={1}>
            📍 {liveCustomerLocation.address}
          </Text>
        )}
        {isCalculatingRoute && (
          <View style={styles.routeCalculating}>
            <ActivityIndicator size="small" color="#7c3aed" />
            <Text style={styles.routeCalculatingText}>Calculating route...</Text>
          </View>
        )}
      </View>

      {/* Driver ETA Display */}
      {customerEta !== null && driverLocation && (
        <View style={styles.driverEtaContainer}>
          <View style={styles.etaCard}>
            <View style={styles.etaIcon}>
              <MaterialIcons name="directions-car" size={20} color="#fff" />
            </View>
            <View>
              <Text style={styles.etaLabel}>Driver to You</Text>
              <Text style={styles.etaValue}>{customerEta} min</Text>
              {customerDistance !== null && (
                <Text style={styles.etaDistance}>{customerDistance.toFixed(1)} km away</Text>
              )}
              {driverLocation.driverName && (
                <Text style={styles.driverName}>{driverLocation.driverName}</Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Control Buttons */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={getCurrentLocation}
          disabled={isLocating}
        >
          <MaterialIcons 
            name="my-location" 
            size={24} 
            color={isLocating ? '#ccc' : '#fff'} 
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={fitToMarkers}
          disabled={isLoading}
        >
          <MaterialIcons name="zoom-out-map" size={24} color="white" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => mapRef.current?.animateToRegion({
            ...region,
            latitudeDelta: region.latitudeDelta / 2,
            longitudeDelta: region.longitudeDelta / 2,
          })}
        >
          <MaterialIcons name="zoom-in" size={24} color="white" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => mapRef.current?.animateToRegion({
            ...region,
            latitudeDelta: region.latitudeDelta * 2,
            longitudeDelta: region.longitudeDelta * 2,
          })}
        >
          <MaterialIcons name="zoom-out" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Tracking Toggle */}
      <View style={styles.trackingToggleContainer}>
        <TouchableOpacity
          style={[styles.trackingButton, { backgroundColor: isTracking ? '#10b981' : '#6b7280' }]}
          onPress={() => {
            if (isTracking) {
              setIsTracking(false);
            } else {
              startLocationTracking();
            }
          }}
        >
          <MaterialIcons 
            name={isTracking ? "location-on" : "location-off"} 
            size={20} 
            color="#fff" 
          />
          <Text style={styles.trackingText}>
            {isTracking ? 'Live' : 'Go Live'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(147, 51, 234, 0.3)',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 7, 18, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    color: '#a855f7',
    marginTop: 12,
    fontSize: 16,
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
    padding: 20,
  },
  errorText: {
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: 'white',
    fontWeight: '600',
  },
  // Status Bar
  statusBar: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'column',
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  addressText: {
    color: '#ccc',
    fontSize: 11,
  },
  routeCalculating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  routeCalculatingText: {
    color: '#a855f7',
    fontSize: 11,
    fontWeight: '500',
  },
  // ETA Display
  driverEtaContainer: {
    position: 'absolute',
    top: 80,
    right: 20,
  },
  etaCard: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 140,
  },
  etaIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f59e0b',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  etaLabel: {
    color: '#ccc',
    fontSize: 10,
    fontWeight: '600',
  },
  etaValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  etaDistance: {
    color: '#aaa',
    fontSize: 10,
  },
  driverName: {
    color: '#10b981',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  // Control Buttons
  controlsContainer: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    flexDirection: 'column',
    gap: 12,
  },
  controlButton: {
    backgroundColor: 'rgba(124, 58, 237, 0.9)',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 2,
    borderColor: 'white',
  },
  // Tracking Toggle
  trackingToggleContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
  },
  trackingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  trackingText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  // Marker Styles
  pickupMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#10b981',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  deliveryMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  driverMarker: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#7c3aed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  driverEtaBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#ef4444',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  driverEtaText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  customerMarker: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customerImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#3b82f6',
    backgroundColor: '#e5e7eb', // Placeholder background
  },
  customerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  currentLocationMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  markerInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentLocationInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentLocationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
  },
});

