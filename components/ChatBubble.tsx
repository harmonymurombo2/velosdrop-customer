// components/ChatBubble.tsx
import { useUser } from '@/app/context/UserContext';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import PubNub from 'pubnub';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://www.velosdrop.com').replace(/\/$/, '');

interface ChatBubbleProps {
  deliveryId: number;
  driverId: number;
  driverName?: string;
  driverProfilePictureUrl?: string;
}

interface Message {
  id?: number;
  deliveryId: number;
  senderType: 'driver' | 'customer' | 'system';
  senderId: number;
  messageType: 'text' | 'image' | 'status_update' | 'location' | 'voice';
  content: string;
  imageUrl?: string;
  isRead: boolean;
  createdAt: string;
  metadata?: Record<string, any>;
}

// Define a proper type for PubNub message
interface PubNubMessage {
  type: string;
  data: Message;
}

export default function ChatBubble({ deliveryId, driverId, driverName, driverProfilePictureUrl }: ChatBubbleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [deliveryStatus, setDeliveryStatus] = useState<'pending' | 'arrived' | 'completed' | 'confirmed'>('pending');
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [deliveryDetails, setDeliveryDetails] = useState<{
    fare: number;
    commission: number;
    driverName: string;
  } | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { customer } = useUser();
  const customerId = customer?.id;
  const scrollViewRef = useRef<ScrollView>(null);
  const recordingIntervalRef = useRef<number | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  // Animation for chat button
  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.back(1.7)),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isOpen]);

  // Animation for button pulse
  useEffect(() => {
    if (unreadCount > 0) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.8,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [unreadCount]);

  // Fetch messages
  const fetchMessages = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/messages?deliveryId=${deliveryId}`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
        
        // Calculate unread messages
        const unread = data.filter((msg: Message) => 
          !msg.isRead && msg.senderType === 'driver'
        ).length;
        setUnreadCount(unread);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Check delivery status
  const fetchDeliveryStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/delivery/${deliveryId}`);
      if (response.ok) {
        const data = await response.json();
        
        if (data.deliveryStatus === 'completed' && !data.customerConfirmedAt) {
          setDeliveryStatus('completed');
          setDeliveryDetails({
            fare: data.fare,
            commission: data.fare * 0.135,
            driverName: `${data.driver?.firstName || ''} ${data.driver?.lastName || ''}`.trim(),
          });
        }
      }
    } catch (error) {
      console.error('Error fetching delivery status:', error);
    }
  };

  // Initialize PubNub
  useEffect(() => {
    if (!customerId) return;

    const pubnub = new PubNub({
      publishKey: process.env.EXPO_PUBLIC_PUBNUB_PUBLISH_KEY || '',
      subscribeKey: process.env.EXPO_PUBLIC_PUBNUB_SUBSCRIBE_KEY || '',
      uuid: `customer_${customerId}`,
    });

    // Subscribe to delivery chat channel
    const channel = `delivery_${deliveryId}`;
    
    pubnub.subscribe({
      channels: [channel],
    });

    pubnub.addListener({
      message: (event) => {
        const channel = event.channel;
        const pubnubMessage = event.message as unknown as PubNubMessage;
        
        if (channel === `delivery_${deliveryId}` && pubnubMessage.type === 'CHAT_MESSAGE') {
          const newMessage = pubnubMessage.data as Message;
          
          setMessages(prev => {
            const exists = prev.some(m => 
              m.createdAt === newMessage.createdAt && 
              m.content === newMessage.content &&
              m.senderId === newMessage.senderId
            );
            
            if (!exists) {
              // If message is from driver, increment unread count
              if (newMessage.senderType === 'driver' && !newMessage.isRead) {
                setUnreadCount(prev => prev + 1);
              }
              
              return [...prev, newMessage];
            }
            return prev;
          });

          // Scroll to bottom
          setTimeout(() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      },
      status: (event) => {
        console.log('PubNub status:', event.category);
      },
    });

    // Load initial data
    fetchMessages();
    fetchDeliveryStatus();

    return () => {
      pubnub.unsubscribeAll();
      pubnub.removeAllListeners();
    };
  }, [customerId, deliveryId]);

  const sendMessage = async (content: string, type: Message['messageType'] = 'text', imageUrl?: string) => {
    if (!content.trim() || !customerId || isSending) return;

    setIsSending(true);
    
    const newMessage: Message = {
      deliveryId,
      senderType: 'customer',
      senderId: customerId,
      messageType: type,
      content,
      imageUrl,
      isRead: true,
      createdAt: new Date().toISOString(),
    };

    try {
      const response = await fetch(`${API_BASE_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMessage),
      });

      if (response.ok) {
        const savedMessage = await response.json();
        
        // Update local state
        setMessages(prev => [...prev, savedMessage]);
        setMessage('');
        
        // Clear input and scroll to bottom
        setTimeout(() => {
          scrollViewRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = () => {
    if (message.trim()) {
      sendMessage(message);
    }
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera roll permissions to upload images');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        // Here you would upload the image to your server
        // For now, we'll send it as a base64 string (not recommended for production)
        sendMessage('Photo', 'image', imageUri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    } finally {
      setShowAttachmentMenu(false);
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant camera permissions to take photos');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        sendMessage('Photo', 'image', imageUri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo');
    } finally {
      setShowAttachmentMenu(false);
    }
  };

  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant microphone permissions to record voice');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(recording);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer - using window.setInterval for React Native
      recordingIntervalRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      // Send voice message
      if (uri) {
        sendMessage('Voice message', 'voice', uri);
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      Alert.alert('Error', 'Failed to save recording');
    } finally {
      setRecording(null);
      setIsRecording(false);
      setRecordingTime(0);
      if (recordingIntervalRef.current !== null) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const confirmDelivery = async () => {
    if (!deliveryDetails || !customerId) return;
    
    setIsConfirming(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/delivery/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          deliveryId,
          customerId 
        })
      });

      if (response.ok) {
        setDeliveryStatus('confirmed');
        setShowConfirmationModal(false);
        
        // Send confirmation message
        await sendMessage("✅ I confirm I received my delivery and paid in cash.", 'status_update');
        
        Alert.alert(
          'Delivery Confirmed',
          `Delivery confirmed! Commission of $${deliveryDetails.commission.toFixed(2)} deducted from driver's wallet.`
        );
      } else {
        const errorData = await response.json();
        Alert.alert('Error', errorData.error || 'Failed to confirm delivery');
      }
    } catch (error) {
      console.error('Error confirming delivery:', error);
      Alert.alert('Error', 'Failed to confirm delivery');
    } finally {
      setIsConfirming(false);
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatRecordingTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const renderMessage = (msg: Message, index: number) => {
    const isCustomer = msg.senderType === 'customer';
    const isSystem = msg.senderType === 'system';

    if (isSystem) {
      return (
        <View key={index} style={styles.systemMessageContainer}>
          <View style={styles.systemMessage}>
            <Text style={styles.systemMessageText}>{msg.content}</Text>
          </View>
        </View>
      );
    }

    return (
      <View
        key={index}
        style={[
          styles.messageContainer,
          isCustomer ? styles.customerMessageContainer : styles.driverMessageContainer,
        ]}
      >
        {!isCustomer && driverProfilePictureUrl && (
          <Image
            source={{ uri: driverProfilePictureUrl }}
            style={styles.profileImage}
          />
        )}
        
        <View
          style={[
            styles.messageBubble,
            isCustomer ? styles.customerBubble : styles.driverBubble,
          ]}
        >
          {msg.messageType === 'image' && msg.imageUrl ? (
            <Image
              source={{ uri: msg.imageUrl }}
              style={styles.messageImage}
              resizeMode="cover"
            />
          ) : msg.messageType === 'voice' ? (
            <View style={styles.voiceMessage}>
              <Feather name="mic" size={16} color={isCustomer ? 'white' : '#7C3AED'} />
              <Text style={[styles.voiceMessageText, isCustomer && styles.customerText]}>
                Voice message
              </Text>
            </View>
          ) : (
            <Text style={[styles.messageText, isCustomer && styles.customerText]}>
              {msg.content}
            </Text>
          )}
          
          <Text style={[styles.messageTime, isCustomer ? styles.customerTime : styles.driverTime]}>
            {formatTime(msg.createdAt)}
            {isCustomer && ' • '}
            {isCustomer && (msg.isRead ? '✓✓' : '✓')}
          </Text>
        </View>
        
        {isCustomer && (
          <View style={styles.customerAvatar}>
            <Ionicons name="person" size={16} color="#7C3AED" />
          </View>
        )}
      </View>
    );
  };

  return (
    <>
      {/* Floating Chat Button */}
      <Animated.View
        style={[
          styles.chatButtonContainer,
          {
            opacity: fadeAnim,
            transform: [
              { scale: unreadCount > 0 ? scaleAnim : 1 },
            ],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.chatButton}
          onPress={() => setIsOpen(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="chatbubble" size={24} color="white" />
          
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          )}
          
          {/* Pulsing effect */}
          {unreadCount > 0 && (
            <Animated.View style={styles.pulse} />
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* Chat Modal */}
      <Modal
        visible={isOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContainer}
        >
          {/* Backdrop */}
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          
          {/* Main Chat Panel */}
          <Animated.View
            style={[
              styles.chatPanel,
              {
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity
                onPress={() => setIsOpen(false)}
                style={styles.backButton}
              >
                <Ionicons name="chevron-down" size={24} color="#9CA3AF" />
              </TouchableOpacity>
              
              <View style={styles.headerCenter}>
                <Text style={styles.headerTitle}>Chat with Driver</Text>
                <Text style={styles.headerSubtitle}>
                  {driverName || 'Driver'} • {deliveryStatus}
                </Text>
              </View>
              
              {driverProfilePictureUrl ? (
                <Image
                  source={{ uri: driverProfilePictureUrl }}
                  style={styles.driverImage}
                />
              ) : (
                <View style={styles.driverIcon}>
                  <Ionicons name="person" size={20} color="white" />
                </View>
              )}
            </View>

            {/* Messages Container */}
            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#7C3AED" />
              </View>
            ) : (
              <ScrollView
                ref={scrollViewRef}
                style={styles.messagesContainer}
                contentContainerStyle={styles.messagesContent}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
              >
                {messages.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="chatbubble-outline" size={64} color="#CBD5E1" />
                    <Text style={styles.emptyText}>No messages yet</Text>
                    <Text style={styles.emptySubtext}>Start the conversation with your driver</Text>
                  </View>
                ) : (
                  messages.map((msg, index) => renderMessage(msg, index))
                )}
                
                {/* Spacer for input area */}
                <View style={{ height: 80 }} />
              </ScrollView>
            )}

            {/* Confirmation Button */}
            {deliveryStatus === 'completed' && (
              <View style={styles.confirmationBanner}>
                <View style={styles.confirmationContent}>
                  <Feather name="check-circle" size={20} color="#059669" />
                  <View style={styles.confirmationText}>
                    <Text style={styles.confirmationTitle}>Delivery completed by driver</Text>
                    <Text style={styles.confirmationSubtitle}>Please confirm receipt to finalize</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.confirmButton}
                    onPress={() => setShowConfirmationModal(true)}
                  >
                    <Text style={styles.confirmButtonText}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Voice Recording UI */}
            {isRecording && (
              <View style={styles.recordingContainer}>
                <View style={styles.recordingContent}>
                  <View style={styles.recordingIndicator}>
                    <Feather name="mic" size={20} color="white" />
                    <Text style={styles.recordingTime}>{formatRecordingTime(recordingTime)}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.stopRecordingButton}
                    onPress={stopRecording}
                  >
                    <Text style={styles.stopRecordingText}>Send</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.recordingWave}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.waveBar,
                        {
                          height: 10 + Math.sin(Date.now() / 200 + i) * 10,
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Attachment Menu */}
            {showAttachmentMenu && (
              <View style={styles.attachmentMenu}>
                <TouchableOpacity
                  style={styles.attachmentOption}
                  onPress={takePhoto}
                >
                  <View style={[styles.attachmentIcon, { backgroundColor: '#3B82F6' }]}>
                    <Ionicons name="camera" size={24} color="white" />
                  </View>
                  <Text style={styles.attachmentText}>Camera</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.attachmentOption}
                  onPress={pickImage}
                >
                  <View style={[styles.attachmentIcon, { backgroundColor: '#10B981' }]}>
                    <Ionicons name="images" size={24} color="white" />
                  </View>
                  <Text style={styles.attachmentText}>Gallery</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.attachmentOption}
                  onPress={startRecording}
                >
                  <View style={[styles.attachmentIcon, { backgroundColor: '#EF4444' }]}>
                    <Feather name="mic" size={24} color="white" />
                  </View>
                  <Text style={styles.attachmentText}>Voice</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Input Area */}
            <View style={styles.inputContainer}>
              <TouchableOpacity
                style={styles.attachmentButton}
                onPress={() => setShowAttachmentMenu(!showAttachmentMenu)}
              >
                <Feather name="paperclip" size={22} color="#6B7280" />
              </TouchableOpacity>
              
              <TextInput
                style={styles.textInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Type a message..."
                placeholderTextColor="#9CA3AF"
                multiline
                maxLength={500}
                editable={!isSending}
              />
              
              <TouchableOpacity
                style={[styles.sendButton, (!message.trim() || isSending) && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!message.trim() || isSending}
              >
                {isSending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Ionicons name="send" size={20} color="white" />
                )}
              </TouchableOpacity>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        visible={showConfirmationModal}
        transparent={true}
        animationType="fade"
      >
        <BlurView intensity={90} style={styles.confirmationModalBackdrop}>
          <View style={styles.confirmationModal}>
            <View style={styles.confirmationHeader}>
              <View style={styles.confirmationIcon}>
                <Feather name="check-circle" size={32} color="#059669" />
              </View>
              <Text style={styles.confirmationModalTitle}>Confirm Delivery</Text>
              <Text style={styles.confirmationModalSubtitle}>Order #{deliveryId}</Text>
            </View>
            
            <View style={styles.confirmationContentContainer}>
              <View style={styles.confirmationRow}>
                <Text style={styles.confirmationLabel}>Cash Payment Received</Text>
                <Text style={styles.confirmationValue}>
                  ${deliveryDetails?.fare.toFixed(2)}
                </Text>
              </View>
              
              <View style={styles.confirmationDetails}>
                <Text style={styles.detailsTitle}>Commission Details</Text>
                <View style={styles.detailsRow}>
                  <Text style={styles.detailsLabel}>Delivery fare:</Text>
                  <Text style={styles.detailsValue}>${deliveryDetails?.fare.toFixed(2)}</Text>
                </View>
                <View style={styles.detailsRow}>
                  <Text style={styles.detailsLabel}>Platform commission (13.5%):</Text>
                  <Text style={[styles.detailsValue, styles.commissionValue]}>
                    -${deliveryDetails?.commission.toFixed(2)}
                  </Text>
                </View>
                <View style={styles.detailsDivider} />
                <View style={styles.detailsRow}>
                  <Text style={styles.detailsTotalLabel}>Driver receives:</Text>
                  <Text style={styles.detailsTotalValue}>
                    ${deliveryDetails ? (deliveryDetails.fare - deliveryDetails.commission).toFixed(2) : '0.00'}
                  </Text>
                </View>
              </View>
              
              <View style={styles.noteContainer}>
                <Feather name="alert-circle" size={18} color="#3B82F6" />
                <Text style={styles.noteText}>
                  Important: By confirming, you acknowledge that you received the delivery and paid cash. 
                  The commission will be automatically deducted from the driver's wallet balance.
                </Text>
              </View>
            </View>
            
            <View style={styles.confirmationActions}>
              <TouchableOpacity
                style={[styles.actionButton, styles.confirmActionButton]}
                onPress={confirmDelivery}
                disabled={isConfirming}
              >
                {isConfirming ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Feather name="check" size={18} color="white" />
                    <Text style={styles.actionButtonText}>Yes, I Confirm Delivery</Text>
                  </>
                )}
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.actionButton, styles.cancelActionButton]}
                onPress={() => setShowConfirmationModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Modal>
    </>
  );
}

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  // Chat Button Styles
  chatButtonContainer: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    zIndex: 100,
  },
  chatButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    elevation: 4,
  },
  badgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  pulse: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#7C3AED',
    opacity: 0.4,
    zIndex: -1,
  },

  // Modal Styles
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  chatPanel: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: height * 0.8,
    overflow: 'hidden',
  },

  // Header Styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    marginLeft: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  driverImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#7C3AED',
  },
  driverIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Messages Styles
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesContainer: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    color: '#CBD5E1',
    marginTop: 16,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },

  // Message Bubble Styles
  messageContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-end',
  },
  customerMessageContainer: {
    justifyContent: 'flex-end',
  },
  driverMessageContainer: {
    justifyContent: 'flex-start',
  },
  systemMessageContainer: {
    alignItems: 'center',
    marginVertical: 8,
  },
  systemMessage: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    maxWidth: '80%',
  },
  systemMessageText: {
    fontSize: 12,
    color: '#92400E',
    textAlign: 'center',
  },
  profileImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E9D5FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  messageBubble: {
    maxWidth: '70%',
    padding: 12,
    borderRadius: 20,
  },
  customerBubble: {
    backgroundColor: '#7C3AED',
    borderBottomRightRadius: 4,
  },
  driverBubble: {
    backgroundColor: '#1E293B',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 14,
    color: 'white',
    lineHeight: 20,
  },
  customerText: {
    color: 'white',
  },
  messageTime: {
    fontSize: 11,
    marginTop: 4,
  },
  customerTime: {
    color: '#E9D5FF',
    textAlign: 'right',
  },
  driverTime: {
    color: '#94A3B8',
  },
  messageImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
    marginBottom: 8,
  },
  voiceMessage: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  voiceMessageText: {
    fontSize: 14,
    marginLeft: 8,
    color: '#1E293B',
  },

  // Confirmation Banner
  confirmationBanner: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#A7F3D0',
  },
  confirmationContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  confirmationText: {
    flex: 1,
    marginLeft: 12,
  },
  confirmationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#065F46',
  },
  confirmationSubtitle: {
    fontSize: 12,
    color: '#047857',
    marginTop: 2,
  },
  confirmButton: {
    backgroundColor: '#059669',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },

  // Recording Styles
  recordingContainer: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  recordingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingTime: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  stopRecordingButton: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  stopRecordingText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  recordingWave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    height: 20,
  },
  waveBar: {
    width: 3,
    backgroundColor: 'white',
    marginHorizontal: 2,
    borderRadius: 1.5,
  },

  // Attachment Menu
  attachmentMenu: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    paddingVertical: 16,
    paddingHorizontal: 20,
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  attachmentOption: {
    alignItems: 'center',
  },
  attachmentIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  attachmentText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },

  // Input Area
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0F172A',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  attachmentButton: {
    padding: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: 'white',
    maxHeight: 100,
    marginHorizontal: 8,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },

  // Confirmation Modal
  confirmationModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmationModal: {
    backgroundColor: 'white',
    borderRadius: 24,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
  },
  confirmationHeader: {
    backgroundColor: '#059669',
    padding: 24,
    alignItems: 'center',
  },
  confirmationIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  confirmationModalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  confirmationModalSubtitle: {
    fontSize: 14,
    color: '#A7F3D0',
  },
  confirmationContentContainer: {
    padding: 24,
  },
  confirmationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  confirmationLabel: {
    fontSize: 14,
    color: '#4B5563',
  },
  confirmationValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#059669',
  },
  confirmationDetails: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  detailsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 12,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailsLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  detailsValue: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  commissionValue: {
    color: '#EF4444',
  },
  detailsDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  detailsTotalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  detailsTotalValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#059669',
  },
  noteContainer: {
    flexDirection: 'row',
    backgroundColor: '#DBEAFE',
    padding: 12,
    borderRadius: 8,
    alignItems: 'flex-start',
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: '#1E40AF',
    marginLeft: 8,
    lineHeight: 18,
  },
  confirmationActions: {
    padding: 24,
    paddingTop: 0,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  confirmActionButton: {
    backgroundColor: '#059669',
  },
  cancelActionButton: {
    backgroundColor: '#F3F4F6',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  cancelButtonText: {
    color: '#4B5563',
    fontSize: 16,
    fontWeight: '600',
  },
});