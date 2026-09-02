// lib/pubnub.ts - CUSTOMER APP VERSION (FIXED TYPES)
import PubNub from 'pubnub';

// Import database utilities
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { messagesTable } from '../src/db/schema';

// Environment configuration for React Native (Customer App)
const PUBLISH_KEY = process.env.EXPO_PUBLIC_PUBNUB_PUBLISH_KEY || 'demo';
const SUBSCRIBE_KEY = process.env.EXPO_PUBLIC_PUBNUB_SUBSCRIBE_KEY || 'demo';

console.log('🔧 PubNub Customer Config:', {
  publishKey: PUBLISH_KEY?.substring(0, 10) + '...',
  subscribeKey: SUBSCRIBE_KEY?.substring(0, 10) + '...'
});

if (!PUBLISH_KEY || !SUBSCRIBE_KEY) {
  console.warn('⚠️ PubNub keys not found. Using demo keys.');
}

// Message types aligned with your database schema
export const MESSAGE_TYPES = {
  // Delivery request flow
  DELIVERY_REQUESTED: 'delivery_requested',
  DELIVERY_ACCEPTED: 'delivery_accepted',
  DELIVERY_REJECTED: 'delivery_rejected',
  DELIVERY_IN_PROGRESS: 'delivery_in_progress',
  DRIVER_ARRIVED: 'driver_arrived',
  DELIVERY_PICKED_UP: 'delivery_picked_up',
  DELIVERY_IN_TRANSIT: 'delivery_in_transit',
  DELIVERY_DELIVERED: 'delivery_delivered',
  DELIVERY_CANCELLED: 'delivery_cancelled',
  
  // Real-time updates
  DRIVER_LOCATION: 'driver_location',
  DRIVER_ETA: 'driver_eta',
  
  // Chat messages
  CHAT_MESSAGE: 'chat_message',
  CHAT_IMAGE: 'chat_image',
  
  // Payment
  PAYMENT_REQUESTED: 'payment_requested',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  PAYMENT_FAILED: 'payment_failed',
  
  // System notifications
  SYSTEM_NOTIFICATION: 'system_notification',
  STATUS_UPDATE: 'status_update',
  FARE_UPDATE: 'fare_update',
} as const;

// Type for message type values
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

// Channel names aligned with your database
export const CHANNELS = {
  customer: (customerId: string | number) => `customer_${customerId}`,
  delivery: (deliveryId: string | number) => `delivery_${deliveryId}`,
  driverLocations: (driverId?: string | number) => 
    driverId ? `driver_location_${driverId}` : 'driver_locations',
  areaUpdates: (zone: string) => `area_${zone}`,
  promotions: () => 'promotions',
  announcements: () => 'announcements',
  support: (customerId: string | number) => `support_${customerId}`,
} as const;

// Message interface with index signature for PubNub compatibility
interface PubNubMessage {
  type: MessageType;
  data: any;
  senderId: string;
  timestamp: number;
  [key: string]: any; // Index signature for PubNub compatibility
}

// Create a PubNub client for a specific customer - SIMPLIFIED CONFIG
export const createPubNubClient = (userId: string): PubNub => {
  const client = new PubNub({
    publishKey: PUBLISH_KEY,
    subscribeKey: SUBSCRIBE_KEY,
    userId: userId,
    restore: true,
    heartbeatInterval: 120,
    presenceTimeout: 600,
    ssl: true,
    
    // Remove unsupported properties
    // keepAlive: true, // Removed - not in PubNubConfiguration type
    // keepAliveSettings: { // Removed - not in PubNubConfiguration type
    //   keepAliveMsecs: 10000,
    // },
    // dedupeOnSubscribe: true, // Removed - not in PubNubConfiguration type
    // suppressLeaveEvents: true, // Removed - not in PubNubConfiguration type
  });

  console.log(`✅ PubNub client created for customer: ${userId}`);
  return client;
};

// Enhanced publish message that syncs with local database
export const publishMessage = async (
  client: PubNub,
  channel: string,
  messageType: MessageType,
  data: any
): Promise<any> => {
  try {
    const userId = client.getUserId();
    
    // Create message with index signature for PubNub
    const message: Record<string, any> = {
      type: messageType,
      data: data,
      senderId: userId,
      timestamp: Date.now(),
    };

    // Publish to PubNub
    const response = await client.publish({
      channel,
      message,
      storeInHistory: true,
      ttl: 24 * 60 * 60,
    });

    console.log(`📤 Customer message published to ${channel}:`, {
      type: messageType,
      // Access timetoken safely
      messageId: (response as any).timetoken || Date.now(),
      sender: userId,
    });

    // If this is a chat message for a delivery, save to local database
    if (messageType === MESSAGE_TYPES.CHAT_MESSAGE || messageType === MESSAGE_TYPES.CHAT_IMAGE) {
      const deliveryId = extractDeliveryIdFromChannel(channel);
      if (deliveryId) {
        await saveMessageToLocalDB(deliveryId, userId, message);
      }
    }

    return response;
  } catch (error) {
    console.error('❌ Failed to publish message:', error);
    throw error;
  }
};

// Helper to save chat messages to local database
const saveMessageToLocalDB = async (
  deliveryId: number,
  senderId: string,
  message: Record<string, any>
) => {
  try {
    const senderType = senderId.startsWith('customer_') ? 'customer' : 'driver';
    const numericSenderId = parseInt(senderId.replace(/[^\d]/g, '')) || 0;

    await db.insert(messagesTable).values({
      deliveryId: deliveryId,
      senderType: senderType,
      senderId: numericSenderId,
      messageType: message.type === MESSAGE_TYPES.CHAT_IMAGE ? 'image' : 'text',
      content: message.data?.text || message.data?.imageUrl || '',
      imageUrl: message.type === MESSAGE_TYPES.CHAT_IMAGE ? message.data?.imageUrl : null,
      metadata: {
        pubnubTimestamp: message.timestamp,
        ...(message.data?.metadata || {}),
      },
      isRead: false,
      createdAt: new Date(message.timestamp).toISOString(),
    });

    console.log(`💾 Message saved to local DB for delivery ${deliveryId}`);
  } catch (error) {
    console.error('❌ Failed to save message to local DB:', error);
  }
};

// Extract delivery ID from channel name
const extractDeliveryIdFromChannel = (channel: string): number | null => {
  const match = channel.match(/delivery_(\d+)/);
  return match ? parseInt(match[1]) : null;
};

// Enhanced subscribe that syncs with database
export const subscribeToChannels = (
  client: PubNub,
  channels: string[],
  options?: { 
    withPresence?: boolean; 
    withMessageActions?: boolean;
    syncToDatabase?: boolean;
  }
) => {
  try {
    client.subscribe({
      channels,
      withPresence: options?.withPresence || false,
    });

    console.log(`✅ Customer subscribed to channels: ${channels.join(', ')}`);
  } catch (error) {
    console.error('❌ Failed to subscribe to channels:', error);
    throw error;
  }
};

// Unsubscribe from channels
export const unsubscribeFromChannels = (client: PubNub, channels: string[]) => {
  try {
    client.unsubscribe({
      channels,
    });
    console.log(`✅ Customer unsubscribed from channels: ${channels.join(', ')}`);
  } catch (error) {
    console.error('❌ Failed to unsubscribe from channels:', error);
  }
};

// Customer-specific delivery request (simplified without DB)
export const requestDelivery = async (
  client: PubNub,
  customerId: number,
  deliveryData: {
    pickupAddress: string;
    pickupLatitude: number;
    pickupLongitude: number;
    dropoffAddress: string;
    dropoffLatitude: number;
    dropoffLongitude: number;
    fare: number;
    distance: number;
    vehicleType: string;
    packageDetails?: string;
    recipientPhoneNumber?: string;
    customerUsername: string;
  }
): Promise<{ deliveryId: number; pubnubResponse: any }> => {
  try {
    const deliveryId = Date.now();
    const channel = CHANNELS.areaUpdates(getGeohash(deliveryData.pickupLatitude, deliveryData.pickupLongitude));
    
    const response = await publishMessage(
      client,
      channel,
      MESSAGE_TYPES.DELIVERY_REQUESTED,
      {
        deliveryId: deliveryId,
        customerId: customerId,
        ...deliveryData,
        requestTime: Date.now(),
      }
    );

    subscribeToChannels(client, [CHANNELS.delivery(deliveryId)], {
      withPresence: true,
    });

    console.log(`✅ Delivery ${deliveryId} requested and published`);
    return { deliveryId, pubnubResponse: response };
  } catch (error) {
    console.error('❌ Failed to request delivery:', error);
    throw error;
  }
};

// Get geohash for location-based channels
const getGeohash = (lat: number, lng: number, precision: number = 4): string => {
  const roundedLat = Math.round(lat * 1000);
  const roundedLng = Math.round(lng * 1000);
  return `${roundedLat}_${roundedLng}`.substring(0, precision * 2);
};

// Callback types for trackDelivery
interface DeliveryCallbacks {
  onStatusUpdate?: (status: string, data: any) => void;
  onDriverLocation?: (location: { lat: number; lng: number }) => void;
  onChatMessage?: (message: Record<string, any>) => void;
  onDriverArrived?: () => void;
  onDeliveryCompleted?: () => void;
}

// Track delivery with real-time updates
export const trackDelivery = (
  client: PubNub,
  deliveryId: number,
  callbacks: DeliveryCallbacks
) => {
  const deliveryChannel = CHANNELS.delivery(deliveryId);
  
  const listener = {
    message: (event: any) => {
      const { channel, message } = event;
      
      if (channel === deliveryChannel && message) {
        switch (message.type) {
          case MESSAGE_TYPES.DELIVERY_ACCEPTED:
            callbacks.onStatusUpdate?.('accepted', message.data);
            break;
            
          case MESSAGE_TYPES.DELIVERY_REJECTED:
            callbacks.onStatusUpdate?.('rejected', message.data);
            break;
            
          case MESSAGE_TYPES.DELIVERY_IN_PROGRESS:
            callbacks.onStatusUpdate?.('in_progress', message.data);
            break;
            
          case MESSAGE_TYPES.DRIVER_ARRIVED:
            callbacks.onDriverArrived?.();
            callbacks.onStatusUpdate?.('arrived', message.data);
            break;
            
          case MESSAGE_TYPES.DELIVERY_PICKED_UP:
            callbacks.onStatusUpdate?.('picked_up', message.data);
            break;
            
          case MESSAGE_TYPES.DELIVERY_DELIVERED:
            callbacks.onDeliveryCompleted?.();
            callbacks.onStatusUpdate?.('delivered', message.data);
            break;
            
          case MESSAGE_TYPES.DRIVER_LOCATION:
            callbacks.onDriverLocation?.(message.data);
            break;
            
          case MESSAGE_TYPES.CHAT_MESSAGE:
          case MESSAGE_TYPES.CHAT_IMAGE:
            callbacks.onChatMessage?.(message);
            if (message.senderId && message.data) {
              saveMessageToLocalDB(deliveryId, message.senderId, message);
            }
            break;
        }
      }
    },
    
    presence: (event: any) => {
      if (event.channel === deliveryChannel) {
        console.log('👤 Presence event:', event);
      }
    },
    
    status: (event: any) => {
      console.log('📡 PubNub Status:', event.category);
    },
  };

  client.addListener(listener);
  subscribeToChannels(client, [deliveryChannel], {
    withPresence: true,
  });

  return () => {
    client.removeListener(listener);
    unsubscribeFromChannels(client, [deliveryChannel]);
  };
};

// Send chat message to driver
export const sendChatMessage = async (
  client: PubNub,
  deliveryId: number,
  text: string
) => {
  const channel = CHANNELS.delivery(deliveryId);
  
  return publishMessage(client, channel, MESSAGE_TYPES.CHAT_MESSAGE, {
    text,
    timestamp: Date.now(),
  });
};

// Send image message
export const sendImageMessage = async (
  client: PubNub,
  deliveryId: number,
  imageUrl: string,
  caption?: string
) => {
  const channel = CHANNELS.delivery(deliveryId);
  
  return publishMessage(client, channel, MESSAGE_TYPES.CHAT_IMAGE, {
    imageUrl,
    caption,
    timestamp: Date.now(),
  });
};

// Subscribe to customer-specific notifications
export const subscribeToCustomerNotifications = (
  client: PubNub,
  customerId: number,
  onNotification?: (notification: any) => void
) => {
  const customerChannel = CHANNELS.customer(customerId);
  
  const listener = {
    message: (event: any) => {
      if (event.channel === customerChannel && onNotification) {
        onNotification(event.message);
      }
    },
  };

  client.addListener(listener);
  subscribeToChannels(client, [customerChannel]);

  return () => {
    client.removeListener(listener);
    unsubscribeFromChannels(client, [customerChannel]);
  };
};

// Fetch delivery chat history from local DB
export const getDeliveryChatHistory = async (deliveryId: number) => {
  try {
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.deliveryId, deliveryId))
      .orderBy(messagesTable.createdAt);

    return messages;
  } catch (error) {
    console.error('❌ Failed to fetch chat history:', error);
    return [];
  }
};

// Set customer online status
export const setCustomerOnlineStatus = async (
  client: PubNub,
  customerId: number,
  status: 'online' | 'offline' | 'busy' = 'online'
) => {
  try {
    const channel = CHANNELS.customer(customerId);
    const pubnubClient = client as any;
    
    if (pubnubClient.setState) {
      await pubnubClient.setState({
        channels: [channel],
        state: {
          status,
          lastActive: Date.now(),
        },
      });
      console.log(`✅ Customer ${customerId} status: ${status}`);
    }
  } catch (error) {
    console.error('❌ Failed to set customer status:', error);
  }
};

// Format timestamp for display
export const formatMessageTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
};

// Simple PubNub utilities that work with TypeScript
export const PubNubUtils = {
  // Safe publish with error handling
  safePublish: async (client: PubNub, channel: string, message: any) => {
    try {
      const response = await client.publish({
        channel,
        message,
      });
      return { success: true, response };
    } catch (error) {
      console.error('Publish failed:', error);
      return { success: false, error };
    }
  },

  // Safe subscribe
  safeSubscribe: (client: PubNub, channels: string[]) => {
    try {
      client.subscribe({ channels });
      return { success: true };
    } catch (error) {
      console.error('Subscribe failed:', error);
      return { success: false, error };
    }
  },

  // Safe unsubscribe
  safeUnsubscribe: (client: PubNub, channels: string[]) => {
    try {
      client.unsubscribe({ channels });
      return { success: true };
    } catch (error) {
      console.error('Unsubscribe failed:', error);
      return { success: false, error };
    }
  },
};

// Server-side singleton
export const pubnubServer = new PubNub({
  publishKey: PUBLISH_KEY,
  subscribeKey: SUBSCRIBE_KEY,
  userId: "velosdrop_customer_app",
  ssl: true,
});

export default createPubNubClient;
