// components/PackageDetails.tsx
import { useUser } from '@/app/context/UserContext';
import OfferYourFare from '@/components/OfferYourFare';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

interface PackageDetailsProps {
  visible: boolean;
  customerId?: number;
  customerPhone: string;
  pickupLocation: string;
  deliveryLocation: string;
  pickupCoords: [number, number] | null;
  deliveryCoords: [number, number] | null;
  routeDistance?: number | null;
  onBack: () => void;
  onClose: () => void;
  onConfirmFare: (fare: string, vehicleType?: string) => void;
}

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://www.velosdrop.com').replace(/\/$/, '');

export default function PackageDetails({
  visible,
  pickupLocation,
  deliveryLocation,
  pickupCoords,
  deliveryCoords,
  routeDistance,
  onBack,
  onClose,
  onConfirmFare
}: PackageDetailsProps) {
  const { customer } = useUser();
  const [customerPhone, setCustomerPhone] = useState(customer?.phoneNumber || "");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [currentStep, setCurrentStep] = useState("package-details");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecipientDifferent, setIsRecipientDifferent] = useState(false);

  // Initialize customer phone from user context
  useEffect(() => {
    if (customer?.phoneNumber) {
      setCustomerPhone(customer.phoneNumber);
    }
  }, [customer]);

  // Update package description to include phone numbers
  useEffect(() => {
    let baseDescription = packageDescription;
    
    // Remove any existing phone entries to avoid duplicates
    const lines = baseDescription.split('\n');
    const filteredLines = lines.filter(line => 
      !line.includes('📞 Customer Phone:') && 
      !line.includes('📞 Recipient Phone:') &&
      !line.includes('Delivery to recipient:') &&
      !line.includes('Recipient Phone:')
    );
    
    baseDescription = filteredLines.join('\n').trim();
    
    // Always add customer phone at the end
    if (customerPhone.trim()) {
      baseDescription += baseDescription ? '\n\n' : '';
      baseDescription += `📞 Customer Phone: ${customerPhone.trim()}`;
    }
    
    // Add recipient phone if different
    if (isRecipientDifferent && recipientPhone.trim()) {
      baseDescription += '\n';
      baseDescription += `📞 Recipient Phone: ${recipientPhone.trim()}`;
    }
    
    setPackageDescription(baseDescription);
  }, [customerPhone, recipientPhone, isRecipientDifferent]);

  const handleSubmit = () => {
    setError(null);

    // Validate customer phone
    if (!customerPhone.trim() || customerPhone.length < 10) {
      setError("Please enter a valid phone number (at least 10 digits)");
      return;
    }

    // Validate recipient phone if different recipient is selected
    if (isRecipientDifferent && recipientPhone.trim() && recipientPhone.length < 10) {
      setError("Please enter a valid recipient phone number (at least 10 digits)");
      return;
    }

    if (!packageDescription.trim()) {
      setError("Please describe what you want to deliver");
      return;
    }

    setCurrentStep("offer-fare");
  };

  const handleBackToPackageDetails = () => {
    setCurrentStep("package-details");
  };

  const handleConfirmFare = async (fare: string, vehicleType?: string) => {
    try {
      setIsLoading(true);
      setError(null);

      if (!pickupCoords || !deliveryCoords) {
        Alert.alert('Error', 'Please ensure both pickup and delivery locations have valid coordinates');
        setIsLoading(false);
        return;
      }

      const pickupLat = pickupCoords[1];
      const pickupLng = pickupCoords[0];
      const dropoffLat = deliveryCoords[1];
      const dropoffLng = deliveryCoords[0];

      if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
        Alert.alert('Error', 'Invalid coordinates for pickup or delivery locations');
        setIsLoading(false);
        return;
      }

      // Validate phone numbers
      const customerPhoneToUse = customerPhone.trim();
      const recipientPhoneToUse = isRecipientDifferent ? recipientPhone.trim() : customerPhoneToUse;
      
      if (!customerPhoneToUse || customerPhoneToUse.length < 10) {
        Alert.alert('Error', 'Please enter a valid customer phone number');
        setIsLoading(false);
        return;
      }
      
      if (isRecipientDifferent && recipientPhoneToUse && recipientPhoneToUse.length < 10) {
        Alert.alert('Error', 'Please enter a valid recipient phone number');
        setIsLoading(false);
        return;
      }

      const bookingData = {
        customerId: customer?.id,
        customerPhone: customerPhoneToUse,
        customerUsername: customer?.username || `Customer_${customerPhoneToUse}`,
        recipientPhone: recipientPhoneToUse,
        pickupAddress: pickupLocation,
        pickupLatitude: pickupLat,
        pickupLongitude: pickupLng,
        dropoffAddress: deliveryLocation,
        dropoffLatitude: dropoffLat,
        dropoffLongitude: dropoffLng,
        fare,
        distance: routeDistance || 0,
        packageDetails: packageDescription, // Phone numbers are already included here
        vehicleType: vehicleType || 'car',
        userLocation: {
          lat: pickupLat,
          lng: pickupLng
        },
      };

      console.log('📤 Booking data sent:', {
        customerPhone: bookingData.customerPhone,
        recipientPhone: bookingData.recipientPhone,
        packageDetails: bookingData.packageDetails
      });

      const response = await fetch(`${API_BASE_URL}/api/bookings/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Booking creation failed: ${response.status} - ${errorText}`);
      }

      onConfirmFare(fare, vehicleType);

    } catch (error) {
      console.error('❌ Error creating booking:', error);
      setError(error instanceof Error ? error.message : 'Failed to create booking');
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create booking');
    } finally {
      setIsLoading(false);
    }
  };

  if (currentStep === "offer-fare") {
    return (
      <OfferYourFare
        visible={visible}
        packageData={{
          customerId: customer?.id,
          customerPhone,
          recipientPhone: isRecipientDifferent ? recipientPhone : customerPhone,
          pickupLocation,
          deliveryLocation,
          packageDescription,
          pickupCoords,
          deliveryCoords,
          routeDistance
        }}
        onBack={handleBackToPackageDetails}
        onConfirmFare={handleConfirmFare}
      />
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView 
            style={styles.keyboardView}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onBack} style={styles.iconButton}>
                <Ionicons name="arrow-back" size={24} color="#A855F7" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Package Details</Text>
              <TouchableOpacity onPress={onClose} style={styles.iconButton}>
                <Ionicons name="close" size={24} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {/* Progress Indicator */}
            <View style={styles.progress}>
              <View style={styles.progressStep}>
                <View style={[styles.dot, styles.dotActive]} />
                <Text style={styles.progressTextActive}>Details</Text>
              </View>
              <View style={styles.line} />
              <View style={styles.progressStep}>
                <View style={[styles.dot, styles.dotInactive]} />
                <Text style={styles.progressText}>Pricing</Text>
              </View>
            </View>

            <ScrollView 
              style={styles.scroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {error && (
                <View style={styles.error}>
                  <Ionicons name="warning" size={16} color="#FBBF24" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Route Summary */}
              <View style={styles.compactRouteCard}>
                <View style={styles.timelineColumn}>
                  <View style={styles.timelineDot} />
                  <View style={styles.timelineLine} />
                  <View style={styles.timelineSquare} />
                </View>
                <View style={styles.addressColumn}>
                  <Text numberOfLines={1} style={styles.addressText}>{pickupLocation}</Text>
                  <View style={styles.addressSpacer} />
                  <Text numberOfLines={1} style={styles.addressText}>{deliveryLocation}</Text>
                </View>
                {routeDistance && (
                   <View style={styles.distanceBadge}>
                      <Text style={styles.distanceText}>{routeDistance.toFixed(1)} km</Text>
                   </View>
                )}
              </View>

              {/* Customer Phone */}
              <View style={styles.section}>
                <Text style={styles.label}>Your Phone Number</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    value={customerPhone}
                    onChangeText={setCustomerPhone}
                    placeholder="Enter your phone number"
                    placeholderTextColor="#6B7280"
                    keyboardType="phone-pad"
                    maxLength={15}
                  />
                  <Ionicons name="phone-portrait-outline" size={20} color="#6B7280" />
                </View>
                <Text style={styles.hintText}>
                  This will be visible to the driver
                </Text>
              </View>

              {/* Recipient Toggle */}
              <View style={styles.toggleSection}>
                <View style={styles.toggleLabel}>
                  <Ionicons name="person-outline" size={18} color="#9CA3AF" />
                  <Text style={styles.toggleLabelText}>Delivering to someone else?</Text>
                </View>
                <Switch
                  value={isRecipientDifferent}
                  onValueChange={setIsRecipientDifferent}
                  trackColor={{ false: '#374151', true: '#7C3AED' }}
                  thumbColor={isRecipientDifferent ? '#A78BFA' : '#9CA3AF'}
                />
              </View>

              {/* Recipient Phone */}
              {isRecipientDifferent && (
                <View style={styles.section}>
                  <Text style={styles.label}>Recipient's Phone</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      value={recipientPhone}
                      onChangeText={setRecipientPhone}
                      placeholder="Recipient phone number"
                      placeholderTextColor="#6B7280"
                      keyboardType="phone-pad"
                      maxLength={15}
                    />
                    <Ionicons name="call-outline" size={20} color="#6B7280" />
                  </View>
                  <Text style={styles.hintText}>
                    Driver will call this number upon arrival
                  </Text>
                </View>
              )}

              {/* Package Description */}
              <View style={styles.expandedSection}>
                <Text style={styles.label}>Package Details</Text>
                <TextInput
                  style={styles.expandedTextarea}
                  value={packageDescription}
                  onChangeText={setPackageDescription}
                  placeholder="Describe what you're delivering... (Phone numbers will be automatically added below)"
                  placeholderTextColor="#6B7280"
                  multiline
                  textAlignVertical="top"
                />
                <Text style={styles.note}>
                  Phone numbers will be automatically added to the description for the driver
                </Text>
              </View>

              {/* Preview */}
              {packageDescription.trim() ? (
                <View style={styles.preview}>
                  <Text style={styles.previewTitle}>Preview for Driver</Text>
                  <View style={styles.previewContent}>
                    <Text style={styles.previewText}>{packageDescription}</Text>
                  </View>
                </View>
              ) : null}

            </ScrollView>

            {/* Footer with Continue Button */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[
                  styles.button,
                  (!customerPhone.trim() || !packageDescription.trim()) && styles.buttonDisabled
                ]}
                onPress={handleSubmit}
                disabled={isLoading || !customerPhone.trim() || !packageDescription.trim()}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Continue</Text>
                    <Ionicons name="arrow-forward" size={18} color="white" />
                  </>
                )}
              </TouchableOpacity>
            </View>

          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  iconButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  progress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#0F172A',
  },
  progressStep: {
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  dotActive: {
    backgroundColor: '#7C3AED',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotInactive: {
    backgroundColor: '#4B5563',
  },
  line: {
    width: 40,
    height: 1,
    backgroundColor: '#4B5563',
    marginHorizontal: 8,
  },
  progressText: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  progressTextActive: {
    fontSize: 10,
    color: '#7C3AED',
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    flexGrow: 1,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(146, 64, 14, 0.2)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#92400E',
  },
  errorText: {
    fontSize: 13,
    color: '#FBBF24',
    marginLeft: 8,
    flex: 1,
  },
  compactRouteCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  timelineColumn: {
    alignItems: 'center',
    marginRight: 12,
    height: 40,
    justifyContent: 'space-between',
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: '#4B5563',
    marginVertical: 2,
  },
  timelineSquare: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: '#EF4444',
  },
  addressColumn: {
    flex: 1,
    justifyContent: 'space-between',
    height: 42,
  },
  addressSpacer: {
    height: 4,
  },
  addressText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  distanceBadge: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  distanceText: {
    color: '#A78BFA',
    fontSize: 11,
    fontWeight: '700',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
    marginBottom: 6,
  },
  hintText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
    fontStyle: 'italic',
  },
  note: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 6,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  toggleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toggleLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleLabelText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#E5E7EB',
    marginLeft: 10,
  },
  expandedSection: {
    marginBottom: 12,
    flex: 1,
  },
  expandedTextarea: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    color: 'white',
    fontSize: 16,
    flex: 1,
    minHeight: 150,
    textAlignVertical: 'top',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 16,
    height: 50,
  },
  input: {
    flex: 1,
    color: 'white',
    fontSize: 16,
    height: '100%',
    marginRight: 8,
  },
  preview: {
    backgroundColor: 'rgba(124, 58, 237, 0.05)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.2)',
  },
  previewTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7C3AED',
    marginBottom: 4,
  },
  previewContent: {
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 6,
    padding: 8,
  },
  previewText: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  button: {
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#334155',
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
});