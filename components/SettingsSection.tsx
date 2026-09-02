//components/SettingsSection.tsx
import { useUser } from '@/app/context/UserContext';
import { db } from '@/src/db';
import { customersTable } from '@/src/db/schema';
import { Ionicons } from '@expo/vector-icons';
import { eq } from 'drizzle-orm';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface SettingsData {
  username: string;
  phoneNumber: string;
}

export default function SettingsSection() {
  const { customer, updateProfilePicture } = useUser();
  const [settings, setSettings] = useState<SettingsData>({
    username: '',
    phoneNumber: '',
  });
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (customer) {
      setSettings({
        username: customer.username || '',
        phoneNumber: customer.phoneNumber || '',
      });
    }
  }, [customer]);

  const handleSaveChanges = async () => {
    if (!customer) return;
    
    try {
      setIsSaving(true);
      
      await db.update(customersTable)
        .set({
          username: settings.username.trim(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(customersTable.id, customer.id));
      
      Alert.alert('Success', 'Profile updated successfully!');
    } catch (error) {
      console.error('Error updating settings:', error);
      Alert.alert('Error', 'Failed to save changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleProfileImageChange = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please allow access to photos');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled) {
        setIsUploading(true);
        const uri = result.assets[0].uri;
        
        try {
          await updateProfilePicture(uri);
          Alert.alert('Success', 'Profile picture updated');
        } catch (error) {
          Alert.alert('Error', 'Failed to upload image');
        } finally {
          setIsUploading(false);
        }
      }
    } catch (error) {
      setIsUploading(false);
    }
  };

  if (!customer) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        
        {/* Profile Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleProfileImageChange} disabled={isUploading}>
            <View style={styles.avatarContainer}>
              {customer?.profilePictureUrl ? (
                <Image source={{ uri: customer.profilePictureUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={40} color="#a855f7" />
                </View>
              )}
              
              {isUploading ? (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator color="white" />
                </View>
              ) : (
                <View style={styles.editIconBadge}>
                  <Ionicons name="camera" size={14} color="white" />
                </View>
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.headerName}>{settings.username || 'User'}</Text>
          <Text style={styles.headerPhone}>{settings.phoneNumber}</Text>
        </View>

        <View style={styles.content}>
          {/* Section: Edit Details */}
          <Text style={styles.sectionHeader}>Personal Details</Text>
          <View style={styles.card}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                value={settings.username}
                onChangeText={(text) => setSettings({...settings, username: text})}
                placeholder="Enter username"
                placeholderTextColor="#6b7280"
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Phone Number</Text>
              <View style={styles.disabledInput}>
                <Text style={styles.disabledText}>{settings.phoneNumber}</Text>
                <Ionicons name="lock-closed" size={16} color="#6b7280" />
              </View>
            </View>
            
            <TouchableOpacity 
              style={styles.saveButton}
              onPress={handleSaveChanges}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.saveButtonText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Section: Preferences */}
          <Text style={styles.sectionHeader}>Preferences</Text>
          <View style={styles.card}>
            <View style={styles.rowItem}>
              <View>
                <Text style={styles.rowTitle}>Notifications</Text>
                <Text style={styles.rowSubtitle}>Receive updates about orders</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                trackColor={{ false: '#374151', true: '#a855f7' }}
                thumbColor="#ffffff"
              />
            </View>
          </View>

          {/* Section: Support */}
          <Text style={styles.sectionHeader}>Support</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.rowItem}>
              <View style={styles.rowLeft}>
                <Ionicons name="help-circle-outline" size={22} color="#a855f7" />
                <Text style={[styles.rowTitle, { marginLeft: 12 }]}>Help Center</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#6b7280" />
            </TouchableOpacity>
            
            <View style={styles.divider} />

            <TouchableOpacity style={styles.rowItem}>
              <View style={styles.rowLeft}>
                <Ionicons name="document-text-outline" size={22} color="#a855f7" />
                <Text style={[styles.rowTitle, { marginLeft: 12 }]}>Terms of Service</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712', // Dark background
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#030712',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 30,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#1f2937',
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#1f2937',
  },
  uploadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 50,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  editIconBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#a855f7',
    padding: 8,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#111827',
  },
  headerName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  headerPhone: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 4,
  },
  content: {
    padding: 20,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a855f7',
    marginBottom: 12,
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    color: '#9ca3af',
    marginBottom: 8,
    fontSize: 14,
  },
  input: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  disabledInput: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    opacity: 0.7,
  },
  disabledText: {
    color: '#9ca3af',
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#a855f7',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTitle: {
    fontSize: 16,
    color: 'white',
    fontWeight: '500',
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#1f2937',
    marginVertical: 12,
  },
  logoutButton: {
    alignItems: 'center',
    padding: 16,
    marginBottom: 20,
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: '600',
  },
});