//lib/Pubnub-booking.ts
import PubNub from 'pubnub';

// Environment configuration for React Native
const PUBLISH_KEY = process.env.EXPO_PUBLIC_PUBNUB_PUBLISH_KEY || 'demo';
const SUBSCRIBE_KEY = process.env.EXPO_PUBLIC_PUBNUB_SUBSCRIBE_KEY || 'demo';

console.log('🔧 PubNub Booking Config:', {
  publishKey: PUBLISH_KEY?.substring(0, 10) + '...',
  subscribeKey: SUBSCRIBE_KEY?.substring(0, 10) + '...'
});

if (!PUBLISH_KEY || !SUBSCRIBE_KEY) {
  console.warn('⚠️ PubNub keys not found. Using demo keys.');
}

// Channel naming conventions (EXACT SAME AS NEXT.JS)
export const CHANNELS = {
  // Customer channels
  customer: (customerId: number) => `customer_${customerId}`,

  // Driver channels
  driver: (driverId: number) => `driver_${driverId}`,

  // Broadcast channels
  driversNearby: (locationKey: string) => `drivers_nearby_${locationKey}`,

  // Booking specific channels
  booking: (bookingId: number) => `booking_${bookingId}`,
  
  // Location channels
  driverLocations: 'driver_locations',

  // See Realtime Feed
  LIVE_DELIVERY_FEED: 'live_delivery_feed', 
  
  // General drivers broadcast channel
  drivers: 'drivers',

  // Admin monitoring channels
  admin: (adminId: number) => `admin_${adminId}`,
  deliveryAdmin: (deliveryId: number) => `delivery_${deliveryId}_admin`,
  adminChats: 'admin_chats_monitor',
} as const;

// Message types (EXACT SAME AS NEXT.JS)
export const MESSAGE_TYPES = {
  // Customer -> Drivers
  BOOKING_REQUEST: 'booking_request',

  LIVE_FEED_UPDATE: 'live_feed_update', 

  // Driver -> Customer
  BOOKING_ACCEPTED: 'booking_accepted',
  BOOKING_REJECTED: 'booking_rejected',

  // System messages
  DRIVER_LOCATION_UPDATE: 'driver_location_update',
  BOOKING_STATUS_UPDATE: 'booking_status_update',
  DRIVER_ONLINE_STATUS: 'driver_online_status',

  // Chat messages
  CHAT_MESSAGE: 'chat_message',
  NEW_MESSAGE: 'new_message',
  MESSAGE_READ: 'message_read',
  
  // Driver notifications
  REQUEST_ACCEPTED: 'request_accepted',
  REQUEST_REBROADCAST: 'request_rebroadcast',
  
  // Admin monitoring
  ADMIN_MESSAGE_ALERT: 'admin_message_alert',
  DELIVERY_CHAT_UPDATE: 'delivery_chat_update',
  ADMIN_CHAT_NOTIFICATION: 'admin_chat_notification',
} as const;

// PubNub message interface (EXACT SAME AS NEXT.JS)
export interface PubNubMessage {
  type: string;
  data: any;
  timestamp: number;
  senderId: string;
  [key: string]: any;
}

// Interface for live feed messages (EXACT SAME AS NEXT.JS)
export interface LiveFeedMessage extends PubNubMessage {
  type: typeof MESSAGE_TYPES.LIVE_FEED_UPDATE;
  data: {
    eventType: 'new_request' | 'request_accepted' | 'request_rejected' | 'delivery_completed';
    requestId: number;
    generalArea: string; // e.g., "Downtown", "Westside"
    fare: number;
    customerInitial?: string; // Optional: "J" for John
    driverName?: string; // Only for acceptance events
    timestamp: number;
    status: string;
    // Map data (optional)
    pickupZone?: {
      latitude: number;
      longitude: number;
      radius?: number; // in meters
    };
  };
}

// Type for publishing messages (EXACT SAME AS NEXT.JS)
export type PubNubPublishMessage = Omit<PubNubMessage, 'timestamp' | 'senderId'> & {
  [key: string]: any;
};

// Chat message interface for admin monitoring (EXACT SAME AS NEXT.JS)
export interface ChatMessageForAdmin {
  type: typeof MESSAGE_TYPES.CHAT_MESSAGE;
  data: {
    deliveryId: number;
    messageId: number;
    senderType: 'customer' | 'driver' | 'system';
    senderId: number;
    senderName: string;
    messageType: 'text' | 'image' | 'status_update' | 'location';
    content: string;
    imageUrl?: string;
    metadata?: Record<string, any>;
    isRead: boolean;
    createdAt: string;
  };
}

// UPDATED: Booking request message with separate address and coordinates (EXACT SAME)
export interface BookingRequestMessage extends PubNubMessage {
  type: typeof MESSAGE_TYPES.BOOKING_REQUEST;
  data: {
    bookingId: number;
    customerId: number;
    customerUsername: string;
    customerProfilePictureUrl: string;
    customerPhoneNumber?: string;
    recipientPhoneNumber?: string;
    // UPDATED: Now includes separate address and coordinates
    pickupAddress: string;
    pickupLatitude: number;
    pickupLongitude: number;
    dropoffAddress: string;
    dropoffLatitude: number;
    dropoffLongitude: number;
    fare: number;
    distance: number;
    vehicleType?: string;
    packageDetails?: string;
    expiresAt: string;
    isDirectAssignment?: boolean;
  };
}

// UPDATED: Booking response message (EXACT SAME AS NEXT.JS)
export interface BookingResponseMessage extends PubNubMessage {
  type: typeof MESSAGE_TYPES.BOOKING_ACCEPTED | typeof MESSAGE_TYPES.BOOKING_REJECTED;
  data: {
    bookingId: number;
    driverId: number;
    driverName: string;
    driverPhone: string;
    vehicleType: string;
    carName: string;
    profilePictureUrl?: string;
    wasDirectAssignment?: boolean;
    expired?: boolean;
    rejected?: boolean;
    message?: string;
    requestedVehicleType?: string;
  };
}

// Create PubNub client instance (ADAPTED FOR REACT NATIVE) - UPDATED WITH TOKEN SIZE FIX
export const createPubNubClient = (userId: string, authKey?: string) => {
  const config: any = {
    publishKey: PUBLISH_KEY,
    subscribeKey: SUBSCRIBE_KEY,
    userId: userId,
    logLevel: PubNub.LogLevel.Debug, // Enable debug logging
    restore: true,
    ssl: true,
    
    // CRITICAL: PubNub settings to prevent 414 error
    useRequestId: false, // Disable request ID generation to reduce URL length
    
    // Use shorter message structure
    supressLeaveEvents: true,
    catchAllEventHandler: null,
    
    // HTTP client optimizations
    keepAlive: true,
    keepAliveSettings: {
      maxSockets: 10,
      maxFreeSockets: 10,
      timeout: 30000
    }
  };

  // Only add authKey if it exists and is small enough
  if (authKey && authKey.length < 2000) {
    config.authKey = authKey;
    console.log('🔐 Using auth key (size:', authKey.length, 'chars)');
  } else if (authKey) {
    console.warn('⚠️ Auth key too long, skipping to prevent 414 error');
  }

  return new PubNub(config);
};

// Export the getPubNubInstance function (ADAPTED)
export const getPubNubInstance = (userId?: string, authKey?: string) => {
  if (userId) {
    return createPubNubClient(userId, authKey);
  }
  return createPubNubClient("anonymous_user");
};

// CRITICAL: Create a global PubNub instance (SAME AS NEXT.JS)
// This will be used by all functions that don't receive a client parameter
const pubnub = createPubNubClient("customer_app");

// CUSTOMER FUNCTION: Publish booking request to drivers - UPDATED WITH BATCHING
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const publishBookingRequest = async (
  driverIds: number[],
  bookingData: BookingRequestMessage['data']
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  
  // CRITICAL: Keep the message payload small
  const message: PubNubPublishMessage = {
    type: MESSAGE_TYPES.BOOKING_REQUEST,
    data: {
      // Include only essential fields
      bookingId: bookingData.bookingId,
      customerId: bookingData.customerId,
      customerUsername: bookingData.customerUsername,
      customerProfilePictureUrl: bookingData.customerProfilePictureUrl || '',
      customerPhoneNumber: bookingData.customerPhoneNumber || '',
      recipientPhoneNumber: bookingData.recipientPhoneNumber || '',
      // UPDATED: Match exact Next.js structure
      pickupAddress: bookingData.pickupAddress,
      pickupLatitude: bookingData.pickupLatitude,
      pickupLongitude: bookingData.pickupLongitude,
      dropoffAddress: bookingData.dropoffAddress,
      dropoffLatitude: bookingData.dropoffLatitude,
      dropoffLongitude: bookingData.dropoffLongitude,
      fare: bookingData.fare,
      distance: bookingData.distance,
      vehicleType: bookingData.vehicleType || 'car',
      packageDetails: bookingData.packageDetails || '',
      expiresAt: bookingData.expiresAt,
      ...(bookingData.isDirectAssignment && { isDirectAssignment: true }),
      // Send timestamps as numbers, not ISO strings
      createdAt: Date.now(),
    },
  };

  console.log('📤 Publishing booking request with payload size:', 
    JSON.stringify(message).length, 'bytes');

  try {
    // CRITICAL: Batch publishing for multiple drivers to avoid URL length issues
    if (driverIds.length === 1) {
      // Single driver - direct publish
      const channel = CHANNELS.driver(driverIds[0]);
      await client.publish({
        channel: channel,
        message: message,
      });
      console.log(`✅ Published to driver ${driverIds[0]} on channel: ${channel}`);
    } else {
      // Multiple drivers - batch in smaller groups
      const batchSize = 5; // Reduce concurrent publishes
      for (let i = 0; i < driverIds.length; i += batchSize) {
        const batch = driverIds.slice(i, i + batchSize);
        const publishPromises = batch.map(async (driverId) => {
          const channel = CHANNELS.driver(driverId);
          try {
            await client.publish({
              channel: channel,
              message: message,
            });
            console.log(`✅ Published to driver ${driverId} on channel: ${channel}`);
            return true;
          } catch (error: any) {
            console.warn(`⚠️ Failed to publish to driver ${driverId}:`, error?.message);
            return false;
          }
        });
        
        // Wait for batch to complete before next batch
        const results = await Promise.all(publishPromises);
        const successCount = results.filter(Boolean).length;
        console.log(`📦 Batch ${i/batchSize + 1}: ${successCount}/${batch.length} successful`);
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < driverIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    console.log(`✅ Booking request published to ${driverIds.length} drivers`, {
      bookingId: bookingData.bookingId,
      fare: bookingData.fare,
      distance: bookingData.distance,
    });
    return { success: true };
  } catch (error: any) {
    console.error('❌ Error publishing booking request:', {
      message: error.message,
      status: error.status,
      errorCode: error.errorCode
    });
    
    // Check if it's a 414 error and provide specific guidance
    if (error.status === 414) {
      console.error('🔥 414 ERROR DETECTED: URL too long');
      console.error('💡 TROUBLESHOOTING:');
      console.error('1. Your PubNub auth token might be too large');
      console.error('2. Reduce channel permissions in your backend');
      console.error('3. Use channel patterns instead of individual grants');
      console.error('4. Regenerate a smaller token on your server');
    }
    
    return { success: false, error };
  }
};

// CUSTOMER FUNCTION: Listen for booking responses from drivers
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const listenForBookingResponse = (
  customerId: number,
  callbacks: {
    onBookingAccepted?: (message: BookingResponseMessage) => void;
    onBookingRejected?: (message: BookingResponseMessage) => void;
    onError?: (error: any) => void;
  }
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const customerChannel = CHANNELS.customer(customerId);
  
  const listener = {
    message: (event: any) => {
      const { channel, message } = event;
      
      if (channel === customerChannel) {
        switch (message.type) {
          case MESSAGE_TYPES.BOOKING_ACCEPTED:
            callbacks.onBookingAccepted?.(message);
            console.log('✅ Booking accepted:', message.data);
            break;
            
          case MESSAGE_TYPES.BOOKING_REJECTED:
            callbacks.onBookingRejected?.(message);
            console.log('❌ Booking rejected:', message.data);
            break;
        }
      }
    },
    
    status: (event: any) => {
      console.log('📡 PubNub Status:', event.category);
      if (event.category === 'PNNetworkDownCategory') {
        callbacks.onError?.(new Error('Network connection lost'));
      }
    },
    
    presence: (event: any) => {
      console.log('👤 Presence:', event);
    }
  };

  client.addListener(listener);
  
  // Subscribe to customer channel only (minimal subscription)
  client.subscribe({
    channels: [customerChannel],
    withPresence: false, // Disable presence to reduce payload
  });

  console.log(`👂 Listening for booking responses on channel: ${customerChannel}`);

  // Return cleanup function
  return () => {
    client.removeListener(listener);
    client.unsubscribe({
      channels: [customerChannel],
    });
  };
};

// CUSTOMER FUNCTION: Listen for driver location updates
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const listenForDriverLocation = (
  driverId?: number,
  onLocationUpdate?: (data: {
    driverId: number;
    location: { latitude: number; longitude: number; heading?: number; speed?: number };
    orderId?: number;
    timestamp: number;
  }) => void
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const channel = CHANNELS.driverLocations;
  
  const listener = {
    message: (event: any) => {
      const { channel: eventChannel, message } = event;
      
      if (eventChannel === channel && message.type === MESSAGE_TYPES.DRIVER_LOCATION_UPDATE) {
        const { driverId: msgDriverId, location, orderId, timestamp } = message.data;
        
        // If specific driver ID provided, only listen for that driver
        if (!driverId || msgDriverId === driverId) {
          onLocationUpdate?.({
            driverId: msgDriverId,
            location,
            orderId,
            timestamp
          });
        }
      }
    }
  };

  client.addListener(listener);
  client.subscribe({
    channels: [channel],
    withPresence: false, // Disable presence
  });

  console.log(`📍 Listening for driver location updates on channel: ${channel}`);

  return () => {
    client.removeListener(listener);
    client.unsubscribe({
      channels: [channel],
    });
  };
};

// CUSTOMER FUNCTION: Listen for booking status updates
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const listenForBookingStatus = (
  bookingId: number,
  onStatusUpdate?: (data: {
    orderId: number;
    status: string;
    driverId?: number;
    timestamp: number;
    message?: string;
  }) => void
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const bookingChannel = CHANNELS.booking(bookingId);
  
  const listener = {
    message: (event: any) => {
      const { channel, message } = event;
      
      if (channel === bookingChannel && message.type === MESSAGE_TYPES.BOOKING_STATUS_UPDATE) {
        onStatusUpdate?.(message.data);
      }
    }
  };

  client.addListener(listener);
  client.subscribe({
    channels: [bookingChannel],
    withPresence: false,
  });

  console.log(`📊 Listening for booking status updates: ${bookingChannel}`);

  return () => {
    client.removeListener(listener);
    client.unsubscribe({
      channels: [bookingChannel],
    });
  };
};

// CUSTOMER FUNCTION: Listen for live delivery feed
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const listenForLiveDeliveryFeed = (
  onFeedUpdate?: (data: LiveFeedMessage['data']) => void
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const feedChannel = CHANNELS.LIVE_DELIVERY_FEED;
  
  const listener = {
    message: (event: any) => {
      const { channel, message } = event;
      
      if (channel === feedChannel && message.type === MESSAGE_TYPES.LIVE_FEED_UPDATE) {
        onFeedUpdate?.(message.data);
      }
    }
  };

  client.addListener(listener);
  client.subscribe({
    channels: [feedChannel],
    withPresence: false,
  });

  console.log(`📰 Listening for live delivery feed on channel: ${feedChannel}`);

  return () => {
    client.removeListener(listener);
    client.unsubscribe({
      channels: [feedChannel],
    });
  };
};

// CUSTOMER FUNCTION: Send chat message to driver
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const sendChatMessageToDriver = async (
  bookingId: number,
  content: string,
  messageType: 'text' | 'image' = 'text',
  imageUrl?: string,
  metadata?: Record<string, any>
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const bookingChannel = CHANNELS.booking(bookingId);
  
  // Keep chat messages minimal
  const message: PubNubPublishMessage = {
    type: MESSAGE_TYPES.CHAT_MESSAGE,
    data: {
      bookingId,
      senderType: 'customer',
      messageType,
      content: content.substring(0, 200), // Limit message length
      ...(imageUrl && { imageUrl }),
      timestamp: Date.now(),
    },
  };

  try {
    await client.publish({
      channel: bookingChannel,
      message,
    });

    console.log(`💬 Chat message sent to booking ${bookingId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error sending chat message:', error);
    
    // Check for 414 error
    if (error.status === 414) {
      console.error('Chat message too large. Try sending a shorter message.');
    }
    
    return { success: false, error };
  }
};

// CUSTOMER FUNCTION: Listen for chat messages in a booking
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const listenForBookingChat = (
  bookingId: number,
  onNewMessage?: (message: {
    bookingId: number;
    senderType: 'customer' | 'driver' | 'system';
    senderId: number;
    messageType: 'text' | 'image' | 'status_update' | 'location';
    content: string;
    imageUrl?: string;
    metadata?: Record<string, any>;
    timestamp: number;
  }) => void
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const bookingChannel = CHANNELS.booking(bookingId);
  
  const listener = {
    message: (event: any) => {
      const { channel, message } = event;
      
      if (channel === bookingChannel && message.type === MESSAGE_TYPES.CHAT_MESSAGE) {
        onNewMessage?.(message.data);
      }
    }
  };

  client.addListener(listener);
  client.subscribe({
    channels: [bookingChannel],
    withPresence: false,
  });

  console.log(`💬 Listening for chat messages in booking ${bookingId}`);

  return () => {
    client.removeListener(listener);
    client.unsubscribe({
      channels: [bookingChannel],
    });
  };
};

// CUSTOMER FUNCTION: Subscribe to all channels for a customer
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const subscribeToCustomerChannels = (
  customerId: number,
  bookingId?: number
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const channels = [
    CHANNELS.customer(customerId),
  ];

  if (bookingId) {
    channels.push(CHANNELS.booking(bookingId));
  }

  client.subscribe({
    channels,
    withPresence: false, // Disable presence to reduce URL length
  });

  console.log(`✅ Subscribed to ${channels.length} channels`);
};

// CUSTOMER FUNCTION: Unsubscribe from all channels
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const unsubscribeFromAllChannels = () => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  client.unsubscribeAll();
  console.log('✅ Unsubscribed from all channels');
};

// CUSTOMER FUNCTION: Mark message as read
// IMPORTANT: Changed to match Next.js signature (NO client parameter)
export const markMessageAsRead = async (
  bookingId: number,
  messageId: number
) => {
  // CRITICAL: Use the global PubNub instance (SAME AS NEXT.JS)
  const client = pubnub;
  const bookingChannel = CHANNELS.booking(bookingId);
  
  const message: PubNubPublishMessage = {
    type: MESSAGE_TYPES.MESSAGE_READ,
    data: {
      bookingId,
      messageId,
      readBy: 'customer',
      readAt: Date.now(),
    },
  };

  try {
    await client.publish({
      channel: bookingChannel,
      message,
    });

    console.log(`📖 Message ${messageId} marked as read`);
    return { success: true };
  } catch (error) {
    console.error('Error marking message as read:', error);
    return { success: false, error };
  }
};

// CRITICAL: Function to check if auth token is too large
export const checkAuthTokenSize = (token: string): boolean => {
  if (!token) return true;
  
  const size = token.length;
  console.log(`🔍 Auth token size: ${size} characters`);
  
  // PubNub limits URLs to ~32KB. A token should be under 2000 chars to be safe
  if (size > 2000) {
    console.warn(`⚠️ WARNING: Auth token is ${size} characters, may cause 414 errors`);
    console.warn('💡 Recommendation: Regenerate a smaller token on your server');
    return false;
  }
  
  return true;
};

// Export the global pubnub instance
export { pubnub };
