// utils/pricingCalculator.ts
// Production-ready pricing algorithm for Harare, Zimbabwe
export interface PricingFactors {
  distance: number; // in km
  vehicleType: 'motorcycle' | 'car' | 'van' | 'truck';
  packageSize?: 'small' | 'medium' | 'large' | 'extra_large';
  packageWeight?: number; // in kg
  urgency?: 'standard' | 'express' | 'priority';
  timeOfDay?: 'normal' | 'peak' | 'night';
  areaMultiplier?: number;
}

// Vehicle-specific pricing rates (per km in USD) - REDUCED FOR AFFORDABILITY
export const VEHICLE_RATES = {
  motorcycle: 0.25, // Reduced from 0.40
  car: 0.35,        // Reduced from 0.50
  van: 0.60,        // Reduced from 0.80
  truck: 0.80       // Reduced from 0.95
} as const;

export const MINIMUM_FARES = {
  motorcycle: 1.00,  // Reduced from 2.00
  car: 1.50,         // Reduced from 3.00
  van: 2.50,         // Reduced from 4.00
  truck: 3.50        // Reduced from 5.00
} as const;

export const SIZE_MULTIPLIERS = {
  small: 1.0,
  medium: 1.15,
  large: 1.35,
  extra_large: 1.6
} as const;

export const URGENCY_MULTIPLIERS = {
  standard: 1.0,
  express: 1.35,
  priority: 1.6
} as const;

export const TIME_MULTIPLIERS = {
  normal: 1.0,
  peak: 1.25,
  night: 1.4
} as const;

export const AREA_MULTIPLIERS = {
  cbd: 1.0,
  suburbs: 1.15,
  outskirts: 1.3,
  industrial: 1.2
} as const;

export const calculateFare = (factors: PricingFactors): number => {
  const baseRate = VEHICLE_RATES[factors.vehicleType];
  const minFare = MINIMUM_FARES[factors.vehicleType];
  
  const roundedDistance = Math.ceil(factors.distance * 2) / 2;
  let total = roundedDistance * baseRate;
  
  if (factors.packageSize) {
    total *= SIZE_MULTIPLIERS[factors.packageSize];
  }
  
  if (factors.packageWeight) {
    if (factors.packageWeight > 5 && factors.packageWeight <= 20) {
      total += 0.50;
    } else if (factors.packageWeight > 20 && factors.packageWeight <= 50) {
      total += 1.50;
    } else if (factors.packageWeight > 50) {
      total += 2.50 + (factors.packageWeight - 50) * 0.05;
    }
  }
  
  if (factors.urgency) {
    total *= URGENCY_MULTIPLIERS[factors.urgency];
  }
  
  if (factors.timeOfDay) {
    total *= TIME_MULTIPLIERS[factors.timeOfDay];
  }
  
  if (factors.areaMultiplier) {
    total *= factors.areaMultiplier;
  }
  
  total = Math.max(minFare, total);
  
  const maxFare = 500.00;
  const roundedTotal = Math.ceil(total * 100) / 100;
  
  return Math.min(maxFare, roundedTotal);
};

export const calculateAllVehicleFares = (
  distance: number, 
  additionalFactors?: {
    packageSize?: keyof typeof SIZE_MULTIPLIERS;
    packageWeight?: number;
    urgency?: keyof typeof URGENCY_MULTIPLIERS;
    timeOfDay?: keyof typeof TIME_MULTIPLIERS;
    areaType?: keyof typeof AREA_MULTIPLIERS;
  }
): Record<keyof typeof VEHICLE_RATES, number> => {
  const areaMultiplier = additionalFactors?.areaType ? 
    AREA_MULTIPLIERS[additionalFactors.areaType] : 1;
  
  return {
    motorcycle: calculateFare({ 
      distance, 
      vehicleType: 'motorcycle',
      ...additionalFactors,
      areaMultiplier
    }),
    car: calculateFare({ 
      distance, 
      vehicleType: 'car',
      ...additionalFactors,
      areaMultiplier
    }),
    van: calculateFare({ 
      distance, 
      vehicleType: 'van',
      ...additionalFactors,
      areaMultiplier
    }),
    truck: calculateFare({ 
      distance, 
      vehicleType: 'truck',
      ...additionalFactors,
      areaMultiplier
    })
  };
};

export const recommendVehicle = (
  packageSize?: keyof typeof SIZE_MULTIPLIERS,
  packageWeight?: number
): keyof typeof VEHICLE_RATES => {
  if (packageWeight && packageWeight > 200) {
    return 'truck';
  }
  
  if (packageWeight && packageWeight > 50) {
    return 'van';
  }
  
  if (packageSize === 'extra_large' || (packageWeight && packageWeight > 20)) {
    return 'car';
  }
  
  if (packageSize === 'large' || (packageWeight && packageWeight > 10)) {
    return 'car';
  }
  
  if (packageSize === 'medium' || (packageWeight && packageWeight > 3)) {
    return 'car';
  }
  
  return 'motorcycle';
};

export const estimateDeliveryTime = (
  distance: number,
  vehicleType: keyof typeof VEHICLE_RATES,
  urgency: keyof typeof URGENCY_MULTIPLIERS = 'standard',
  isPeakHour: boolean = false
): { min: number; max: number } => {
  const baseSpeeds = {
    motorcycle: isPeakHour ? 25 : 35,
    car: isPeakHour ? 20 : 30,
    van: isPeakHour ? 18 : 28,
    truck: isPeakHour ? 15 : 25
  };
  
  const speed = baseSpeeds[vehicleType];
  const travelTime = (distance / speed) * 60;
  
  const pickupTime = 15;
  const dropoffTime = 10;
  const trafficBuffer = isPeakHour ? 20 : 10;
  
  const baseTotal = travelTime + pickupTime + dropoffTime + trafficBuffer;
  
  const urgencyFactors = {
    standard: { min: 1.0, max: 1.3 },
    express: { min: 0.7, max: 0.9 },
    priority: { min: 0.5, max: 0.7 }
  };
  
  const factor = urgencyFactors[urgency];
  
  return {
    min: Math.ceil(baseTotal * factor.min),
    max: Math.ceil(baseTotal * factor.max)
  };
};

export const calculateDistance = (
  coord1: [number, number], 
  coord2: [number, number]
): number => {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;
  
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  
  return R * c;
};

export const isPeakHour = (date: Date = new Date()): boolean => {
  const hour = date.getHours();
  const day = date.getDay();
  
  if (day >= 1 && day <= 5) {
    return (hour >= 7 && hour < 9) || (hour >= 16 && hour < 19);
  }
  
  if (day === 6) {
    return hour >= 8 && hour < 11;
  }
  
  return false;
};

export const isNightTime = (date: Date = new Date()): boolean => {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
};

export const formatCurrency = (amount: number): string => {
  return `$${amount.toFixed(2)}`;
};

export const getVehicleIcon = (vehicleType: keyof typeof VEHICLE_RATES): string => {
  const icons = {
    motorcycle: 'bicycle',
    car: 'car',
    van: 'bus',
    truck: 'cog'
  };
  return icons[vehicleType];
};

export const getVehicleDisplayName = (vehicleType: keyof typeof VEHICLE_RATES): string => {
  const names = {
    motorcycle: 'Motorcycle',
    car: 'Car',
    van: 'Van',
    truck: 'Truck'
  };
  return names[vehicleType];
};

export const getVehicleDescription = (vehicleType: keyof typeof VEHICLE_RATES): string => {
  const descriptions = {
    motorcycle: '',
    car: '',
    van: '',
    truck: ''
  };
  return descriptions[vehicleType];
};

export const getVehicleRate = (vehicleType: keyof typeof VEHICLE_RATES): number => {
  return VEHICLE_RATES[vehicleType];
};