// app/utils/databaseHelper.ts
import { db } from '@/src/db';
import { deliveryRequestsTable, driversTable } from '@/src/db/schema';
import { and, eq } from 'drizzle-orm';

export interface DriverLocation {
  longitude: number;
  latitude: number;
  heading?: number;
  eta?: number;
  driverId?: number;
}

export async function fetchActiveDeliveryAndDriver(customerId: number): Promise<{
  activeDelivery: any;
  driverLocation: DriverLocation | null;
}> {
  try {
    // Find active delivery for this customer
    const activeDeliveries = await db
      .select()
      .from(deliveryRequestsTable)
      .where(
        and(
          eq(deliveryRequestsTable.customerId, customerId),
          eq(deliveryRequestsTable.status, 'accepted')
        )
      )
      .limit(1);
    
    let activeDelivery = null;
    let driverLocation: DriverLocation | null = null;
    
    if (activeDeliveries.length > 0) {
      activeDelivery = activeDeliveries[0];
      
      // If there's an assigned driver, get their location
      if (activeDelivery.assignedDriverId) {
        const drivers = await db
          .select({
            id: driversTable.id,
            longitude: driversTable.longitude,
            latitude: driversTable.latitude,
            lastLocation: driversTable.lastLocation
          })
          .from(driversTable)
          .where(eq(driversTable.id, activeDelivery.assignedDriverId))
          .limit(1);
        
        if (drivers.length > 0) {
          const driver = drivers[0];
          
          // Parse driver location from database
          let parsedLocation = { longitude: 0, latitude: 0 };
          
          if (driver.lastLocation) {
            try {
              parsedLocation = JSON.parse(driver.lastLocation as any);
            } catch (e) {
              console.warn('Could not parse driver location:', e);
            }
          }
          
          // Use coordinates from separate columns or parsed location
          const longitude = driver.longitude || parsedLocation.longitude || 0;
          const latitude = driver.latitude || parsedLocation.latitude || 0;
          
          if (longitude && latitude) {
            driverLocation = {
              longitude,
              latitude,
              driverId: driver.id,
              eta: 15 // You can calculate this based on distance
            };
          }
        }
      }
    }
    
    return { activeDelivery, driverLocation };
    
  } catch (error) {
    console.error('Error fetching active delivery:', error);
    return { activeDelivery: null, driverLocation: null };
  }
}
