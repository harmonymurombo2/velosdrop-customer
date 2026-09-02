// components/customer/OrdersSection.tsx
import { useUser } from '@/app/context/UserContext';
import { db } from '@/src/db';
import { deliveryRequestsTable, driversTable } from '@/src/db/schema';
import {
    Feather,
    FontAwesome5,
    MaterialIcons
} from '@expo/vector-icons';
import { desc, eq } from 'drizzle-orm';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    Linking,
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

// Types based on your schema
interface Driver {
    id: number;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    profilePictureUrl: string | null;
    carName: string;
    numberPlate: string;
}

interface Order {
    id: number;
    customerId: number;
    customerUsername: string;
    pickupLocation: string | null;
    dropoffLocation: string | null;
    pickupAddress: string | null;
    pickupLatitude: number | null;
    pickupLongitude: number | null;
    dropoffAddress: string | null;
    dropoffLatitude: number | null;
    dropoffLongitude: number | null;
    fare: number;
    distance: number;
    vehicleType: string;
    packageDetails?: string | null;
    recipientPhoneNumber?: string | null;
    status: 'pending' | 'accepted' | 'picking_up' | 'in_transit' | 'completed' | 'cancelled';
    assignedDriverId?: number;
    createdAt: string;
    expiresAt: string;
    driverArrivedAt?: string | null;
    deliveryCompletedAt?: string | null;
    deliveryPhotoUrl?: string | null;
    driver?: Driver;
}

interface OrdersSectionProps {
    onClose?: () => void;
}

// Status config with React Native styles (not Tailwind classes)
const getStatusConfig = (status: Order['status']) => {
    const configs = {
        pending: { 
            text: 'Pending', 
            backgroundColor: 'rgba(234, 179, 8, 0.2)',
            textColor: '#fbbf24',
            borderColor: 'rgba(234, 179, 8, 0.3)',
            icon: Feather,
            iconName: 'clock' as const
        },
        accepted: { 
            text: 'Accepted', 
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            textColor: '#3b82f6',
            borderColor: 'rgba(59, 130, 246, 0.3)',
            icon: Feather,
            iconName: 'check' as const
        },
        picking_up: { 
            text: 'Picking Up', 
            backgroundColor: 'rgba(168, 85, 247, 0.2)',
            textColor: '#a855f7',
            borderColor: 'rgba(168, 85, 247, 0.3)',
            icon: Feather,
            iconName: 'package' as const
        },
        in_transit: { 
            text: 'In Transit', 
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            textColor: '#6366f1',
            borderColor: 'rgba(99, 102, 241, 0.3)',
            icon: Feather,
            iconName: 'truck' as const
        },
        completed: { 
            text: 'Completed', 
            backgroundColor: 'rgba(34, 197, 94, 0.2)',
            textColor: '#22c55e',
            borderColor: 'rgba(34, 197, 94, 0.3)',
            icon: Feather,
            iconName: 'check-circle' as const
        },
        cancelled: { 
            text: 'Cancelled', 
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            textColor: '#ef4444',
            borderColor: 'rgba(239, 68, 68, 0.3)',
            icon: Feather,
            iconName: 'x-circle' as const
        },
    };
    
    return configs[status];
};

// Type guard to check if a string is a valid Order status
const isValidOrderStatus = (status: string): status is Order['status'] => {
    return ['pending', 'accepted', 'picking_up', 'in_transit', 'completed', 'cancelled'].includes(status);
};

// Styles for better visibility
const styles = StyleSheet.create({
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
    },
    orderCard: {
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(75, 85, 99, 0.3)',
        overflow: 'hidden',
        backgroundColor: 'rgba(31, 41, 55, 0.5)',
        marginBottom: 16,
    },
    sectionHeader: {
        fontSize: 18,
        fontWeight: '600',
        color: 'white',
        marginBottom: 16,
    },
    modalContent: {
        padding: 24,
        backgroundColor: '#111827',
    },
    modalHeader: {
        padding: 24,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(75, 85, 99, 0.3)',
    },
    routeIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    timelineStep: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
});

export default function OrdersSection({ onClose }: OrdersSectionProps) {
    const { customer } = useUser();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch orders with driver info
    const fetchOrders = useCallback(async () => {
        if (!customer?.id) return;
    
        try {
            setError(null);
            
            const customerOrders = await db
                .select()
                .from(deliveryRequestsTable)
                .where(eq(deliveryRequestsTable.customerId, customer.id))
                .orderBy(desc(deliveryRequestsTable.createdAt));
    
            const ordersWithDriver = await Promise.all(
                customerOrders.map(async (order) => {
                    let driver: Driver | undefined;
                    
                    if (order.assignedDriverId) {
                        const driverResult = await db
                            .select()
                            .from(driversTable)
                            .where(eq(driversTable.id, order.assignedDriverId))
                            .limit(1);
                        
                        if (driverResult.length > 0) {
                            driver = {
                                ...driverResult[0],
                                profilePictureUrl: driverResult[0].profilePictureUrl || null
                            };
                        }
                    }
    
                    // Ensure status is valid, default to 'pending' if not
                    const status = isValidOrderStatus(order.status) 
                        ? order.status 
                        : 'pending';
    
                    // Create the order object with proper typing
                    const typedOrder: Order = {
                        id: order.id,
                        customerId: order.customerId,
                        customerUsername: order.customerUsername,
                        pickupLocation: order.pickupLocation || null,
                        dropoffLocation: order.dropoffLocation || null,
                        pickupAddress: order.pickupAddress || null,
                        pickupLatitude: order.pickupLatitude || null,
                        pickupLongitude: order.pickupLongitude || null,
                        dropoffAddress: order.dropoffAddress || null,
                        dropoffLatitude: order.dropoffLatitude || null,
                        dropoffLongitude: order.dropoffLongitude || null,
                        fare: order.fare,
                        distance: order.distance,
                        vehicleType: order.vehicleType,
                        packageDetails: order.packageDetails || null,
                        recipientPhoneNumber: order.recipientPhoneNumber || null,
                        status: status,
                        assignedDriverId: order.assignedDriverId || undefined,
                        createdAt: order.createdAt,
                        expiresAt: order.expiresAt,
                        driverArrivedAt: order.driverArrivedAt || null,
                        deliveryCompletedAt: order.deliveryCompletedAt || null,
                        deliveryPhotoUrl: order.deliveryPhotoUrl || null,
                        driver,
                    };
    
                    return typedOrder;
                })
            );
    
            setOrders(ordersWithDriver);
        } catch (error) {
            console.error('Error fetching orders:', error);
            setError('Failed to load orders. Please try again.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [customer]);
    
    // Initial fetch
    useEffect(() => {
        if (customer?.id) {
            fetchOrders();
        }
    }, [customer, fetchOrders]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchOrders();
    }, [fetchOrders]);

    // Delete order
    const deleteOrder = async (orderId: number) => {
        Alert.alert(
            'Delete Order',
            'Are you sure you want to delete this order? This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            setIsDeleting(true);
                            
                            // Delete from database
                            await db
                                .delete(deliveryRequestsTable)
                                .where(eq(deliveryRequestsTable.id, orderId));
                            
                            // Update local state
                            setOrders(prev => prev.filter(order => order.id !== orderId));
                            
                            if (selectedOrder?.id === orderId) {
                                setSelectedOrder(null);
                            }
                            
                            Alert.alert('Success', 'Order deleted successfully');
                        } catch (error) {
                            console.error('Error deleting order:', error);
                            Alert.alert('Error', 'Failed to delete order. Please try again.');
                        } finally {
                            setIsDeleting(false);
                        }
                    },
                },
            ]
        );
    };

    // Format date
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Call driver
    const callDriver = (phoneNumber: string) => {
        Linking.openURL(`tel:${phoneNumber}`).catch(err => {
            console.error('Failed to open phone app:', err);
            Alert.alert('Error', 'Could not open phone app');
        });
    };

    // Loading state
    if (loading) {
        return (
            <LinearGradient colors={['#030712', '#111827']} style={{ flex: 1 }}>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <ActivityIndicator size="large" color="#8b5cf6" />
                    <Text style={{ color: '#8b5cf6', fontSize: 18, marginTop: 16 }}>Loading your orders...</Text>
                    <Text style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>Please wait a moment</Text>
                </View>
            </LinearGradient>
        );
    }

    // Error state
    if (error) {
        return (
            <LinearGradient colors={['#030712', '#111827']} style={{ flex: 1 }}>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
                    <View style={{ 
                        width: 80, 
                        height: 80, 
                        borderRadius: 40, 
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginBottom: 20
                    }}>
                        <MaterialIcons name="error-outline" size={40} color="#ef4444" />
                    </View>
                    <Text style={{ color: '#ef4444', fontSize: 20, fontWeight: '600', marginBottom: 8 }}>Error Loading Orders</Text>
                    <Text style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>{error}</Text>
                    <TouchableOpacity
                        onPress={fetchOrders}
                        style={{
                            backgroundColor: '#7c3aed',
                            paddingHorizontal: 24,
                            paddingVertical: 12,
                            borderRadius: 12,
                        }}
                    >
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            </LinearGradient>
        );
    }

    // Empty state
    if (orders.length === 0) {
        return (
            <LinearGradient colors={['#030712', '#111827']} style={{ flex: 1 }}>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
                    <View style={{ 
                        width: 100, 
                        height: 100, 
                        borderRadius: 50, 
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        justifyContent: 'center',
                        alignItems: 'center',
                        marginBottom: 20
                    }}>
                        <Feather name="package" size={48} color="#8b5cf6" />
                    </View>
                    <Text style={{ color: 'white', fontSize: 20, fontWeight: '600', marginBottom: 8 }}>No orders yet</Text>
                    <Text style={{ color: '#9ca3af', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
                        Your delivery orders will appear here once you book a delivery
                    </Text>
                    <TouchableOpacity
                        onPress={onRefresh}
                        style={{
                            backgroundColor: '#7c3aed',
                            paddingHorizontal: 24,
                            paddingVertical: 12,
                            borderRadius: 12,
                        }}
                    >
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>Refresh</Text>
                    </TouchableOpacity>
                </View>
            </LinearGradient>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: '#030712' }}>
            {/* Header */}
            <View style={{ paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(75, 85, 99, 0.3)' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                        <Text style={{ fontSize: 28, fontWeight: 'bold', color: 'white' }}>My Orders</Text>
                        <Text style={{ fontSize: 14, color: '#9ca3af', marginTop: 4 }}>
                            {orders.length} order{orders.length !== 1 ? 's' : ''}
                        </Text>
                    </View>
                    
                    <TouchableOpacity
                        onPress={onRefresh}
                        style={{
                            padding: 10,
                            borderRadius: 12,
                            backgroundColor: 'rgba(31, 41, 55, 0.5)',
                            borderWidth: 1,
                            borderColor: 'rgba(139, 92, 246, 0.3)',
                        }}
                    >
                        <Feather name="refresh-cw" size={20} color="#8b5cf6" />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Orders List */}
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={['#8b5cf6']}
                        tintColor="#8b5cf6"
                    />
                }
                showsVerticalScrollIndicator={false}
            >
                <View style={{ gap: 16 }}>
                    {orders.map((order) => {
                        const statusConfig = getStatusConfig(order.status);
                        const StatusIcon = statusConfig.icon;
                        
                        return (
                            <View key={order.id} style={styles.orderCard}>
                                {/* Order Header */}
                                <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(75, 85, 99, 0.3)' }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                            <View style={{
                                                width: 48,
                                                height: 48,
                                                borderRadius: 24,
                                                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                            }}>
                                                <FontAwesome5 name="shopping-bag" size={20} color="#8b5cf6" />
                                            </View>
                                            <View>
                                                <Text style={{ fontSize: 18, fontWeight: '600', color: 'white' }}>
                                                    Order #{order.id}
                                                </Text>
                                                <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                                                    {formatDate(order.createdAt)}
                                                </Text>
                                            </View>
                                        </View>
                                        
                                        <View style={[styles.statusBadge, {
                                            backgroundColor: statusConfig.backgroundColor,
                                            borderColor: statusConfig.borderColor,
                                        }]}>
                                            <StatusIcon name={statusConfig.iconName} size={14} color={statusConfig.textColor} />
                                            <Text style={[styles.statusText, { color: statusConfig.textColor }]}>
                                                {statusConfig.text}
                                            </Text>
                                        </View>
                                    </View>
                                </View>

                                {/* Order Content */}
                                <View style={{ padding: 16 }}>
                                    {/* Fare and Distance */}
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                        <View>
                                            <Text style={{ fontSize: 24, fontWeight: 'bold', color: 'white' }}>
                                                ${order.fare.toFixed(2)}
                                            </Text>
                                            <Text style={{ fontSize: 12, color: '#9ca3af' }}>Total Fare</Text>
                                        </View>
                                        <View style={{ alignItems: 'flex-end' }}>
                                            <Text style={{ fontSize: 16, fontWeight: '600', color: 'white' }}>
                                                {order.distance} km
                                            </Text>
                                            <Text style={{ fontSize: 12, color: '#9ca3af' }}>Distance</Text>
                                        </View>
                                    </View>

                                    {/* Route */}
                                    <View style={{ marginBottom: 16 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
                                            <View style={{ alignItems: 'center', marginRight: 12 }}>
                                                <View style={[styles.routeIcon, { backgroundColor: '#10b981' }]}>
                                                    <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>A</Text>
                                                </View>
                                                <View style={{ width: 1, height: 40, backgroundColor: '#10b981', marginVertical: 4 }} />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Pickup Location</Text>
                                                <Text style={{ fontSize: 14, color: 'white', fontWeight: '500' }} numberOfLines={2}>
                                                    {order.pickupAddress || order.pickupLocation || 'No pickup location'}
                                                </Text>
                                            </View>
                                        </View>
                                        
                                        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                                            <View style={{ alignItems: 'center', marginRight: 12 }}>
                                                <View style={[styles.routeIcon, { backgroundColor: '#ef4444' }]}>
                                                    <Text style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>B</Text>
                                                </View>
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Delivery Location</Text>
                                                <Text style={{ fontSize: 14, color: 'white', fontWeight: '500' }} numberOfLines={2}>
                                                    {order.dropoffAddress || order.dropoffLocation || 'No delivery location'}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>

                                    {/* Driver Information */}
                                    {order.driver && order.status !== 'pending' && order.status !== 'cancelled' && (
                                        <View style={{ 
                                            marginBottom: 16,
                                            padding: 12,
                                            backgroundColor: 'rgba(139, 92, 246, 0.1)',
                                            borderRadius: 12,
                                            borderWidth: 1,
                                            borderColor: 'rgba(139, 92, 246, 0.2)',
                                        }}>
                                            <Text style={{ fontSize: 12, color: '#9ca3af', fontWeight: '500', marginBottom: 8 }}>
                                                <MaterialIcons name="person" size={12} /> Assigned Driver
                                            </Text>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                                <View style={{ position: 'relative' }}>
                                                    <View style={{
                                                        width: 48,
                                                        height: 48,
                                                        borderRadius: 24,
                                                        backgroundColor: '#374151',
                                                        overflow: 'hidden',
                                                        borderWidth: 2,
                                                        borderColor: 'rgba(139, 92, 246, 0.3)',
                                                    }}>
                                                        {order.driver.profilePictureUrl ? (
                                                            <Image
                                                                source={{ uri: order.driver.profilePictureUrl }}
                                                                style={{ width: '100%', height: '100%' }}
                                                                resizeMode="cover"
                                                            />
                                                        ) : (
                                                            <View style={{ 
                                                                width: '100%', 
                                                                height: '100%', 
                                                                backgroundColor: '#7c3aed',
                                                                justifyContent: 'center',
                                                                alignItems: 'center'
                                                            }}>
                                                                <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>
                                                                    {order.driver.firstName.charAt(0)}{order.driver.lastName.charAt(0)}
                                                                </Text>
                                                            </View>
                                                        )}
                                                    </View>
                                                    <View style={{
                                                        position: 'absolute',
                                                        bottom: -2,
                                                        right: -2,
                                                        width: 12,
                                                        height: 12,
                                                        borderRadius: 6,
                                                        backgroundColor: '#10b981',
                                                        borderWidth: 2,
                                                        borderColor: '#1f2937',
                                                    }} />
                                                </View>
                                                
                                                <View style={{ flex: 1 }}>
                                                    <Text style={{ fontSize: 16, fontWeight: '600', color: 'white' }}>
                                                        {order.driver.firstName} {order.driver.lastName}
                                                    </Text>
                                                    <Text style={{ fontSize: 12, color: '#9ca3af' }}>
                                                        {order.driver.carName} • {order.driver.numberPlate}
                                                    </Text>
                                                    <TouchableOpacity
                                                        onPress={() => callDriver(order.driver!.phoneNumber)}
                                                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}
                                                    >
                                                        <Feather name="phone" size={12} color="#3b82f6" />
                                                        <Text style={{ fontSize: 12, color: '#3b82f6' }}>Call Driver</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        </View>
                                    )}
                                </View>

                                {/* Action Buttons */}
                                <View style={{ 
                                    padding: 16, 
                                    borderTopWidth: 1, 
                                    borderTopColor: 'rgba(75, 85, 99, 0.3)',
                                    flexDirection: 'row',
                                    gap: 12,
                                }}>
                                    <TouchableOpacity
                                        onPress={() => setSelectedOrder(order)}
                                        style={{
                                            flex: 1,
                                            backgroundColor: '#7c3aed',
                                            paddingVertical: 12,
                                            borderRadius: 12,
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 8,
                                        }}
                                    >
                                        <Feather name="map" size={16} color="white" />
                                        <Text style={{ color: 'white', fontWeight: '600' }}>View Details</Text>
                                    </TouchableOpacity>
                                    
                                    <TouchableOpacity
                                        onPress={() => deleteOrder(order.id)}
                                        disabled={isDeleting}
                                        style={{
                                            paddingHorizontal: 16,
                                            backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                            borderWidth: 1,
                                            borderColor: 'rgba(239, 68, 68, 0.4)',
                                            paddingVertical: 12,
                                            borderRadius: 12,
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 8,
                                            opacity: isDeleting ? 0.5 : 1,
                                        }}
                                    >
                                        {isDeleting ? (
                                            <ActivityIndicator size="small" color="#f87171" />
                                        ) : (
                                            <Feather name="trash-2" size={16} color="#f87171" />
                                        )}
                                        <Text style={{ color: '#f87171', fontWeight: '600' }}>
                                            {isDeleting ? 'Deleting...' : 'Delete'}
                                        </Text>
                                    </TouchableOpacity>
                                    
                                    {order.driver && order.status !== 'pending' && order.status !== 'cancelled' && (
                                        <TouchableOpacity
                                            onPress={() => callDriver(order.driver!.phoneNumber)}
                                            style={{
                                                paddingHorizontal: 16,
                                                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                                                borderWidth: 1,
                                                borderColor: 'rgba(34, 197, 94, 0.4)',
                                                paddingVertical: 12,
                                                borderRadius: 12,
                                                flexDirection: 'row',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 8,
                                            }}
                                        >
                                            <Feather name="phone" size={16} color="#10b981" />
                                            <Text style={{ color: '#10b981', fontWeight: '600' }}>Call</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        );
                    })}
                </View>
            </ScrollView>

            {/* Order Details Modal */}
            <Modal
                visible={!!selectedOrder}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setSelectedOrder(null)}
            >
                {selectedOrder && (
                    <OrderDetailsModal
                        order={selectedOrder}
                        onClose={() => setSelectedOrder(null)}
                        onDelete={() => {
                            deleteOrder(selectedOrder.id);
                            setSelectedOrder(null);
                        }}
                    />
                )}
            </Modal>
        </View>
    );
}

// Order Details Modal Component
function OrderDetailsModal({ order, onClose, onDelete }: { order: Order; onClose: () => void; onDelete?: () => void }) {
    const statusConfig = getStatusConfig(order.status);
    const StatusIcon = statusConfig.icon;

    const callDriver = (phoneNumber: string) => {
        Linking.openURL(`tel:${phoneNumber}`).catch(err => {
            console.error('Failed to open phone app:', err);
            Alert.alert('Error', 'Could not open phone app');
        });
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <View style={{ 
            flex: 1, 
            backgroundColor: 'rgba(0, 0, 0, 0.8)', 
            justifyContent: 'center',
            padding: 16,
        }}>
            <View style={{
                backgroundColor: '#111827',
                borderRadius: 24,
                borderWidth: 1,
                borderColor: 'rgba(139, 92, 246, 0.3)',
                maxHeight: height * 0.9,
                overflow: 'hidden',
            }}>
                {/* Header */}
                <View style={[styles.modalHeader, { backgroundColor: '#1e1b4b' }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                            <View style={{
                                width: 64,
                                height: 64,
                                borderRadius: 32,
                                backgroundColor: '#7c3aed',
                                justifyContent: 'center',
                                alignItems: 'center',
                            }}>
                                <FontAwesome5 name="package" size={28} color="white" />
                            </View>
                            <View>
                                <Text style={{ fontSize: 24, fontWeight: 'bold', color: 'white' }}>
                                    Order #{order.id}
                                </Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
                                    <View style={[styles.statusBadge, {
                                        backgroundColor: statusConfig.backgroundColor,
                                        borderColor: statusConfig.borderColor,
                                    }]}>
                                        <StatusIcon name={statusConfig.iconName} size={14} color={statusConfig.textColor} />
                                        <Text style={[styles.statusText, { color: statusConfig.textColor }]}>
                                            {statusConfig.text}
                                        </Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                        <Feather name="calendar" size={14} color="#9ca3af" />
                                        <Text style={{ fontSize: 12, color: '#9ca3af' }}>
                                            {formatDate(order.createdAt)}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </View>
                        
                        <TouchableOpacity
                            onPress={onClose}
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 20,
                                backgroundColor: 'rgba(75, 85, 99, 0.3)',
                                justifyContent: 'center',
                                alignItems: 'center',
                                borderWidth: 1,
                                borderColor: 'rgba(75, 85, 99, 0.5)',
                            }}
                        >
                            <Feather name="x" size={20} color="#9ca3af" />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Content */}
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                    <View style={styles.modalContent}>
                        {/* Delivery Route */}
                        <View style={{ marginBottom: 24 }}>
                            <Text style={styles.sectionHeader}>
                                <MaterialIcons name="navigation" size={18} color="#8b5cf6" /> Delivery Route
                            </Text>
                            
                            <View style={{ gap: 20 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
                                    <View style={{ alignItems: 'center' }}>
                                        <View style={[styles.routeIcon, { backgroundColor: '#10b981' }]}>
                                            <Text style={{ color: 'white', fontSize: 14, fontWeight: 'bold' }}>A</Text>
                                        </View>
                                        <View style={{ width: 2, height: 48, backgroundColor: '#10b981', marginVertical: 8 }} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Pickup Location</Text>
                                        <Text style={{ fontSize: 16, color: 'white', fontWeight: '500' }}>
                                            {order.pickupAddress || order.pickupLocation || 'No pickup location'}
                                        </Text>
                                    </View>
                                </View>
                                
                                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
                                    <View style={{ alignItems: 'center' }}>
                                        <View style={[styles.routeIcon, { backgroundColor: '#ef4444' }]}>
                                            <Text style={{ color: 'white', fontSize: 14, fontWeight: 'bold' }}>B</Text>
                                        </View>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Delivery Location</Text>
                                        <Text style={{ fontSize: 16, color: 'white', fontWeight: '500' }}>
                                            {order.dropoffAddress || order.dropoffLocation || 'No delivery location'}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </View>

                        {/* Package Details */}
                        {order.packageDetails && (
                            <View style={{ marginBottom: 24 }}>
                                <Text style={styles.sectionHeader}>
                                    <Feather name="package" size={18} color="#3b82f6" /> Package Details
                                </Text>
                                <Text style={{ fontSize: 14, color: '#d1d5db', lineHeight: 20 }}>
                                    {order.packageDetails}
                                </Text>
                            </View>
                        )}

                        {/* Recipient Info */}
                        {order.recipientPhoneNumber && (
                            <View style={{ marginBottom: 24 }}>
                                <Text style={styles.sectionHeader}>
                                    <Feather name="user" size={18} color="#10b981" /> Recipient Information
                                </Text>
                                <TouchableOpacity
                                    onPress={() => callDriver(order.recipientPhoneNumber!)}
                                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                                >
                                    <Feather name="phone" size={16} color="#3b82f6" />
                                    <Text style={{ fontSize: 16, color: '#3b82f6', fontWeight: '600' }}>
                                        {order.recipientPhoneNumber}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Driver Information */}
                        {order.driver && order.status !== 'pending' && order.status !== 'cancelled' && (
                            <View style={{ 
                                marginBottom: 24,
                                padding: 16,
                                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                                borderRadius: 16,
                                borderWidth: 1,
                                borderColor: 'rgba(139, 92, 246, 0.2)',
                            }}>
                                <Text style={styles.sectionHeader}>
                                    <Feather name="user" size={18} color="#8b5cf6" /> Driver Information
                                </Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                    <View style={{
                                        width: 64,
                                        height: 64,
                                        borderRadius: 32,
                                        backgroundColor: '#374151',
                                        overflow: 'hidden',
                                        borderWidth: 2,
                                        borderColor: 'rgba(139, 92, 246, 0.3)',
                                    }}>
                                        {order.driver.profilePictureUrl ? (
                                            <Image
                                                source={{ uri: order.driver.profilePictureUrl }}
                                                style={{ width: '100%', height: '100%' }}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View style={{ 
                                                width: '100%', 
                                                height: '100%', 
                                                backgroundColor: '#7c3aed',
                                                justifyContent: 'center',
                                                alignItems: 'center'
                                            }}>
                                                <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>
                                                    {order.driver.firstName.charAt(0)}{order.driver.lastName.charAt(0)}
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ fontSize: 20, fontWeight: '600', color: 'white' }}>
                                            {order.driver.firstName} {order.driver.lastName}
                                        </Text>
                                        <Text style={{ fontSize: 14, color: '#9ca3af', marginTop: 2 }}>
                                            {order.driver.phoneNumber}
                                        </Text>
                                        <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                                            {order.driver.carName} • {order.driver.numberPlate}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* Order Summary */}
                        <View style={{ marginBottom: 24 }}>
                            <Text style={styles.sectionHeader}>
                                <Feather name="dollar-sign" size={18} color="#10b981" /> Order Summary
                            </Text>
                            <View style={{ gap: 12 }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={{ fontSize: 14, color: '#9ca3af' }}>Distance</Text>
                                    <Text style={{ fontSize: 16, fontWeight: '600', color: 'white' }}>{order.distance} km</Text>
                                </View>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={{ fontSize: 14, color: '#9ca3af' }}>Delivery Fare</Text>
                                    <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#10b981' }}>
                                        ${order.fare.toFixed(2)}
                                    </Text>
                                </View>
                                <View style={{ 
                                    flexDirection: 'row', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    paddingTop: 16,
                                    borderTopWidth: 1,
                                    borderTopColor: 'rgba(75, 85, 99, 0.3)',
                                }}>
                                    <Text style={{ fontSize: 16, fontWeight: '600', color: 'white' }}>Total</Text>
                                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#10b981' }}>
                                        ${order.fare.toFixed(2)}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Delivery Timeline */}
                        <View>
                            <Text style={styles.sectionHeader}>
                                Delivery Timeline
                            </Text>
                            <View style={{ gap: 16 }}>
                                {['pending', 'accepted', 'picking_up', 'in_transit', 'completed'].map((status, index) => {
                                    const isActive = order.status === status;
                                    const isCompleted = ['accepted', 'picking_up', 'in_transit', 'completed'].indexOf(order.status) >= 
                                                        ['accepted', 'picking_up', 'in_transit', 'completed'].indexOf(status);
                                    
                                    const timelineStatusConfig = getStatusConfig(status as Order['status']);
                                    
                                    return (
                                        <View key={status} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                            <View style={[styles.timelineStep, {
                                                backgroundColor: isCompleted 
                                                    ? '#10b981' 
                                                    : isActive
                                                    ? '#8b5cf6'
                                                    : '#374151',
                                            }]}>
                                                <Text style={{ 
                                                    color: isCompleted || isActive ? 'white' : '#9ca3af',
                                                    fontSize: 14,
                                                    fontWeight: '600'
                                                }}>
                                                    {index + 1}
                                                </Text>
                                            </View>
                                            <Text style={{
                                                flex: 1,
                                                fontSize: 14,
                                                fontWeight: '500',
                                                color: isCompleted || isActive ? 'white' : '#9ca3af',
                                            }}>
                                                {timelineStatusConfig.text}
                                            </Text>
                                            {isActive && (
                                                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#8b5cf6' }} />
                                            )}
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    </View>
                </ScrollView>

                {/* Footer Actions */}
                <View style={{ 
                    padding: 24, 
                    borderTopWidth: 1, 
                    borderTopColor: 'rgba(75, 85, 99, 0.3)',
                    backgroundColor: 'rgba(31, 41, 55, 0.3)',
                    flexDirection: 'row',
                    gap: 12,
                }}>
                    <TouchableOpacity
                        onPress={onClose}
                        style={{
                            flex: 1,
                            backgroundColor: 'rgba(75, 85, 99, 0.3)',
                            paddingVertical: 14,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: 'rgba(75, 85, 99, 0.5)',
                        }}
                    >
                        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
                            Close Details
                        </Text>
                    </TouchableOpacity>
                    
                    {onDelete && (
                        <TouchableOpacity
                            onPress={onDelete}
                            style={{
                                flex: 1,
                                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                paddingVertical: 14,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: 'rgba(239, 68, 68, 0.4)',
                            }}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                <Feather name="trash-2" size={16} color="#f87171" />
                                <Text style={{ color: '#f87171', fontSize: 16, fontWeight: '600' }}>
                                    Delete Order
                                </Text>
                            </View>
                        </TouchableOpacity>
                    )}
                    
                    {order.driver && order.status !== 'pending' && order.status !== 'cancelled' && (
                        <TouchableOpacity
                            onPress={() => callDriver(order.driver!.phoneNumber)}
                            style={{
                                flex: 1,
                                backgroundColor: '#10b981',
                                paddingVertical: 14,
                                borderRadius: 12,
                            }}
                        >
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                <Feather name="phone" size={16} color="white" />
                                <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>
                                    Call Driver
                                </Text>
                            </View>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </View>
    );
}