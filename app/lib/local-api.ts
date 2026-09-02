// app/lib/local-api.ts
const LOCAL_API_BASE = '/api'; // This will be intercepted by your fetch wrapper

export class LocalApiClient {
  static async createBooking(bookingData: any) {
    const response = await fetch(`${LOCAL_API_BASE}/bookings/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingData),
    });
    
    if (!response.ok) {
      throw new Error(`Booking creation failed: ${response.status}`);
    }
    
    return response.json();
  }

  static async getNearbyDrivers(params: {
    lat: number;
    lng: number;
    radius?: number;
    vehicleType?: string;
  }) {
    const url = new URL(`${LOCAL_API_BASE}/drivers/nearby`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
    
    const response = await fetch(url.toString());
    
    if (!response.ok) {
      throw new Error(`Failed to fetch drivers: ${response.status}`);
    }
    
    return response.json();
  }

  static async respondToBooking(responseData: {
    requestId: number;
    driverId: number;
    response: 'accepted' | 'rejected';
    customerId?: number;
  }) {
    const apiResponse = await fetch(`${LOCAL_API_BASE}/bookings/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(responseData),
    });
    
    if (!apiResponse.ok) {
      throw new Error(`Response failed: ${apiResponse.status}`);
    }
    
    return apiResponse.json();
  }

  static async getBookingStatus(requestId: number) {
    const response = await fetch(`${LOCAL_API_BASE}/bookings/status?requestId=${requestId}`);
    
    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status}`);
    }
    
    return response.json();
  }

  static async updateDriverLocation(locationData: {
    driverId: number;
    location: { latitude: number; longitude: number };
    timestamp?: string;
  }) {
    const response = await fetch(`${LOCAL_API_BASE}/drivers/update-location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(locationData),
    });
    
    if (!response.ok) {
      throw new Error(`Location update failed: ${response.status}`);
    }
    
    return response.json();
  }
}
