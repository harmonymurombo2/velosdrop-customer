// app/context/UserContext.tsx
import * as SecureStore from 'expo-secure-store';
import React, { ReactNode, createContext, useContext, useEffect, useState } from 'react';
// Import the DB update functions
import { syncCustomerToCloud, updateUserProfilePicture } from '@/src/db';

interface Customer {
  id: number;
  username: string;
  phoneNumber: string;
  email?: string; // Optional field
  profilePictureUrl?: string;
}

interface UserContextType {
  customer: Customer | null;
  setCustomer: (customer: Customer | null) => Promise<void>;
  clearUser: () => Promise<void>;
  updateProfilePicture: (url: string) => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Load user from SecureStore on mount
  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const storedCustomer = await SecureStore.getItemAsync('customerData');
      if (storedCustomer) {
        const customerData = JSON.parse(storedCustomer);
        setCustomerState(customerData);
        setIsAuthenticated(true);
        console.log('✅ User loaded from SecureStore:', customerData.username);
        
        // Sync this customer to cloud when loading from storage
        try {
          console.log('🔄 Syncing loaded customer to cloud...');
          await syncCustomerToCloud(customerData.id);
          console.log('✅ Loaded customer synced to cloud');
        } catch (syncError) {
          console.warn('⚠️ Could not sync loaded customer to cloud:', syncError);
          // Don't fail loading if sync fails
        }
      } else {
        console.log('ℹ️ No user found in SecureStore');
      }
    } catch (error) {
      console.error('❌ Failed to load user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateCustomer = async (newCustomer: Customer | null) => {
    setCustomerState(newCustomer);
    setIsAuthenticated(!!newCustomer);
    
    try {
      if (newCustomer) {
        await SecureStore.setItemAsync('customerData', JSON.stringify(newCustomer));
        console.log('✅ User saved to SecureStore:', newCustomer.username);
        
        // CRITICAL: Sync this customer to cloud immediately
        try {
          console.log('🔄 Syncing customer to cloud after login...');
          await syncCustomerToCloud(newCustomer.id);
          console.log('✅ Customer synced to cloud');
        } catch (syncError) {
          console.error('⚠️ Cloud sync failed:', syncError);
          // Don't fail the login if sync fails - proceed anyway
        }
        
      } else {
        await SecureStore.deleteItemAsync('customerData');
        console.log('✅ User cleared from SecureStore');
      }
    } catch (error) {
      console.error('❌ Failed to save user data:', error);
    }
  };

  const clearUser = async () => {
    setCustomerState(null);
    setIsAuthenticated(false);
    try {
      await SecureStore.deleteItemAsync('customerData');
      await SecureStore.deleteItemAsync('customer-auth-token'); // ✅ ADD THIS LINE
      await SecureStore.deleteItemAsync('customer-id');
      await SecureStore.deleteItemAsync('customer-username');
      await SecureStore.deleteItemAsync('customer-phone');
      await SecureStore.deleteItemAsync('customer-email');
      await SecureStore.deleteItemAsync('customer-profile-picture');
      await SecureStore.deleteItemAsync('customer-status');
      console.log('✅ All user data cleared from SecureStore');
    } catch (error) {
      console.error('❌ Failed to clear user data:', error);
    }
  };

  const updateProfilePicture = async (url: string) => {
    if (!customer) {
      throw new Error('No customer logged in');
    }
    
    try {
      console.log('🖼️ Updating profile picture for customer:', customer.id);
      
      // 1. Update in the database (Cloud Turso + Local SQLite)
      await updateUserProfilePicture(customer.id, url);

      // 2. Sync the customer to cloud to ensure all data is up to date
      await syncCustomerToCloud(customer.id);

      // 3. Update local state and SecureStore
      const updatedCustomer = { ...customer, profilePictureUrl: url };
      await updateCustomer(updatedCustomer);
      
      console.log('✅ Profile picture updated successfully in Context');
    } catch (error) {
      console.error('❌ Error updating profile picture:', error);
      throw error;
    }
  };

  return (
    <UserContext.Provider value={{ 
      customer, 
      setCustomer: updateCustomer, 
      clearUser,
      updateProfilePicture,
      isLoading,
      isAuthenticated 
    }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
