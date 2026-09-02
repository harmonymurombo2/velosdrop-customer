//components/FeedbackSection.tsx
import { db, executeTursoQuery } from '@/src/db';
import { driverRatingsTable } from '@/src/db/schema';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    RefreshControl,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import RatingModal from './RatingModal';

interface FeedbackItem {
  id: number;
  deliveryId: number;
  driverId: number;
  driverName: string;
  driverProfilePicture?: string | null;
  deliveryDate: string;
  rating?: number;
  comment?: string;
  isRated: boolean;
}

interface Props {
  customerId: number;
  onPendingCountChange?: (count: number) => void;
}

export default function FeedbackSection({ customerId, onPendingCountChange }: Props) {
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [expandedComment, setExpandedComment] = useState<number | null>(null);
  
  // Rating modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<{
    deliveryId: number;
    driverId: number;
    driverName: string;
    driverProfilePicture?: string | null;
  } | null>(null);

  // Inline rating state
  const [inlineRating, setInlineRating] = useState<{ [key: number]: number }>({});
  const [inlineComment, setInlineComment] = useState<{ [key: number]: string }>({});
  const [showCommentField, setShowCommentField] = useState<{ [key: number]: boolean }>({});

  // Filter state
  const [filter, setFilter] = useState<'all' | 'pending' | 'rated'>('all');

  useEffect(() => {
    fetchFeedback();
  }, [customerId]);

  useEffect(() => {
    if (onPendingCountChange) {
      const pendingCount = feedbackItems.filter(item => !item.isRated).length;
      onPendingCountChange(pendingCount);
    }
  }, [feedbackItems]);

  const fetchFeedback = async () => {
    try {
      setIsLoading(true);
      
      // Fetch completed deliveries for this customer
      // FIXED: Removed dr.rating and dr.comment as they don't exist in delivery_requests
      const result = await executeTursoQuery(
        `SELECT 
          dr.id as delivery_id,
          dr.driver_id,
          dr.created_at,
          dr.customer_confirmed_at,
          d.first_name || ' ' || d.last_name as driver_name,
          d.profile_picture_url as driver_profile_picture
         FROM delivery_requests dr
         LEFT JOIN drivers d ON dr.driver_id = d.id
         WHERE dr.customer_id = ? 
         AND dr.status IN ('completed', 'delivered')
         ORDER BY dr.created_at DESC`,
        [customerId]
      );

      const rows = result[0]?.results?.rows || [];
      const cols = result[0]?.results?.columns || [];

      // Also fetch existing ratings from driver_ratings table
      const ratingsResult = await executeTursoQuery(
        `SELECT delivery_id, rating, comment FROM driver_ratings WHERE customer_id = ?`,
        [customerId]
      );
      
      const ratingsRows = ratingsResult[0]?.results?.rows || [];
      const ratingsCols = ratingsResult[0]?.results?.columns || [];
      
      // Create a map of delivery_id -> rating data
      const ratingsMap = new Map();
      ratingsRows.forEach((row: any[]) => {
        const ratingData: any = {};
        ratingsCols.forEach((col: string, index: number) => {
          ratingData[col] = row[index];
        });
        ratingsMap.set(ratingData.delivery_id, ratingData);
      });

      // Transform to feedback items
      const items: FeedbackItem[] = rows.map((row: any[]) => {
        const item: any = {};
        cols.forEach((col: string, index: number) => {
          item[col] = row[index];
        });

        const existingRating = ratingsMap.get(item.delivery_id);

        // FIXED: Mapping only uses existingRating data, not delivery_requests columns
        return {
          id: item.delivery_id,
          deliveryId: item.delivery_id,
          driverId: item.driver_id,
          driverName: item.driver_name || 'Unknown Driver',
          driverProfilePicture: item.driver_profile_picture,
          deliveryDate: item.created_at,
          rating: existingRating?.rating, // Only from ratings table
          comment: existingRating?.comment, // Only from ratings table
          isRated: !!(existingRating || item.customer_confirmed_at)
        };
      });

      setFeedbackItems(items);
      
    } catch (error) {
      console.error('Error fetching feedback:', error);
      Alert.alert('Error', 'Failed to load feedback data');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchFeedback();
  };

  const submitInlineRating = async (item: FeedbackItem) => {
    const ratingValue = inlineRating[item.deliveryId] || 0;
    
    if (ratingValue === 0) {
      Alert.alert('Rating Required', 'Please select a star rating');
      return;
    }

    setSubmittingId(item.deliveryId);

    try {
      const now = new Date().toISOString();
      const commentText = inlineComment[item.deliveryId] || '';

      // Insert into cloud
      await executeTursoQuery(
        `INSERT INTO driver_ratings (driver_id, customer_id, delivery_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.driverId, customerId, item.deliveryId, ratingValue, commentText || null, now]
      );

      // Insert into local
      await db.insert(driverRatingsTable).values({
        driverId: item.driverId,
        customerId,
        deliveryId: item.deliveryId,
        rating: ratingValue,
        comment: commentText || null,
        createdAt: now
      });

      // Update local state
      setFeedbackItems(prev =>
        prev.map(fb =>
          fb.deliveryId === item.deliveryId
            ? { ...fb, isRated: true, rating: ratingValue, comment: commentText }
            : fb
        )
      );

      // Clear inline states
      setInlineRating(prev => {
        const newState = { ...prev };
        delete newState[item.deliveryId];
        return newState;
      });
      setInlineComment(prev => {
        const newState = { ...prev };
        delete newState[item.deliveryId];
        return newState;
      });
      setShowCommentField(prev => {
        const newState = { ...prev };
        delete newState[item.deliveryId];
        return newState;
      });

    } catch (error) {
      console.error('Error submitting rating:', error);
      Alert.alert('Error', 'Failed to submit rating');
    } finally {
      setSubmittingId(null);
    }
  };

  const openRatingModal = (item: FeedbackItem) => {
    setSelectedDelivery({
      deliveryId: item.deliveryId,
      driverId: item.driverId,
      driverName: item.driverName,
      driverProfilePicture: item.driverProfilePicture
    });
    setModalVisible(true);
  };

  const handleModalSubmit = () => {
    fetchFeedback(); // Refresh the list
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const filteredItems = feedbackItems.filter(item => {
    if (filter === 'pending') return !item.isRated;
    if (filter === 'rated') return item.isRated;
    return true;
  });

  const pendingCount = feedbackItems.filter(item => !item.isRated).length;

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <ActivityIndicator size="large" color="#a855f7" />
        <Text style={{ color: '#a855f7', fontSize: 16, marginTop: 16 }}>Loading your feedback history...</Text>
      </View>
    );
  }

  return (
    <>
      <LinearGradient colors={['#030712', '#0f172a']} style={{ flex: 1, padding: 16 }}>
        
        {/* Header with counts */}
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: 'white', fontSize: 24, fontWeight: 'bold' }}>Your Feedback</Text>
          <Text style={{ color: '#9ca3af', fontSize: 14, marginTop: 4 }}>
            You have {pendingCount} pending {pendingCount === 1 ? 'rating' : 'ratings'}
          </Text>
        </View>

        {/* Filter Tabs */}
        <View style={{ flexDirection: 'row', marginBottom: 20, backgroundColor: 'rgba(31,41,55,0.5)', borderRadius: 30, padding: 4 }}>
          {(['all', 'pending', 'rated'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setFilter(tab)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 30,
                backgroundColor: filter === tab ? '#7c3aed' : 'transparent',
                alignItems: 'center'
              }}
            >
              <Text style={{ 
                color: filter === tab ? 'white' : '#9ca3af', 
                fontWeight: filter === tab ? '600' : '400',
                textTransform: 'capitalize'
              }}>
                {tab} {tab === 'pending' && `(${pendingCount})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Feedback List */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#a855f7" />
          }
        >
          {filteredItems.length === 0 ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
              <MaterialIcons name="rate-review" size={64} color="#4b5563" />
              <Text style={{ color: '#9ca3af', fontSize: 18, marginTop: 16, textAlign: 'center' }}>
                {filter === 'pending' 
                  ? 'No pending ratings! 🎉' 
                  : filter === 'rated' 
                  ? 'No ratings yet' 
                  : 'No delivery history yet'}
              </Text>
              <Text style={{ color: '#6b7280', fontSize: 14, marginTop: 8, textAlign: 'center' }}>
                {filter === 'pending' 
                  ? 'All your deliveries have been rated' 
                  : filter === 'rated'
                  ? 'You haven\'t rated any deliveries yet'
                  : 'Complete a delivery to leave feedback'}
              </Text>
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              {filteredItems.map((item) => (
                <View
                  key={item.deliveryId}
                >
                  {/* Inline Rating UI logic moved inside LinearGradient below */}
                  <LinearGradient
                    colors={!item.isRated ? ['rgba(124,58,237,0.1)', 'rgba(31,41,55,0.7)'] : ['#1f2937', '#111827']}
                    style={{
                      borderRadius: 16,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: !item.isRated ? 'rgba(168,85,247,0.3)' : 'rgba(75,85,99,0.3)',
                      borderStyle: !item.isRated ? 'dashed' : 'solid',
                    }}
                  >
                    {/* Driver Info & Date */}
                    <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                      <View style={{ width: 50, height: 50, borderRadius: 25, overflow: 'hidden', marginRight: 12 }}>
                        {item.driverProfilePicture ? (
                          <Image source={{ uri: item.driverProfilePicture }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        ) : (
                          <View style={{ width: '100%', height: '100%', backgroundColor: 'rgba(168,85,247,0.3)', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="person" size={28} color="#a855f7" />
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>{item.driverName}</Text>
                        <Text style={{ color: '#9ca3af', fontSize: 12 }}>{formatDate(item.deliveryDate)}</Text>
                      </View>
                      {!item.isRated && (
                        <View style={{ backgroundColor: 'rgba(168,85,247,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 }}>
                          <Text style={{ color: '#a855f7', fontSize: 12, fontWeight: '600' }}>Pending</Text>
                        </View>
                      )}
                    </View>

                    {/* Rated View */}
                    {item.isRated ? (
                      <View>
                        {/* Stars Display */}
                        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Ionicons
                              key={star}
                              name={star <= (item.rating || 0) ? 'star' : 'star-outline'}
                              size={20}
                              color={star <= (item.rating || 0) ? '#fbbf24' : '#4b5563'}
                              style={{ marginRight: 2 }}
                            />
                          ))}
                        </View>
                        
                        {/* Comment Display */}
                        {item.comment && (
                          <View>
                            <Text 
                              style={{ color: '#d1d5db', fontSize: 14, lineHeight: 20 }}
                              numberOfLines={expandedComment === item.deliveryId ? undefined : 2}
                            >
                              "{item.comment}"
                            </Text>
                            {item.comment.length > 100 && (
                              <TouchableOpacity 
                                onPress={() => setExpandedComment(
                                  expandedComment === item.deliveryId ? null : item.deliveryId
                                )}
                                style={{ marginTop: 4 }}
                              >
                                <Text style={{ color: '#a855f7', fontSize: 12 }}>
                                  {expandedComment === item.deliveryId ? 'Show less' : 'Read more'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    ) : (
                      /* Pending Rating - Inline Rating UI */
                      <View>
                        {/* Star Rating */}
                        <View style={{ flexDirection: 'row', marginBottom: 12, alignItems: 'center' }}>
                          <Text style={{ color: '#9ca3af', fontSize: 14, marginRight: 12 }}>Rate:</Text>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <TouchableOpacity
                                key={star}
                                onPress={() => setInlineRating(prev => ({ ...prev, [item.deliveryId]: star }))}
                              >
                                <Ionicons
                                  name={star <= (inlineRating[item.deliveryId] || 0) ? 'star' : 'star-outline'}
                                  size={28}
                                  color={star <= (inlineRating[item.deliveryId] || 0) ? '#fbbf24' : '#6b7280'}
                                />
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>

                        {/* Add Comment Button / Field */}
                        {!showCommentField[item.deliveryId] ? (
                          <TouchableOpacity
                            onPress={() => setShowCommentField(prev => ({ ...prev, [item.deliveryId]: true }))}
                            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}
                          >
                            <Ionicons name="add-circle-outline" size={20} color="#9ca3af" />
                            <Text style={{ color: '#9ca3af', fontSize: 14, marginLeft: 6 }}>Add a comment</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={{ marginBottom: 16 }}>
                            <TextInput
                              value={inlineComment[item.deliveryId] || ''}
                              onChangeText={(text) => setInlineComment(prev => ({ ...prev, [item.deliveryId]: text }))}
                              placeholder="Share your experience..."
                              placeholderTextColor="#6b7280"
                              multiline
                              style={{
                                backgroundColor: 'rgba(31,41,55,0.8)',
                                borderRadius: 12,
                                padding: 12,
                                color: 'white',
                                fontSize: 14,
                                borderWidth: 1,
                                borderColor: 'rgba(168,85,247,0.2)',
                                minHeight: 80,
                                textAlignVertical: 'top'
                              }}
                            />
                            <TouchableOpacity
                              onPress={() => setShowCommentField(prev => ({ ...prev, [item.deliveryId]: false }))}
                              style={{ alignSelf: 'flex-end', marginTop: 4 }}
                            >
                              <Text style={{ color: '#9ca3af', fontSize: 12 }}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {/* Action Buttons */}
                        <View style={{ flexDirection: 'row', gap: 12 }}>
                          <TouchableOpacity
                            onPress={() => submitInlineRating(item)}
                            disabled={submittingId === item.deliveryId || !inlineRating[item.deliveryId]}
                            style={{
                              flex: 1,
                              backgroundColor: inlineRating[item.deliveryId] ? '#7c3aed' : 'rgba(124,58,237,0.3)',
                              paddingVertical: 12,
                              borderRadius: 30,
                              alignItems: 'center'
                            }}
                          >
                            {submittingId === item.deliveryId ? (
                              <ActivityIndicator color="white" size="small" />
                            ) : (
                              <Text style={{ color: 'white', fontWeight: '600' }}>Submit Rating</Text>
                            )}
                          </TouchableOpacity>
                          
                          <TouchableOpacity
                            onPress={() => openRatingModal(item)}
                            style={{
                              paddingVertical: 12,
                              paddingHorizontal: 16,
                              borderRadius: 30,
                              backgroundColor: 'rgba(31,41,55,0.8)',
                              borderWidth: 1,
                              borderColor: 'rgba(168,85,247,0.3)',
                              alignItems: 'center'
                            }}
                          >
                            <Text style={{ color: '#a855f7' }}>Full View</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </LinearGradient>
                </View>
              ))}
            </View>
          )}
          
          {/* Bottom padding */}
          <View style={{ height: 40 }} />
        </ScrollView>
      </LinearGradient>

      {/* Rating Modal */}
      {selectedDelivery && (
        <RatingModal
          visible={modalVisible}
          onClose={() => {
            setModalVisible(false);
            setSelectedDelivery(null);
          }}
          onSubmit={handleModalSubmit}
          deliveryId={selectedDelivery.deliveryId}
          driverId={selectedDelivery.driverId}
          driverName={selectedDelivery.driverName}
          driverProfilePicture={selectedDelivery.driverProfilePicture}
          customerId={customerId}
        />
      )}
    </>
  );
}