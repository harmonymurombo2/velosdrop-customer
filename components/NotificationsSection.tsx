// components/customer/NotificationsSection.tsx
import { useUser } from '@/app/context/UserContext';
import { Feather, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import PubNub from 'pubnub';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const { width, height } = Dimensions.get('window');
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://www.velosdrop.com').replace(/\/$/, '');

// Enhanced type definitions with proper null handling
interface MessageNotification {
  id: number;
  type: 'message';
  senderType: 'driver' | 'customer';
  senderId: number;
  deliveryId: number;
  content: string;
  timestamp: string;
  read: boolean;
  driverName?: string;
  driverId?: number;
  deliveryDetails?: {
    pickupLocation: string;
    dropoffLocation: string;
    fare: number;
    status: string;
  };
}

interface ChatMessage {
  id?: number;
  deliveryId: number;
  senderType: 'customer' | 'driver' | 'system';
  senderId: number;
  messageType: 'text' | 'image';
  content: string;
  imageUrl?: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsSectionProps {
  onClose?: () => void;
}

// Function to show persistent notification
const showPersistentNotification = async (title: string, body: string, data?: any) => {
  try {
    // Schedule notification that will persist
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: 'notesound.mp3',
        badge: 1,
        // These settings make it persistent
        priority: 'high',
        autoDismiss: false,
        sticky: true,
      },
      trigger: null, // Show immediately
    });

    // Update badge count
    const currentBadgeCount = await Notifications.getBadgeCountAsync();
    await Notifications.setBadgeCountAsync(currentBadgeCount + 1);
    
    console.log('✅ Persistent notification shown:', title);
    
  } catch (error) {
    console.error('❌ Error showing persistent notification:', error);
  }
};

// Function to request notification permissions
// Function to request notification permissions
const setupNotificationPermissions = async () => {
  try {
    // For iOS, we need to explicitly request permissions
    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.log('Notification permission not granted');
        return false;
      }
      
      return true;
    }
  } catch (error) {
    console.error('Error setting up notification permissions:', error);
  }
  return false;
};

export default function NotificationsSection({ onClose }: NotificationsSectionProps) {
  const { customer } = useUser();
  const [notifications, setNotifications] = useState<MessageNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChatModal, setShowChatModal] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<{
    deliveryId: number;
    driverId: number;
    customerId: number;
    driverName: string;
  } | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [attachingImage, setAttachingImage] = useState(false);

  // PubNub state
  const [pubnub, setPubnub] = useState<PubNub | null>(null);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  // Set up notification permissions when component mounts
  useEffect(() => {
    const setupNotifications = async () => {
      const hasPermission = await setupNotificationPermissions();
      if (hasPermission && Device.isDevice) {
        // Get token for potential future use (like push notifications)
        try {
          const token = await Notifications.getExpoPushTokenAsync({
            projectId: Constants.expoConfig?.extra?.eas?.projectId,
          });
          console.log('Expo push token:', token.data);
        } catch (error) {
          console.log('Could not get push token:', error);
        }
      }
    };

    setupNotifications();

    // Clear badge count when user opens notifications section
    const clearBadge = async () => {
      await Notifications.setBadgeCountAsync(0);
    };
    
    clearBadge();

  }, []);

  // Initialize PubNub
  useEffect(() => {
    if (!customer?.id) return;

    const pubnubClient = new PubNub({
      publishKey: process.env.EXPO_PUBLIC_PUBNUB_PUBLISH_KEY || 'demo',
      subscribeKey: process.env.EXPO_PUBLIC_PUBNUB_SUBSCRIBE_KEY || 'demo',
      uuid: `customer_${customer.id}`,
    });

    setPubnub(pubnubClient);

    const listener = {
      message: (event: any) => {
        console.log('📨 PubNub message received:', event.message);
        
        // Handle new messages in customer notification channel
        if (event.message.type === 'NEW_MESSAGE') {
          const newNotification = event.message.data;
          
          // 🔥 Show persistent notification even when app is closed
          showPersistentNotification(
            'New Message from Driver',
            newNotification.content.length > 50 
              ? `${newNotification.content.substring(0, 50)}...` 
              : newNotification.content,
            {
              deliveryId: newNotification.deliveryId,
              driverId: newNotification.driverId,
              driverName: newNotification.driverName || 'Driver',
              type: 'message',
              timestamp: Date.now()
            }
          );
          
          setNotifications(prev => {
            const exists = prev.some(n => 
              n.id === newNotification.id || 
              (n.deliveryId === newNotification.deliveryId && 
               n.timestamp === newNotification.createdAt)
            );
            
            if (!exists) {
              return [newNotification, ...prev];
            }
            return prev;
          });
          
          setUnreadCount(prev => prev + 1);
        }
        
        // Handle chat messages in delivery channel
        if (selectedDelivery && event.channel === `delivery_${selectedDelivery.deliveryId}`) {
          if (event.message.type === 'CHAT_MESSAGE') {
            const newChatMessage = event.message.data;
            
            // Show notification for new chat messages (except from yourself)
            if (newChatMessage.senderType !== 'customer') {
              showPersistentNotification(
                `${selectedDelivery.driverName || 'Driver'}`,
                newChatMessage.messageType === 'image' 
                  ? 'Sent a photo' 
                  : newChatMessage.content.length > 50
                    ? `${newChatMessage.content.substring(0, 50)}...`
                    : newChatMessage.content,
                {
                  deliveryId: selectedDelivery.deliveryId,
                  driverId: selectedDelivery.driverId,
                  driverName: selectedDelivery.driverName,
                  type: 'chat_message',
                  timestamp: Date.now()
                }
              );
            }
            
            setChatMessages(prev => {
              const exists = prev.some(m => 
                m.id === newChatMessage.id && 
                m.createdAt === newChatMessage.createdAt
              );
              return !exists ? [...prev, newChatMessage] : prev;
            });
          }
        }
      },
      status: (event: any) => {
        console.log('📡 PubNub status:', event.category);
      }
    };

    pubnubClient.addListener(listener);

    // Subscribe to customer notifications channel
    const customerChannel = `customer_${customer.id}_notifications`;
    pubnubClient.subscribe({
      channels: [customerChannel],
      withPresence: true
    });

    return () => {
      pubnubClient.removeListener(listener);
      pubnubClient.unsubscribeAll();
    };
  }, [customer, selectedDelivery]);

  // Subscribe to delivery chat when modal opens
  useEffect(() => {
    if (showChatModal && selectedDelivery && pubnub) {
      const deliveryChannel = `delivery_${selectedDelivery.deliveryId}`;
      
      pubnub.subscribe({
        channels: [deliveryChannel],
        withPresence: true
      });

      return () => {
        pubnub.unsubscribe({
          channels: [deliveryChannel]
        });
      };
    }
  }, [showChatModal, selectedDelivery, pubnub]);

  // Pulse animation for unread notifications
  useEffect(() => {
    if (unreadCount > 0) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [unreadCount]);

  // Entry animation
  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Fetch notifications from API
  const fetchAllNotifications = useCallback(async () => {
    if (!customer?.id) return;

    try {
      // Fetch unread count
      const countResponse = await fetch(
        `${API_BASE_URL}/api/customer/${customer.id}/unread-message-count`
      );
      
      if (countResponse.ok) {
        const countData = await countResponse.json();
        setUnreadCount(countData.count || 0);
      }

      // Fetch notifications
      const notificationsResponse = await fetch(
        `${API_BASE_URL}/api/customer/${customer.id}/notifications`
      );
      
      if (!notificationsResponse.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const { notifications: rawNotifications } = await notificationsResponse.json();
      
      // Transform the data
      const formattedNotifications: MessageNotification[] = rawNotifications.map((item: any) => ({
        id: item.message.id,
        type: 'message' as const,
        senderType: item.message.senderType,
        senderId: item.message.senderId,
        deliveryId: item.delivery.id,
        content: item.message.content,
        timestamp: item.message.createdAt,
        read: item.message.isRead,
        driverName: item.driver 
          ? `${item.driver.firstName} ${item.driver.lastName}`
          : 'Driver',
        driverId: item.delivery.assignedDriverId,
        deliveryDetails: {
          pickupLocation: item.delivery.pickupAddress || item.delivery.pickupLocation || '',
          dropoffLocation: item.delivery.dropoffAddress || item.delivery.dropoffLocation || '',
          fare: item.delivery.fare || 0,
          status: item.delivery.status || 'pending'
        }
      }));

      setNotifications(formattedNotifications);
      setError(null);
      
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setError('Failed to load messages. Please try again.');
      setNotifications([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customer]);

  // Initial fetch
  useEffect(() => {
    if (customer?.id) {
      fetchAllNotifications();
    }
  }, [customer, fetchAllNotifications]);

  // Load chat messages when modal opens
  useEffect(() => {
    if (showChatModal && selectedDelivery) {
      loadChatMessages();
    }
  }, [showChatModal, selectedDelivery]);

  const loadChatMessages = async () => {
    if (!selectedDelivery) return;
    
    setChatLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/messages?deliveryId=${selectedDelivery.deliveryId}`
      );
      
      if (response.ok) {
        const data = await response.json();
        setChatMessages(data);
      } else {
        throw new Error('Failed to load chat messages');
      }
    } catch (error) {
      console.error('Error loading chat messages:', error);
      Alert.alert('Error', 'Failed to load chat messages');
    } finally {
      setChatLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedDelivery || !customer || isSending || !pubnub) return;

    setIsSending(true);
    
    const messageToSend: ChatMessage = {
      deliveryId: selectedDelivery.deliveryId,
      senderType: 'customer',
      senderId: customer.id,
      messageType: 'text',
      content: newMessage.trim(),
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    try {
      // Save to database via API
      const response = await fetch(`${API_BASE_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageToSend),
      });

      if (response.ok) {
        const savedMessage = await response.json();
        
        // Publish to PubNub
        await pubnub.publish({
          channel: `delivery_${selectedDelivery.deliveryId}`,
          message: {
            type: 'CHAT_MESSAGE',
            data: savedMessage
          }
        });

        // Also send to driver's personal channel
        if (selectedDelivery.driverId) {
          await pubnub.publish({
            channel: `driver_${selectedDelivery.driverId}_chat`,
            message: {
              type: 'NEW_MESSAGE',
              data: {
                ...savedMessage,
                deliveryId: selectedDelivery.deliveryId,
                customerId: customer.id,
                isFromCustomer: true,
                customerName: customer.username
              }
            }
          });
        }

        // Update local state
        setChatMessages(prev => [...prev, savedMessage]);
        setNewMessage('');
      } else {
        const errorText = await response.text();
        throw new Error(`Failed to send message: ${errorText}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const attachImage = async () => {
    try {
      setAttachingImage(true);
      
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant permission to access your photos');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && selectedDelivery && customer && pubnub) {
        const uri = result.assets[0].uri;
        
        // Upload image to server
        const formData = new FormData();
        formData.append('image', {
          uri,
          type: 'image/jpeg',
          name: 'chat-image.jpg',
        } as any);
        formData.append('deliveryId', selectedDelivery.deliveryId.toString());
        formData.append('senderId', customer.id.toString());
        formData.append('senderType', 'customer');
        formData.append('content', 'Photo');

        const uploadResponse = await fetch(`${API_BASE_URL}/api/messages/image`, {
          method: 'POST',
          body: formData,
        });

        if (uploadResponse.ok) {
          const imageMessage = await uploadResponse.json();
          
          // Publish to PubNub
          await pubnub.publish({
            channel: `delivery_${selectedDelivery.deliveryId}`,
            message: {
              type: 'CHAT_MESSAGE',
              data: imageMessage
            }
          });

          // Update local state
          setChatMessages(prev => [...prev, imageMessage]);
        } else {
          throw new Error('Failed to upload image');
        }
      }
    } catch (error) {
      console.error('Error attaching image:', error);
      Alert.alert('Error', 'Failed to attach image');
    } finally {
      setAttachingImage(false);
    }
  };

  const markAsRead = async (notificationId: number) => {
    try {
      await fetch(`${API_BASE_URL}/api/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: notificationId,
          readerId: customer?.id,
          readerType: 'customer'
        }),
      });
      
      setNotifications(prev =>
        prev.map(notif =>
          notif.id === notificationId ? { ...notif, read: true } : notif
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
      
      if (unreadIds.length === 0) return;
      
      // Mark all unread messages as read
      await fetch(`${API_BASE_URL}/api/messages/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: unreadIds.length > 0 ? notifications[0].deliveryId : null,
          readerId: customer?.id,
          readerType: 'customer'
        }),
      });
      
      setNotifications(prev =>
        prev.map(notif => ({ ...notif, read: true }))
      );
      setUnreadCount(0);
      
      // Clear badge count
      await Notifications.setBadgeCountAsync(0);
      
      Alert.alert('Success', 'All messages marked as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
      Alert.alert('Error', 'Failed to mark all as read');
    }
  };

  const openChat = (deliveryId: number, driverId: number, driverName: string) => {
    if (!customer?.id || !driverId) return;
    
    setSelectedDelivery({
      deliveryId,
      driverId,
      customerId: customer.id,
      driverName
    });
    setShowChatModal(true);
    
    // Mark all notifications for this delivery as read
    const deliveryNotifications = notifications.filter(n => 
      n.deliveryId === deliveryId && !n.read
    );
    
    deliveryNotifications.forEach(n => markAsRead(n.id));
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatChatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAllNotifications();
  }, [fetchAllNotifications]);

  // Loading skeleton
  if (loading) {
    return (
      <LinearGradient
        colors={['#030712', '#111827']}
        style={styles.container}
      >
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <View style={[styles.skeleton, { width: 120, height: 24 }]} />
            <View style={[styles.skeleton, { width: 180, height: 16, marginTop: 4 }]} />
          </View>
          <View style={[styles.skeleton, { width: 80, height: 32 }]} />
        </View>
        
        <ScrollView style={styles.notificationsContainer}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.notificationSkeleton}>
              <View style={styles.notificationSkeletonIcon} />
              <View style={styles.notificationSkeletonContent}>
                <View style={[styles.skeleton, { width: '40%', height: 16 }]} />
                <View style={[styles.skeleton, { width: '80%', height: 40, marginTop: 8 }]} />
                <View style={[styles.skeleton, { width: '60%', height: 60, marginTop: 12 }]} />
              </View>
            </View>
          ))}
        </ScrollView>
      </LinearGradient>
    );
  }

  // Error state
  if (error) {
    return (
      <LinearGradient
        colors={['#030712', '#111827']}
        style={styles.container}
      >
        <View style={styles.errorContainer}>
          <View style={styles.errorIconContainer}>
            <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          </View>
          <Text style={styles.errorTitle}>Error Loading Messages</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={fetchAllNotifications}
            style={styles.retryButton}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={['#030712', '#111827']}
      style={styles.container}
    >
      <Animated.View 
        style={[
          styles.animatedContainer,
          {
            opacity: slideAnim,
            transform: [
              { translateY: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0]
              })},
              { scale: scaleAnim }
            ]
          }
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Messages</Text>
            <Text style={styles.headerSubtitle}>Chat with your delivery drivers</Text>
          </View>
          
          <View style={styles.headerActions}>
            {unreadCount > 0 ? (
              <>
                <TouchableOpacity
                  onPress={markAllAsRead}
                  style={styles.markAllReadButton}
                >
                  <Text style={styles.markAllReadText}>Mark all read</Text>
                </TouchableOpacity>
                <Animated.View 
                  style={[
                    styles.unreadBadge,
                    { transform: [{ scale: pulseAnim }] }
                  ]}
                >
                  <Text style={styles.unreadBadgeText}>{unreadCount} unread</Text>
                </Animated.View>
              </>
            ) : notifications.length > 0 ? (
              <View style={styles.caughtUpBadge}>
                <Text style={styles.caughtUpText}>All caught up</Text>
              </View>
            ) : null}
          </View>
        </View>
        
        {notifications.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconContainer}>
              <Feather name="message-square" size={48} color="#7c3aed" />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>
              Messages from drivers will appear here once they accept your delivery requests
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.notificationsContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={['#7c3aed']}
                tintColor="#7c3aed"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {notifications.map((notification) => (
              <TouchableOpacity
                key={`${notification.id}-${notification.timestamp}`}
                onPress={() => {
                  if (notification.driverId && notification.driverName) {
                    openChat(
                      notification.deliveryId, 
                      notification.driverId, 
                      notification.driverName
                    );
                  } else {
                    Alert.alert('Info', 'Driver information is not available');
                  }
                }}
                style={[
                  styles.notificationCard,
                  notification.read 
                    ? styles.notificationCardRead 
                    : styles.notificationCardUnread
                ]}
                activeOpacity={0.7}
              >
                <View style={styles.notificationHeader}>
                  <View style={styles.notificationIconContainer}>
                    <View style={[
                      styles.notificationIcon,
                      notification.read 
                        ? styles.notificationIconRead 
                        : styles.notificationIconUnread
                    ]}>
                      <Feather name="message-square" size={20} color={notification.read ? "#6b7280" : "white"} />
                    </View>
                    {!notification.read && (
                      <View style={styles.unreadDot} />
                    )}
                  </View>
                  
                  <View style={styles.notificationInfo}>
                    <View style={styles.notificationTitleRow}>
                      <Text style={styles.driverName} numberOfLines={1}>
                        {notification.driverName || 'Driver'}
                      </Text>
                      {notification.deliveryDetails?.status === 'accepted' && (
                        <View style={styles.activeBadge}>
                          <Text style={styles.activeBadgeText}>Active</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.notificationMeta}>
                      {!notification.read && (
                        <Text style={styles.newBadge}>NEW</Text>
                      )}
                      <Text style={styles.timestamp}>
                        {formatTime(notification.timestamp)}
                      </Text>
                    </View>
                  </View>
                </View>
                
                {/* Message Preview */}
                <View style={styles.messagePreview}>
                  <Text style={styles.messagePreviewText} numberOfLines={2}>
                    {notification.content}
                  </Text>
                  {notification.content.startsWith('Photo') && (
                    <View style={styles.photoBadge}>
                      <Feather name="image" size={12} color="#8b5cf6" />
                      <Text style={styles.photoBadgeText}>Photo message</Text>
                    </View>
                  )}
                </View>
                
                {/* Delivery Details */}
                {notification.deliveryDetails && (
                  <View style={styles.deliveryDetails}>
                    <View style={styles.deliveryHeader}>
                      <View style={styles.deliveryId}>
                        <MaterialCommunityIcons name="package-variant" size={14} color="#6b7280" />
                        <Text style={styles.deliveryIdText}>Delivery #{notification.deliveryId}</Text>
                      </View>
                      <Text style={styles.deliveryFare}>
                        ${notification.deliveryDetails.fare.toFixed(2)}
                      </Text>
                    </View>
                    
                    <View style={styles.deliveryLocations}>
                      <View style={styles.locationRow}>
                        <MaterialCommunityIcons name="map-marker" size={12} color="#10b981" />
                        <Text style={styles.locationText} numberOfLines={1}>
                          {notification.deliveryDetails.pickupLocation}
                        </Text>
                      </View>
                      <View style={styles.locationRow}>
                        <MaterialCommunityIcons name="map-marker" size={12} color="#ef4444" />
                        <Text style={styles.locationText} numberOfLines={1}>
                          {notification.deliveryDetails.dropoffLocation}
                        </Text>
                      </View>
                    </View>
                    
                    {/* Reply Section */}
                    <View style={styles.replySection}>
                      <View style={styles.replyPrompt}>
                        <MaterialCommunityIcons 
                          name="arrow-right" 
                          size={12} 
                          color="#6b7280" 
                          style={styles.replyArrow}
                        />
                        <Text style={styles.replyPromptText}>Tap to reply</Text>
                      </View>
                      
                      <TouchableOpacity
                        onPress={() => {
                          if (notification.driverId && notification.driverName) {
                            openChat(
                              notification.deliveryId, 
                              notification.driverId, 
                              notification.driverName
                            );
                          }
                        }}
                        style={styles.replyButton}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="reply" size={14} color="white" />
                        <Text style={styles.replyButtonText}>Reply Now</Text>
                      </TouchableOpacity>
                    </View>
                    
                    {/* Pulsing indicator for unread */}
                    {!notification.read && (
                      <View style={styles.unreadIndicator}>
                        <Animated.View 
                          style={[
                            styles.pulseDot,
                            { transform: [{ scale: pulseAnim }] }
                          ]} 
                        />
                        <Text style={styles.unreadIndicatorText}>
                          New message • Tap to respond
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </Animated.View>

      {/* Chat Modal */}
      <Modal
        visible={showChatModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowChatModal(false)}
      >
        <View style={styles.modalOverlay}>
          <LinearGradient
            colors={['#111827', '#1e1b4b']}
            style={styles.chatModal}
          >
            {/* Header */}
            <LinearGradient
              colors={['#1e1b4b', '#3730a3']}
              style={styles.chatHeader}
            >
              <View style={styles.chatHeaderContent}>
                <View style={styles.chatHeaderLeft}>
                  <View style={styles.chatIconContainer}>
                    <Feather name="message-square" size={24} color="white" />
                  </View>
                  <View>
                    <Text style={styles.chatTitle}>
                      Chat with {selectedDelivery?.driverName || 'Driver'}
                    </Text>
                    <Text style={styles.chatSubtitle}>
                      Delivery #{selectedDelivery?.deliveryId}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setShowChatModal(false)}
                  style={styles.closeButton}
                >
                  <Feather name="x" size={24} color="#9ca3af" />
                </TouchableOpacity>
              </View>
            </LinearGradient>
            
            {/* Messages Container */}
            <ScrollView 
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              ref={(ref) => {
                if (ref) {
                  setTimeout(() => ref.scrollToEnd({ animated: true }), 100);
                }
              }}
            >
              {chatLoading ? (
                <View style={styles.chatLoading}>
                  <ActivityIndicator size="large" color="#8b5cf6" />
                </View>
              ) : chatMessages.length === 0 ? (
                <View style={styles.emptyChat}>
                  <View style={styles.emptyChatIcon}>
                    <Feather name="message-square" size={40} color="#8b5cf6" />
                  </View>
                  <Text style={styles.emptyChatTitle}>Start a conversation</Text>
                  <Text style={styles.emptyChatText}>No messages yet. Say hello!</Text>
                </View>
              ) : (
                chatMessages.map((msg, index) => (
                  <View
                    key={`${msg.id || 'no-id'}-${msg.createdAt}-${index}-${msg.senderId}`}
                    style={[
                      styles.messageBubble,
                      msg.senderType === 'customer' 
                        ? styles.messageBubbleSent 
                        : styles.messageBubbleReceived
                    ]}
                  >
                    <View style={styles.messageHeader}>
                      <Text style={styles.messageSender}>
                        {msg.senderType === 'customer' ? 'You' : selectedDelivery?.driverName || 'Driver'}
                      </Text>
                    </View>
                    
                    {msg.messageType === 'image' && msg.imageUrl ? (
                      <View style={styles.imageMessage}>
                        <Image
                          source={{ uri: msg.imageUrl }}
                          style={styles.messageImage}
                          resizeMode="cover"
                        />
                        <Text style={styles.imageCaption}>{msg.content}</Text>
                      </View>
                    ) : (
                      <Text style={styles.messageText}>{msg.content}</Text>
                    )}
                    
                    <Text style={styles.messageTime}>
                      {formatChatTime(msg.createdAt)}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
            
            {/* Input Area */}
            <LinearGradient
              colors={['#1f2937', '#111827']}
              style={styles.inputContainer}
            >
              <View style={styles.inputRow}>
                <TouchableOpacity
                  onPress={attachImage}
                  disabled={attachingImage}
                  style={styles.attachButton}
                >
                  {attachingImage ? (
                    <ActivityIndicator size="small" color="#8b5cf6" />
                  ) : (
                    <Feather name="paperclip" size={20} color="#9ca3af" />
                  )}
                </TouchableOpacity>
                
                <TextInput
                  value={newMessage}
                  onChangeText={setNewMessage}
                  placeholder="Type your message..."
                  placeholderTextColor="#6b7280"
                  style={styles.messageInput}
                  multiline
                  maxLength={500}
                  editable={!isSending}
                />
                
                <TouchableOpacity
                  onPress={sendMessage}
                  disabled={!newMessage.trim() || isSending}
                  style={[
                    styles.sendButton,
                    (!newMessage.trim() || isSending) && styles.sendButtonDisabled
                  ]}
                >
                  {isSending ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Text style={styles.sendButtonText}>Send</Text>
                      <Feather name="send" size={16} color="white" />
                    </>
                  )}
                </TouchableOpacity>
              </View>
              <Text style={styles.inputHint}>
                Press Enter to send • All messages are saved
              </Text>
            </LinearGradient>
          </LinearGradient>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  animatedContainer: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#8b5cf6',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  markAllReadButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  markAllReadText: {
    fontSize: 12,
    color: '#8b5cf6',
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  unreadBadgeText: {
    fontSize: 12,
    color: 'white',
    fontWeight: 'bold',
  },
  caughtUpBadge: {
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  caughtUpText: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  notificationsContainer: {
    flex: 1,
  },
  notificationCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  notificationCardRead: {
    borderColor: 'rgba(75, 85, 99, 0.3)',
  },
  notificationCardUnread: {
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  notificationIconContainer: {
    position: 'relative',
    marginRight: 12,
  },
  notificationIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationIconRead: {
    backgroundColor: 'rgba(75, 85, 99, 0.3)',
  },
  notificationIconUnread: {
    backgroundColor: '#7c3aed',
  },
  unreadDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#111827',
  },
  notificationInfo: {
    flex: 1,
  },
  notificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginRight: 8,
    flex: 1,
  },
  activeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  activeBadgeText: {
    fontSize: 10,
    color: '#10b981',
    fontWeight: '600',
  },
  notificationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  newBadge: {
    fontSize: 10,
    color: '#8b5cf6',
    fontWeight: 'bold',
  },
  timestamp: {
    fontSize: 12,
    color: '#6b7280',
  },
  messagePreview: {
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  messagePreviewText: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
  },
  photoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  photoBadgeText: {
    fontSize: 12,
    color: '#8b5cf6',
  },
  deliveryDetails: {
    backgroundColor: 'rgba(17, 24, 39, 0.3)',
    borderRadius: 16,
    padding: 16,
  },
  deliveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  deliveryId: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deliveryIdText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  deliveryFare: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  deliveryLocations: {
    gap: 8,
    marginBottom: 16,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationText: {
    fontSize: 12,
    color: '#d1d5db',
    flex: 1,
  },
  replySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(75, 85, 99, 0.3)',
  },
  replyPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  replyArrow: {
    transform: [{ rotate: '180deg' }],
  },
  replyPromptText: {
    fontSize: 12,
    color: '#6b7280',
  },
  replyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  replyButtonText: {
    fontSize: 12,
    color: 'white',
    fontWeight: '600',
  },
  unreadIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#8b5cf6',
  },
  unreadIndicatorText: {
    fontSize: 12,
    color: '#8b5cf6',
  },
  skeleton: {
    backgroundColor: 'rgba(75, 85, 99, 0.3)',
    borderRadius: 8,
  },
  notificationSkeleton: {
    backgroundColor: 'rgba(31, 41, 55, 0.3)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
  },
  notificationSkeletonIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(75, 85, 99, 0.3)',
    marginRight: 12,
  },
  notificationSkeletonContent: {
    flex: 1,
    gap: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ef4444',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    padding: 16,
  },
  chatModal: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    maxHeight: height * 0.85,
  },
  chatHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(139, 92, 246, 0.3)',
  },
  chatHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  chatIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chatTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  chatSubtitle: {
    fontSize: 14,
    color: '#a78bfa',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
  },
  messagesContent: {
    padding: 16,
  },
  chatLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
  },
  emptyChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 200,
  },
  emptyChatIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyChatTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    marginBottom: 8,
  },
  emptyChatText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 20,
    padding: 12,
    marginBottom: 12,
  },
  messageBubbleSent: {
    backgroundColor: '#7c3aed',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  messageBubbleReceived: {
    backgroundColor: '#374151',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  messageHeader: {
    marginBottom: 4,
  },
  messageSender: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  messageText: {
    fontSize: 14,
    color: 'white',
    lineHeight: 20,
  },
  imageMessage: {
    marginBottom: 4,
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
  },
  imageCaption: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  messageTime: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'right',
    marginTop: 4,
  },
  inputContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(75, 85, 99, 0.3)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  attachButton: {
    padding: 8,
  },
  messageInput: {
    flex: 1,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: 'white',
    fontSize: 14,
    maxHeight: 100,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  inputHint: {
    fontSize: 10,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
  },
});