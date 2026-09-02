// app/components/customer/OfferYourFare.tsx
import { useUser } from '@/app/context/UserContext';
import SearchingForDrivers from '@/components/SearchingForDrivers';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import {
  calculateAllVehicleFares,
  calculateDistance,
  getVehicleDescription,
  getVehicleDisplayName,
  getVehicleIcon
} from '@/utils/pricingCalculator';

const { height } = Dimensions.get('window');

interface OfferYourFareProps {
  visible: boolean;
  packageData: any;
  onBack: () => void;
  onConfirmFare: (fare: string, vehicleType?: string) => void;
}

export default function OfferYourFare({ visible, packageData, onBack, onConfirmFare }: OfferYourFareProps) {
  const [selectedVehicle, setSelectedVehicle] = useState<'motorcycle' | 'car' | 'van' | 'truck'>('car');
  const [fare, setFare] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [vehicleFares, setVehicleFares] = useState<Record<string, number>>({});
  const [recommendedFare, setRecommendedFare] = useState<number>(0);
  const [slideAnim] = useState(new Animated.Value(height));
  const [fadeAnim] = useState(new Animated.Value(0));
  const { customer } = useUser();

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        })
      ]).start();
    } else {
      fadeAnim.setValue(0);
      slideAnim.setValue(height);
    }
  }, [visible]);

  // Get user's current location
  useEffect(() => {
    const getLocation = async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.error('Location permission denied');
          setUserLocation({ lat: 0, lng: 0 });
          return;
        }

        let location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        setUserLocation({
          lat: location.coords.latitude,
          lng: location.coords.longitude
        });
      } catch (error) {
        console.error('Error getting location:', error);
        setUserLocation({ lat: 0, lng: 0 });
      }
    };

    getLocation();
  }, []);

  // Calculate fares for all vehicle types
  useEffect(() => {
    let distance = packageData.routeDistance;
    
    // If no distance provided, try to calculate it from coordinates
    if (!distance && packageData.pickupCoords && packageData.deliveryCoords) {
      try {
        distance = calculateDistance(
          [packageData.pickupCoords.lng, packageData.pickupCoords.lat],
          [packageData.deliveryCoords.lng, packageData.deliveryCoords.lat]
        );
      } catch (error) {
        console.error('Error calculating distance:', error);
        distance = 5; // Default fallback
      }
    } else if (!distance) {
      distance = 5; // Default fallback
    }
    
    if (distance) {
      // Use the package data to include additional factors
      const additionalFactors = {
        packageSize: (packageData.packageSize as 'small' | 'medium' | 'large' | 'extra_large') || 'medium',
        packageWeight: packageData.packageWeight,
        urgency: 'standard' as const
      };
      
      const fares = calculateAllVehicleFares(distance, additionalFactors);
      setVehicleFares(fares);
      
      const carFare = Math.round(fares.car);
      setFare(carFare.toString());
      setRecommendedFare(carFare);
    }
  }, [packageData.routeDistance, packageData.pickupCoords, packageData.deliveryCoords]);

  const handleVehicleSelect = (vehicle: 'motorcycle' | 'car' | 'van' | 'truck') => {
    setSelectedVehicle(vehicle);
    if (vehicleFares[vehicle]) {
      const newFare = Math.round(vehicleFares[vehicle]).toString();
      setFare(newFare);
    }
  };

  // Handle form submission
  const handleSubmit = () => {
    if (fare && parseInt(fare) > 0) {
      setIsSearching(true);
    }
  };

  // Handle fare updates from SearchingForDrivers
  const handleFareUpdate = (newFare: string) => {
    const wholeDollarFare = Math.round(parseFloat(newFare)).toString();
    setFare(wholeDollarFare);
  };

  // Handle final confirmation from SearchingForDrivers
  const handleFinalConfirm = (driver: any) => {
    onConfirmFare(fare, selectedVehicle);
  };

  const adjustFare = (amount: number) => {
    const currentFare = parseInt(fare) || recommendedFare;
    const newFare = Math.max(2, currentFare + amount);
    setFare(newFare.toString());
  };

  // Calculate price per km
  const calculatePricePerKm = () => {
    const distance = packageData.routeDistance || 1;
    const currentFare = parseInt(fare) || recommendedFare;
    const perKm = currentFare / distance;
    return `$${perKm.toFixed(2)}/km`;
  };

  // Get estimated time
  const getEstimatedTime = () => {
    const distance = packageData.routeDistance || 5;
    const minTime = Math.ceil(distance * 3);
    const maxTime = Math.ceil(distance * 4);
    return `${minTime}-${maxTime} min`;
  };

  // Show SearchingForDrivers when isSearching is true
  if (isSearching) {
    return (
      <SearchingForDrivers
        visible={visible}
        initialFare={fare}
        onFareChange={handleFareUpdate}
        onCancel={() => setIsSearching(false)}
        onConfirm={handleFinalConfirm}
        packageData={{
          ...packageData,
          vehicleType: selectedVehicle,
          customerId: customer?.id,
          customerUsername: customer?.username || packageData.customerPhone,
          recipientPhone: packageData.recipientPhone,
          pickupAddress: packageData.pickupLocation,
          dropoffAddress: packageData.deliveryLocation,
          routeDistance: packageData.routeDistance || 0,
          packageDescription: packageData.packageDescription,
          pickupCoords: packageData.pickupCoords,
          deliveryCoords: packageData.deliveryCoords,
          customerPhone: packageData.customerPhone
        }}
        userLocation={userLocation || { lat: 0, lng: 0 }}
        customerId={customer?.id || packageData.customerId || 0}
        customerUsername={customer?.username || packageData.customerPhone}
      />
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={onBack}
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
        <KeyboardAvoidingView 
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.panel}>
            <View style={styles.header}>
              <TouchableOpacity onPress={onBack} style={styles.backButton}>
                <Ionicons name="arrow-back" size={24} color="#A855F7" />
              </TouchableOpacity>
              
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Set Your Price</Text>
                <Text style={styles.headerSubtitle}>Choose vehicle and set price</Text>
              </View>
              
              <View style={styles.vehicleIconHeader}>
                <Ionicons name={getVehicleIcon(selectedVehicle) as any} size={24} color="white" />
              </View>
            </View>

            <ScrollView 
              style={styles.scrollView}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Choose Vehicle</Text>
                <View style={styles.vehicleGrid}>
                  {(['motorcycle', 'car', 'van', 'truck'] as const).map((vehicle) => (
                    <TouchableOpacity
                      key={vehicle}
                      style={[
                        styles.vehicleCard,
                        selectedVehicle === vehicle && styles.vehicleCardSelected
                      ]}
                      onPress={() => handleVehicleSelect(vehicle)}
                    >
                      <View style={styles.vehicleIconWrapper}>
                        <Ionicons 
                          name={getVehicleIcon(vehicle) as any} 
                          size={32} 
                          color={selectedVehicle === vehicle ? 'white' : '#7C3AED'} 
                        />
                      </View>
                      
                      <Text style={[
                        styles.vehicleName,
                        selectedVehicle === vehicle && styles.vehicleNameSelected
                      ]}>
                        {getVehicleDisplayName(vehicle)}
                      </Text>
                      
                      <Text style={styles.vehicleDescription}>
                        {getVehicleDescription(vehicle)}
                      </Text>
                      
                      <View style={[
                        styles.vehiclePrice,
                        selectedVehicle === vehicle && styles.vehiclePriceSelected
                      ]}>
                        <Text style={styles.vehiclePriceText}>
                          ${vehicleFares[vehicle] ? Math.round(vehicleFares[vehicle]) : '...'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.priceSection}>
                <View style={styles.priceHeader}>
                  <View>
                    <Text style={styles.priceTitle}>Set Your Price</Text>
                    <Text style={styles.priceSubtitle}>Adjust in $1 increments</Text>
                  </View>
                </View>

                <View style={styles.priceDisplayContainer}>
                  <View style={styles.priceDisplay}>
                    <Text style={styles.priceText}>${parseInt(fare) || recommendedFare}</Text>
                    <Text style={styles.priceLabel}>Total Price</Text>
                  </View>
                </View>

                <View style={styles.adjustContainer}>
                  <TouchableOpacity
                    style={styles.adjustButton}
                    onPress={() => adjustFare(-1)}
                  >
                    <Ionicons name="remove" size={32} color="#EF4444" />
                    <Text style={styles.adjustLabel}>Decrease</Text>
                  </TouchableOpacity>
                  
                  <View style={styles.adjustCenter}>
                    <Text style={styles.adjustTitle}>Adjust Price</Text>
                    <Text style={styles.adjustSubtitle}>$1 per click</Text>
                  </View>
                  
                  <TouchableOpacity
                    style={styles.adjustButton}
                    onPress={() => adjustFare(1)}
                  >
                    <Ionicons name="add" size={32} color="#10B981" />
                    <Text style={styles.adjustLabel}>Increase</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.resetButton}
                  onPress={() => setFare(recommendedFare.toString())}
                >
                  <Ionicons name="refresh" size={16} color="#7C3AED" />
                  <Text style={styles.resetText}>
                    Reset to ${recommendedFare}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={styles.backActionButton}
                  onPress={onBack}
                >
                  <Ionicons name="arrow-back" size={20} color="white" />
                  <Text style={styles.backActionText}>Back</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.confirmButton,
                    (!fare || parseInt(fare) <= 0) && styles.confirmButtonDisabled
                  ]}
                  onPress={handleSubmit}
                  disabled={!fare || parseInt(fare) <= 0}
                >
                  <Ionicons name="flash" size={20} color="white" />
                  <Text style={styles.confirmButtonText}>
                    Book for ${parseInt(fare) || recommendedFare}
                  </Text>
                </TouchableOpacity>
              </View>

              {Platform.OS === 'ios' && <View style={{ height: 30 }} />}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  keyboardView: {
    flex: 1,
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
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#7C3AED',
    marginTop: 4,
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
  },
  vehicleIconHeader: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#7C3AED',
    marginBottom: 16,
  },
  vehicleGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  vehicleCard: {
    width: '48%',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
    marginBottom: 12,
  },
  vehicleCardSelected: {
    borderColor: '#7C3AED',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
  },
  vehicleIconWrapper: {
    marginBottom: 12,
  },
  vehicleName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E5E7EB',
    marginBottom: 4,
  },
  vehicleNameSelected: {
    color: 'white',
  },
  vehicleDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 12,
    textAlign: 'center',
  },
  vehiclePrice: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#374151',
  },
  vehiclePriceSelected: {
    backgroundColor: '#7C3AED',
  },
  vehiclePriceText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#E5E7EB',
  },
  priceSection: {
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  priceHeader: {
    marginBottom: 20,
  },
  priceTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#7C3AED',
  },
  priceSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  priceDisplayContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  priceDisplay: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 20,
    borderRadius: 20,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  priceText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
  },
  priceLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  adjustContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 32,
  },
  adjustButton: {
    alignItems: 'center',
  },
  adjustLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  adjustCenter: {
    alignItems: 'center',
  },
  adjustTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 2,
  },
  adjustSubtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
    marginBottom: 20,
    gap: 8,
  },
  resetText: {
    fontSize: 14,
    color: '#7C3AED',
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  backActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#374151',
    borderRadius: 16,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: '#4B5563',
  },
  backActionText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
  },
  confirmButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    paddingVertical: 18,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: 'white',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    backgroundColor: '#0F172A',
    borderRadius: 24,
    padding: 40,
    alignItems: 'center',
    width: '80%',
  },
  loadingSpinner: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  loadingText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
  },
});