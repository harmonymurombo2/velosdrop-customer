//components/RatingModal.tsx
import { db, executeTursoQuery } from '@/src/db';
import { driverRatingsTable } from '@/src/db/schema';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Modal,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

interface RatingModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: () => void;
  deliveryId: number;
  driverId: number;
  driverName: string;
  driverProfilePicture?: string | null;
  customerId: number;
}

export default function RatingModal({
  visible,
  onClose,
  onSubmit,
  deliveryId,
  driverId,
  driverName,
  driverProfilePicture,
  customerId
}: RatingModalProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);

  const handleSubmit = async () => {
    if (rating === 0) {
      Alert.alert('Rating Required', 'Please select a star rating');
      return;
    }

    setIsSubmitting(true);

    try {
      const now = new Date().toISOString();

      // 1. Insert into CLOUD (Turso)
      await executeTursoQuery(
        `INSERT INTO driver_ratings (driver_id, customer_id, delivery_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [driverId, customerId, deliveryId, rating, comment || null, now]
      );

      // 2. Insert into LOCAL database
      await db.insert(driverRatingsTable).values({
        driverId,
        customerId,
        deliveryId,
        rating,
        comment: comment || null,
        createdAt: now
      });

      // 3. Update delivery request to mark as rated
      await executeTursoQuery(
        `UPDATE delivery_requests SET customer_confirmed_at = ? WHERE id = ?`,
        [now, deliveryId]
      );

      Alert.alert('Thank You!', 'Your feedback has been submitted');
      
      // Reset state
      setRating(0);
      setComment('');
      
      // Callback
      onSubmit();
      onClose();
      
    } catch (error) {
      console.error('Error submitting rating:', error);
      Alert.alert('Error', 'Failed to submit rating. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setRating(0);
    setComment('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}>
        <LinearGradient
          colors={['#1e1b4b', '#111827']}
          style={{
            width: '90%',
            maxWidth: 400,
            borderRadius: 24,
            padding: 24,
            borderWidth: 1,
            borderColor: 'rgba(168,85,247,0.3)',
          }}
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: 'white', fontSize: 22, fontWeight: 'bold' }}>Rate Your Driver</Text>
            <TouchableOpacity onPress={handleClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          {/* Driver Info */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <View style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              overflow: 'hidden',
              borderWidth: 2,
              borderColor: 'rgba(168,85,247,0.8)',
              marginBottom: 12,
            }}>
              {driverProfilePicture ? (
                <Image source={{ uri: driverProfilePicture }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View style={{ width: '100%', height: '100%', backgroundColor: 'rgba(168,85,247,0.3)', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="person" size={40} color="#a855f7" />
                </View>
              )}
            </View>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: '600' }}>{driverName}</Text>
            <Text style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>How was your delivery?</Text>
          </View>

          {/* Star Rating */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRating(star)}
                  onPressIn={() => setHoverRating(star)}
                  onPressOut={() => setHoverRating(0)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={star <= (hoverRating || rating) ? 'star' : 'star-outline'}
                    size={40}
                    color={star <= (hoverRating || rating) ? '#fbbf24' : '#6b7280'}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ color: '#9ca3af', marginTop: 8 }}>
              {rating === 0 ? 'Tap to rate' : 
               rating === 1 ? 'Poor' :
               rating === 2 ? 'Fair' :
               rating === 3 ? 'Good' :
               rating === 4 ? 'Very Good' : 'Excellent'}
            </Text>
          </View>

          {/* Comment Input */}
          <View style={{ marginBottom: 24 }}>
            <Text style={{ color: '#d1d5db', fontSize: 14, marginBottom: 8 }}>Add a comment (optional)</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Share your experience..."
              placeholderTextColor="#6b7280"
              multiline
              numberOfLines={4}
              style={{
                backgroundColor: 'rgba(31,41,55,0.6)',
                borderRadius: 12,
                padding: 16,
                color: 'white',
                fontSize: 16,
                borderWidth: 1,
                borderColor: 'rgba(168,85,247,0.2)',
                textAlignVertical: 'top',
                minHeight: 100,
              }}
            />
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isSubmitting || rating === 0}
            style={{
              backgroundColor: rating === 0 ? 'rgba(124,58,237,0.3)' : '#7c3aed',
              paddingVertical: 16,
              borderRadius: 30,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(168,85,247,0.5)',
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>
                Submit Rating
              </Text>
            )}
          </TouchableOpacity>

          {/* Maybe Later */}
          <TouchableOpacity
            onPress={handleClose}
            style={{ marginTop: 16, alignItems: 'center' }}
            disabled={isSubmitting}
          >
            <Text style={{ color: '#9ca3af', fontSize: 16 }}>Maybe Later</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    </Modal>
  );
}