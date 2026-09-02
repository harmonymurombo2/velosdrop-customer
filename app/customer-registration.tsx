// app/customer-registration.tsx
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { countries } from 'countries-list';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Database imports
import { checkForExistingUser, db, fixDatabaseSchema, initializeDatabase, insertUserToCloud, pushToTurso, syncDb } from '@/src/db';
import { customersTable, otpTable } from '@/src/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'react-native-bcrypt';

// Google Sign-In service
import { googleAuthService } from '@/src/db/services/google-auth.service';

// Set random fallback for React Native
bcrypt.setRandomFallback((len) => {
  const array = new Array(len);
  for (let i = 0; i < len; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return array;
});

const { width, height } = Dimensions.get('window');

interface Country {
  code: string;
  name: string;
  phone: string;
  emoji: string;
}

const ZIMBABWE_COUNTRY: Country = {
  code: 'ZW',
  name: 'Zimbabwe',
  phone: '263',
  emoji: '🇿🇼',
};

// Twilio configuration
const TWILIO_ACCOUNT_SID = process.env.EXPO_PUBLIC_TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.EXPO_PUBLIC_TWILIO_AUTH_TOKEN!;
const TWILIO_PHONE_NUMBER = process.env.EXPO_PUBLIC_TWILIO_PHONE_NUMBER!;

// Cloud database function for Google users
const insertGoogleUserToCloud = async (
  username: string,
  email: string,
  googleId: string,
  profilePictureUrl: string | null | undefined
) => {
  const cloudQuery = `
    INSERT INTO customers 
    (username, email, phone_number, password, profile_picture_url, 
     auth_provider, google_id, is_verified, status, created_at, updated_at, last_login) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  return await pushToTurso(cloudQuery, [
    username,
    email,
    null,
    null,
    profilePictureUrl || null, // Convert undefined to null
    'google',
    googleId,
    1, // is_verified
    'active',
    new Date().toISOString(),
    new Date().toISOString(),
    new Date().toISOString()
  ]);
};

// Function to check for existing user by email
const checkForExistingUserByEmail = async (email: string) => {
  try {
    const existingUsers = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.email, email))
      .limit(1);
    
    return existingUsers.length > 0 ? existingUsers[0] : null;
  } catch (error) {
    console.error('Error checking for existing user by email:', error);
    return null;
  }
};

export default function CustomerRegistration() {
  const [step, setStep] = useState<'registration' | 'verification'>('registration');
  const [formData, setFormData] = useState({
    username: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [selectedCountry, setSelectedCountry] = useState<Country>(ZIMBABWE_COUNTRY);
  const [countryList, setCountryList] = useState<Country[]>([]);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const otpInputRefs = useRef<TextInput[]>([]);

  // Initialize refs array
  useEffect(() => {
    otpInputRefs.current = Array(6).fill(null).map((_, i) => otpInputRefs.current[i] || null);
  }, []);

  useEffect(() => {
    // Initialize database on component mount
    const initializeAppDatabase = async () => {
      try {
        console.log('🔧 Initializing database for registration...');
        await initializeDatabase();
        setDbInitialized(true);
        console.log('✅ Database initialized for registration');
      } catch (error) {
        console.error('❌ Database initialization failed:', error);
        setDbInitialized(true); // Still allow registration attempts
      }
    };
    
    initializeAppDatabase();
    loadCountries();
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  const loadCountries = () => {
    try {
      const countriesData = Object.entries(countries).map(([code, country]) => {
        const countryData = country as any;
        return {
          code,
          name: countryData.name,
          phone: Array.isArray(countryData.phone) ? countryData.phone[0].toString() : countryData.phone.toString(),
          emoji: countryData.emoji,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      setCountryList(countriesData);
    } catch (error) {
      console.error('Error loading countries:', error);
    }
  };

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setShowCountryPicker(false);
  };

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    return cleaned.replace(/(\d{3})(?=\d)/g, '$1 ');
  };

  const handlePhoneChange = (text: string) => {
    const formatted = formatPhoneNumber(text);
    setFormData({ ...formData, phone: formatted });
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.username.trim())
      newErrors.username = 'Username is required';
    else if (formData.username.trim().length < 3)
      newErrors.username = 'Username must be at least 3 characters';
    
    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (!phoneDigits)
      newErrors.phone = 'Phone number is required';
    else if (phoneDigits.length < 6)
      newErrors.phone = 'Phone number is too short';
    
    if (formData.password.length < 6)
      newErrors.password = 'Password must be at least 6 characters';
    if (formData.password !== formData.confirmPassword)
      newErrors.confirmPassword = 'Passwords do not match';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ========== GOOGLE SIGN-UP FUNCTION ==========
  const handleGoogleSignUp = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGoogleLoading(true);
    setErrors({});
  
    try {
      // 1. Google Sign-In FIRST - Don't wait for database operations
      // This shows the account picker immediately
      console.log('🔐 Opening Google account picker...');
      const googleUser = await googleAuthService.signIn();
      
      if (!googleUser) {
        console.log('❌ User cancelled Google Sign-In');
        setGoogleLoading(false);
        return;
      }
  
      console.log('✅ Google account selected:', googleUser.email);
  
      // 2. Now do database operations in parallel
      const [schemaFixed, syncComplete, existingUser] = await Promise.allSettled([
        fixDatabaseSchema().catch(err => {
          console.warn('⚠️ Schema fix warning:', err);
          return null;
        }),
        syncDb().catch(err => {
          console.warn('⚠️ Sync warning:', err);
          return null;
        }),
        checkForExistingUserByEmail(googleUser.email).catch(() => null)
      ]);
  
      // 3. Check if user exists
      const userExists = existingUser.status === 'fulfilled' ? existingUser.value : null;
      
      if (userExists) {
        Alert.alert(
          'Account Exists',
          'This Google account is already registered. Please log in instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Go to Login', onPress: () => router.replace('/(tabs)') }
          ]
        );
        setGoogleLoading(false);
        return;
      }
  
      // 4. Generate username (fast operation)
      const defaultUsername = googleUser.email.split('@')[0];
      const usernameCheck = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.username, defaultUsername))
        .limit(1);
  
      const finalUsername = usernameCheck.length > 0 
        ? `${defaultUsername}_${Math.floor(Math.random() * 10000)}`
        : defaultUsername;
  
      // 5. Create account locally FIRST (instant)
    
      
    } catch (err: any) {
      console.error('❌ Google Sign-Up error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Google sign-up failed';
      setErrors({ form: errorMessage });
      Alert.alert('Sign-Up Failed', errorMessage);
      setGoogleLoading(false);
    }
  };

  // Helper function to complete Google registration
  const completeGoogleRegistration = async (
    username: string,
    email: string,
    googleId: string,
    profilePictureUrl: string | null | undefined,
    name: string
  ) => {
    try {
      // Check if username already exists
      const usernameExists = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.username, username))
        .limit(1);

      let finalUsername = username;
      if (usernameExists.length > 0) {
        // Append random number if username exists
        finalUsername = `${username}_${Math.floor(Math.random() * 1000)}`;
        
        Alert.alert(
          'Username Taken',
          `Username "${username}" was taken. Your username is now: ${finalUsername}`,
          [{ text: 'OK' }]
        );
      }

      // Create new customer account
      console.log('👤 Creating new customer from Google account...');
      
      const newCustomerData = {
        username: finalUsername,
        email: email,
        phoneNumber: null, // Google users might not have phone
        password: null, // Google users don't use password
        profilePictureUrl: profilePictureUrl || null,
        status: 'active',
        authProvider: 'google',
        googleId: googleId,
        isVerified: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
      };
      
      // Insert into local database
      const [newCustomer] = await db.insert(customersTable)
        .values(newCustomerData)
        .returning();

      console.log('✅ New customer created from Google:', newCustomer.id);

      // Insert into cloud database (Turso)
      try {
        await insertGoogleUserToCloud(
          finalUsername,
          email,
          googleId,
          profilePictureUrl || null
        );
        
        console.log('✅ Customer inserted to cloud successfully');
      } catch (cloudError) {
        console.warn('⚠️ Cloud insertion failed, but local registration succeeded:', cloudError);
      }

      // Show success message
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      Alert.alert(
        'Registration Successful',
        `Welcome ${name}! Your account has been created successfully.`,
        [
          {
            text: 'Continue to Dashboard',
            onPress: () => {
              router.replace('/customer-dashboard');
            }
          }
        ]
      );
      
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : 'Registration failed';
      Alert.alert('Registration Failed', errorMessage);
      console.error('❌ Google Registration error:', err);
    } finally {
      setGoogleLoading(false);
    }
  };

  const sendOtpViaTwilio = async (phoneNum: string, code: string) => {
    try {
      const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
      
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: phoneNum,
            From: TWILIO_PHONE_NUMBER,
            Body: `Your Velosdrop verification code is: ${code}. Valid for 10 minutes.`
          }).toString(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send SMS');
      }

      return true;
    } catch (error: any) {
      console.error('Twilio error:', error);
      // In development, we can continue without SMS
      if (__DEV__) {
        console.log(`⚠️ DEV MODE: OTP Code is ${code}`);
        Alert.alert('Development Mode', `Your OTP code is: ${code}`);
        return true;
      }
      throw error;
    }
  };

  const sendOTP = async () => {
    // Check if database is initialized
    if (!dbInitialized) {
      Alert.alert('Database Initializing', 'Please wait a moment and try again.');
      return;
    }

    setIsLoading(true);
    setErrors({});
    setSuccess('');

    try {
      const phoneDigits = formData.phone.replace(/\D/g, '');
      const fullPhoneNumber = `+${selectedCountry.phone}${phoneDigits}`;
      const trimmedUsername = formData.username.trim();

      // Check for duplicates
      const userExists = await checkForExistingUser(trimmedUsername, fullPhoneNumber);
      
      if (userExists) {
        throw new Error('Username or phone number is already registered');
      }

      // Generate 6-digit OTP
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Set expiry to 10 minutes from now
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Delete any existing OTP for this phone number
      await db.delete(otpTable).where(eq(otpTable.phoneNumber, fullPhoneNumber));

      // Store OTP in local database
      await db.insert(otpTable).values({
        phoneNumber: fullPhoneNumber,
        code,
        expiresAt,
      });

      // Store OTP in cloud database
      try {
        await pushToTurso(
          "INSERT INTO otps (phone_number, code, expires_at) VALUES (?, ?, ?)",
          [fullPhoneNumber, code, expiresAt]
        );
      } catch (cloudError) {
        console.error("Cloud OTP save failed:", cloudError);
      }
      
      // Send the SMS
      await sendOtpViaTwilio(fullPhoneNumber, code);

      setSuccess('OTP sent successfully!');
      setResendCountdown(60);
      setStep('verification');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Focus first OTP input after state update
      setTimeout(() => {
        if (otpInputRefs.current[0]) {
          otpInputRefs.current[0].focus();
        }
      }, 100);
      
    } catch (err: any) {
      console.error('Send OTP error:', err);
      setErrors({ form: err.message });
      Alert.alert('Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpInput = (text: string, index: number) => {
    // Only allow numbers
    const numericText = text.replace(/[^0-9]/g, '');
    
    const newOtp = [...otp];
    newOtp[index] = numericText;
    setOtp(newOtp);

    // Auto-focus next input
    if (numericText && index < 5) {
      setTimeout(() => {
        if (otpInputRefs.current[index + 1]) {
          otpInputRefs.current[index + 1].focus();
        }
      }, 10);
    }

    // Auto-verify when all 6 digits are entered
    if (index === 5 && numericText !== '') {
      const otpCode = [...newOtp.slice(0, 5), numericText].join('');
      console.log('OTP entered:', otpCode);
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      // Move focus to previous input on backspace
      setTimeout(() => {
        if (otpInputRefs.current[index - 1]) {
          otpInputRefs.current[index - 1].focus();
        }
      }, 10);
    }
  };

  const verifyOtp = async () => {
    const otpCode = otp.join('');
    
    if (otpCode.length !== 6) {
      setErrors({ form: 'Please enter all 6 digits' });
      return;
    }

    // IMMEDIATELY set verifying state to true
    setVerifying(true);
    setErrors({});
    
    try {
      const phoneDigits = formData.phone.replace(/\D/g, '');
      const fullPhoneNumber = `+${selectedCountry.phone}${phoneDigits}`;

      // Find OTP in local database
      const otpRecord = await db.query.otpTable.findFirst({
        where: eq(otpTable.phoneNumber, fullPhoneNumber),
      });

      if (!otpRecord) {
        throw new Error('No verification code found. Please resend.');
      }

      if (otpRecord.code !== otpCode) {
        throw new Error('Invalid verification code');
      }

      // Check if OTP is expired
      const expiresAt = new Date(otpRecord.expiresAt);
      if (expiresAt < new Date()) {
        throw new Error('Verification code has expired');
      }

      // Delete the used OTP
      await db.delete(otpTable).where(eq(otpTable.phoneNumber, fullPhoneNumber));

      // Complete registration
      await completeRegistration();
      
    } catch (err: any) {
      setErrors({ form: err.message });
      Alert.alert('Error', err.message);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => {
        if (otpInputRefs.current[0]) {
          otpInputRefs.current[0].focus();
        }
      }, 100);
    } finally {
      setVerifying(false);
    }
  };

  const completeRegistration = async () => {
    try {
      const phoneDigits = formData.phone.replace(/\D/g, '');
      const fullPhoneNumber = `+${selectedCountry.phone}${phoneDigits}`;
      const trimmedUsername = formData.username.trim();

      // Use bcrypt from react-native-bcrypt
      const salt = bcrypt.genSaltSync(10);
      const hashedPassword = bcrypt.hashSync(formData.password, salt);

      // Create new customer in local database
      const [newCustomer] = await db
        .insert(customersTable)
        .values({
          username: trimmedUsername,
          phoneNumber: fullPhoneNumber,
          password: hashedPassword,
          authProvider: 'phone',
          isVerified: true,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          email: null,
          googleId: null,
          profilePictureUrl: null,
        })
        .returning();

      console.log('✅ Local registration successful:', newCustomer);

      // Insert into cloud database
      const cloudSuccess = await insertUserToCloud(trimmedUsername, fullPhoneNumber, hashedPassword);
      
      if (!cloudSuccess) {
        console.warn('Cloud insertion failed, but local registration succeeded');
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Show success state and start redirect process
      setRegistrationSuccess(true);
      setRedirecting(true);
      
      // Show loading message for 1.5 seconds then redirect to dashboard
      setTimeout(() => {
        setRedirecting(false);
        // Redirect directly to customer dashboard
        router.replace('/customer-dashboard');
      }, 1500);
      
    } catch (error: any) {
      console.error("Registration failed:", error);
      setErrors({ form: "Registration failed. Please try again." });
      setRegistrationSuccess(false);
      setRedirecting(false);
      Alert.alert('Registration Failed', error.message || 'Please try again or contact support.');
    }
  };

  const handleSubmit = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!validateForm()) return;
    await sendOTP();
  };

  const handleResendOtp = () => {
    setOtp(['', '', '', '', '', '']);
    setErrors({});
    sendOTP();
  };

  const isOtpComplete = otp.join('').length === 6;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <LinearGradient
        colors={['#050505', '#1a0b2e', '#2e1065']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView 
            contentContainerStyle={{ 
              flexGrow: 1, 
              justifyContent: 'center', 
              padding: 20,
              minHeight: height - 100
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Logo Section */}
            <View style={{ alignItems: 'center', marginBottom: 40 }}>
              <View style={{
                shadowColor: '#a855f7', 
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6, 
                shadowRadius: 20, 
                elevation: 10,
              }}>
                <View style={{
                  width: 100, 
                  height: 100, 
                  borderRadius: 50, 
                  backgroundColor: '#000',
                  borderWidth: 2, 
                  borderColor: '#9333ea', 
                  overflow: 'hidden',
                  alignItems: 'center', 
                  justifyContent: 'center',
                }}>
                  <Image 
                    source={require('../assets/images/logo.jpg')} 
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                </View>
              </View>
              <Text style={{ 
                color: '#fff', 
                fontSize: 28, 
                fontWeight: 'bold', 
                marginTop: 20 
              }}>
                {step === 'registration' ? 'Create Account' : 'Verify Phone'}
              </Text>
              <Text style={{ 
                color: '#a855f7', 
                fontSize: 14, 
                fontWeight: '500', 
                marginTop: 5, 
                textAlign: 'center' 
              }}>
                {step === 'registration' 
                  ? 'Join our delivery network' 
                  : `Enter the code sent to +${selectedCountry.phone}${formData.phone.replace(/\D/g, '')}`}
              </Text>
            </View>

            {/* Status Messages */}
            {errors.form && (
              <View style={{ 
                backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                borderLeftWidth: 4, 
                borderLeftColor: '#ef4444', 
                borderRadius: 8, 
                padding: 12, 
                marginBottom: 20,
              }}>
                <Text style={{ 
                  color: '#fca5a5', 
                  fontSize: 13, 
                  fontWeight: '600', 
                  textAlign: 'center'
                }}>
                  {errors.form}
                </Text>
              </View>
            )}

            {success && (
              <View style={{ 
                backgroundColor: 'rgba(34, 197, 94, 0.1)', 
                borderLeftWidth: 4, 
                borderLeftColor: '#22c55e', 
                borderRadius: 8, 
                padding: 12, 
                marginBottom: 20,
              }}>
                <Text style={{ 
                  color: '#86efac', 
                  fontSize: 13, 
                  fontWeight: '600', 
                  textAlign: 'center'
                }}>
                  {success}
                </Text>
              </View>
            )}

            {!dbInitialized && (
              <View style={{ 
                backgroundColor: 'rgba(59, 130, 246, 0.1)', 
                borderLeftWidth: 4, 
                borderLeftColor: '#3b82f6', 
                borderRadius: 8, 
                padding: 12, 
                marginBottom: 20,
              }}>
                <Text style={{ 
                  color: '#93c5fd', 
                  fontSize: 13, 
                  fontWeight: '600', 
                  textAlign: 'center'
                }}>
                  Initializing database... Please wait a moment
                </Text>
              </View>
            )}

            {/* ========== GOOGLE SIGN-UP BUTTON ========== */}
            {step === 'registration' && (
              <View style={{ marginBottom: 30, alignItems: 'center' }}>
                <TouchableOpacity 
                  onPress={handleGoogleSignUp} 
                  disabled={googleLoading || !dbInitialized}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#fff',
                    borderRadius: 16,
                    paddingVertical: 18,
                    paddingHorizontal: 24,
                    width: '100%',
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.1,
                    shadowRadius: 8,
                    elevation: 5,
                    opacity: (googleLoading || !dbInitialized) ? 0.7 : 1,
                  }}
                >
                  {googleLoading ? (
                    <ActivityIndicator size="small" color="#DB4437" style={{ marginRight: 10 }} />
                  ) : (
                    <FontAwesome name="google" size={24} color="#DB4437" />
                  )}
                  <Text style={{ 
                    color: '#000', 
                    fontSize: 18, 
                    fontWeight: 'bold', 
                    marginLeft: 14 
                  }}>
                    {googleLoading ? 'Signing up with Google...' : 'Sign up with Google'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}


           
            
            {/* Footer Links */}
            {step === 'registration' && (
              <View style={{ 
                marginTop: 30, 
                alignItems: 'center', 
                gap: 15 
              }}>
                <TouchableOpacity 
                  onPress={() => router.replace('/(tabs)')} 
                  disabled={isLoading || !dbInitialized || googleLoading}
                >
                  <Text style={{ 
                    color: '#fff', 
                    fontWeight: 'bold', 
                    fontSize: 15, 
                    opacity: (isLoading || !dbInitialized || googleLoading) ? 0.7 : 1 
                  }}>
                    Already have an account? Log in
                  </Text>
                </TouchableOpacity>
                
                <Text style={{ 
                  color: '#6b7280', 
                  fontSize: 12, 
                  textAlign: 'center' 
                }}>
                  By continuing, you agree to our Terms of Service
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>

      {/* Country Picker Modal */}
      <Modal
        visible={showCountryPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#0f0f12' }}>
          <View style={{ flex: 1 }}>
            <View style={{ 
              flexDirection: 'row', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              padding: 20, 
              borderBottomWidth: 1, 
              borderBottomColor: '#27272a' 
            }}>
              <Text style={{ 
                color: '#fff', 
                fontSize: 18, 
                fontWeight: 'bold' 
              }}>
                Select Country
              </Text>
              <TouchableOpacity 
                onPress={() => setShowCountryPicker(false)} 
                style={{ 
                  backgroundColor: '#27272a', 
                  padding: 8, 
                  borderRadius: 20 
                }}
              >
                <Text style={{ color: '#fff' }}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {countryList.map((country) => (
                <TouchableOpacity
                  key={country.code}
                  onPress={() => handleCountrySelect(country)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: '#1f1f23',
                    backgroundColor: selectedCountry.code === country.code ? 'rgba(147, 51, 234, 0.1)' : 'transparent'
                  }}
                >
                  <Text style={{ fontSize: 28, marginRight: 16 }}>{country.emoji}</Text>
                  <Text style={{ color: '#fff', flex: 1 }}>{country.name}</Text>
                  <Text style={{ color: '#9ca3af' }}>+{country.phone}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}