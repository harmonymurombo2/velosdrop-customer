// app/(tabs)/index.tsx
import { useUser } from '@/app/context/UserContext';
import { insertGoogleUserToCloud, syncCustomerToCloud } from '@/src/db';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Database imports
import { db, fixDatabaseSchema, initializeCustomerData, initializeDatabase } from '@/src/db';
import { customersTable } from '@/src/db/schema';
import { eq } from 'drizzle-orm';

// Google Sign-In
import { googleAuthService } from '@/src/db/services/google-auth.service';

const { width } = Dimensions.get('window');

export default function CustomerLogin() {
  const { setCustomer, customer, isLoading: userLoading } = useUser();
  
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!userLoading && customer) {
      console.log('✅ Already logged in, auto-redirecting to dashboard');
      router.replace('/customer-dashboard');
    }
  }, [customer, userLoading]);

  useEffect(() => {
    initializeAppDatabase();
  }, []);

  const initializeAppDatabase = async () => {
    try {
      console.log('🔧 Initializing app database...');
      await initializeDatabase();
      await fixDatabaseSchema();
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize database:', error);
    }
  };

  const handleGoogleSignIn = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGoogleLoading(true);
    setErrors({});
  
    try {
      console.log('🔐 Starting Google Sign-In...');
      
      // Sign in with Google
      const googleUser = await googleAuthService.signIn();
      if (!googleUser) {
        setGoogleLoading(false);
        return;
      }
  
      console.log('✅ Google Sign-In successful:', googleUser.email);
  
      // Fix database schema
      try {
        await fixDatabaseSchema();
        console.log('✅ Database schema verified');
      } catch (schemaError) {
        console.warn('⚠️ Could not fix schema:', schemaError);
      }
  
      // Check if user exists
      const emailResults = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.email, googleUser.email))
        .limit(1);
      
      let customer = emailResults[0];
  
      // Create new user if doesn't exist
      if (!customer) {
        const username = googleUser.email.split('@')[0];
        const newCustomerData = {
          username,
          email: googleUser.email,
          phoneNumber: null,
          password: null,
          profilePictureUrl: googleUser.photo || null,
          authProvider: 'google',
          googleId: googleUser.id,
          status: 'active',
          isVerified: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastLogin: new Date().toISOString(),
        };
        
        console.log('📝 Creating new Google user:', username);
        
        const insertResult = await db.insert(customersTable).values(newCustomerData).returning();
        customer = insertResult[0];
        
        console.log('✅ Google user created:', customer.id);
        
        // Push to Turso after the first login
        await insertGoogleUserToCloud(username, googleUser.email, googleUser.id, googleUser.photo || null); 
      } else {
        // Update last login
        await db.update(customersTable)
          .set({ 
            lastLogin: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
          .where(eq(customersTable.id, customer.id));
        await syncCustomerToCloud(customer.id);
      }
  
      // Initialize customer data
      try {
        await initializeCustomerData(customer.id);
        console.log('✅ Customer data initialized');
      } catch (initError) {
        console.warn('⚠️ Could not fully initialize customer data:', initError);
      }
  
      // Store customer data
      const customerData = {
        id: customer.id,
        username: customer.username,
        phoneNumber: customer.phoneNumber || '',
        email: customer.email || undefined,
        profilePictureUrl: customer.profilePictureUrl || undefined,
      };
      
      await SecureStore.setItemAsync('customerData', JSON.stringify(customerData));
      await setCustomer(customerData);
      
      // Simple auth token for auto-login
      await SecureStore.setItemAsync('customer-auth-token', 'valid');
      
      console.log('✅ Google Sign-In completed');
      
      // Use replace instead of push to prevent back navigation to login
      router.replace('/customer-dashboard');
      
    } catch (err: any) {
      console.error('❌ Google Sign-In error:', err);
      
      // Don't show alert if user cancelled
      if (!err.message?.includes('cancelled') && err.code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Google Sign-In Failed', 'Please try again.');
        setErrors({ form: 'Google Sign-In failed. Please try again.' });
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={['#050505', '#1a0b2e', '#2e1065']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Logo Section */}
            <View style={styles.logoContainer}>
              <View style={styles.logoShadow}>
                <View style={styles.logoWrapper}>
                  <Image 
                    source={require('../../assets/images/logo.jpg')} 
                    style={styles.logoImage}
                    resizeMode="cover"
                  />
                </View>
              </View>
              <Text style={styles.title}>Login</Text>
              <Text style={styles.subtitle}>Sign in to continue</Text>
            </View>

            {/* Error Message */}
            {errors.form && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errors.form}</Text>
              </View>
            )}

            {/* Google Sign-In Button */}
            <View style={styles.googleButtonContainer}>
              <TouchableOpacity 
                onPress={handleGoogleSignIn} 
                disabled={googleLoading}
                style={[
                  styles.googleButton,
                  googleLoading && styles.disabledButton
                ]}
                activeOpacity={0.7}
              >
                {googleLoading ? (
                  <ActivityIndicator size="small" color="#4285F4" />
                ) : (
                  <>
                    <Image 
                      source={require('../../assets/images/google.jpeg')}
                      style={styles.googleIcon}
                      resizeMode="contain"
                    />
                    <Text style={styles.googleButtonText}>
                      Sign in with Google
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  gradient: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  logoShadow: {
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  logoWrapper: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#9333ea',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 24,
  },
  subtitle: {
    color: '#9ca3af',
    fontSize: 16,
    marginTop: 8,
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  },
  googleButtonContainer: {
    marginBottom: 30,
    alignItems: 'center',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 50,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    maxWidth: 280,
    borderWidth: 1,
    borderColor: '#dadce0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  disabledButton: {
    opacity: 0.7,
  },
  googleIcon: {
    width: 24,
    height: 24,
    marginRight: 12,
  },
  googleButtonText: {
    color: '#3c4043',
    fontSize: 16,
    fontWeight: '500',
  },
  footerContainer: {
    marginTop: 40,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  footerText: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});