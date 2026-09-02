// src/db/index.ts
import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as SQLite from "expo-sqlite";
import * as schema from "./schema";
import { customersTable, otpTable } from "./schema";

/**
 * 1. Open the local SQLite database using Expo SQLite
 */
const expoDb = SQLite.openDatabaseSync("velosdrop.db");

/**
 * 2. Create Drizzle instance with Expo SQLite
 */
export const db = drizzle(expoDb, { schema });

/**
 * 3. Turso HTTP Client for syncing with cloud database
 */
// IMPORTANT: Make sure your environment variables are correctly set
const TURSO_URL = process.env.EXPO_PUBLIC_TURSO_SYNC_URL?.replace('libsql://', 'https://') || '';
const TURSO_TOKEN = process.env.EXPO_PUBLIC_TURSO_AUTH_TOKEN || '';

// Validate environment variables
if (!TURSO_URL || !TURSO_TOKEN) {
  console.error('❌ Missing Turso environment variables. Check your .env file.');
}

/**
 * Execute a query on Turso cloud database via HTTP
 */
export async function executeTursoQuery(sql: string, params: any[] = []) {
  try {
    console.log('🔍 Executing Turso query:', sql.substring(0, 100));
    
    // Add better debugging for URL
    console.log('🔍 Turso URL:', TURSO_URL.substring(0, 50) + '...');
    
    const response = await fetch(`${TURSO_URL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TURSO_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        statements: [{ q: sql, params }]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Turso HTTP error:', response.status, errorText);
      throw new Error(`Turso HTTP error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Turso query successful');
    return result;
  } catch (error) {
    console.error('❌ Turso query failed:', error);
    throw error;
  }
}

/**
 * Fix phone_number constraint - Make it nullable for Google users
 * This creates a new table with correct schema and migrates data
 */
export const fixPhoneNumberConstraint = async (): Promise<void> => {
  try {
    console.log('🔧 Fixing phone_number constraint...');
    
    // Check if customers table exists first
    try {
      const tableInfo = await expoDb.getAllAsync("PRAGMA table_info(customers)");
      
      // Type the table info properly
      interface TableColumnInfo {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }
      
      const typedTableInfo = tableInfo as TableColumnInfo[];
      const phoneColumn = typedTableInfo.find((col: TableColumnInfo) => col.name === 'phone_number');
      
      if (phoneColumn && phoneColumn.notnull === 1) {
        console.log('⚠️ phone_number is NOT NULL, fixing...');
        
        // Create new table with correct schema
        await expoDb.execAsync(`
          CREATE TABLE IF NOT EXISTS customers_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            email TEXT,
            google_id TEXT,
            phone_number TEXT,
            password TEXT,
            auth_provider TEXT DEFAULT 'phone',
            profile_picture_url TEXT,
            is_verified INTEGER DEFAULT 0 NOT NULL,
            last_login TEXT DEFAULT CURRENT_TIMESTAMP,
            home_address TEXT,
            work_address TEXT,
            last_location TEXT,
            latitude REAL,
            longitude REAL,
            status TEXT DEFAULT 'active' NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
          );
        `);
        
        // Copy existing data if any
        try {
          await expoDb.execAsync(`
            INSERT INTO customers_new 
            SELECT * FROM customers;
          `);
        } catch (copyError) {
          console.log('📝 No data to copy, table was likely empty');
        }
        
        // Drop old table
        await expoDb.execAsync(`DROP TABLE IF EXISTS customers;`);
        
        // Rename new table
        await expoDb.execAsync(`ALTER TABLE customers_new RENAME TO customers;`);
        
        console.log('✅ phone_number constraint fixed');
      } else {
        console.log('✅ phone_number is already nullable');
      }
    } catch (error) {
      console.log('📝 Customers table does not exist, creating it with correct schema...');
      await expoDb.execAsync(`
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          username TEXT UNIQUE NOT NULL,
          email TEXT,
          google_id TEXT,
          phone_number TEXT,
          password TEXT,
          auth_provider TEXT DEFAULT 'phone',
          profile_picture_url TEXT,
          is_verified INTEGER DEFAULT 0 NOT NULL,
          last_login TEXT DEFAULT CURRENT_TIMESTAMP,
          home_address TEXT,
          work_address TEXT,
          last_location TEXT,
          latitude REAL,
          longitude REAL,
          status TEXT DEFAULT 'active' NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);
      console.log('✅ Created customers table with correct schema');
    }
    
  } catch (error) {
    console.error('❌ Error fixing phone_number constraint:', error);
  }
};

/**
 * Fix drivers table schema - Add missing columns
 */
export const fixDriversSchema = async (): Promise<void> => {
  try {
    console.log('🔧 Fixing drivers table schema...');
    
    // Check if drivers table exists
    try {
      const tableInfo = await expoDb.getAllAsync("PRAGMA table_info(drivers)");
      
      interface TableColumnInfo {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }
      
      const typedTableInfo = tableInfo as TableColumnInfo[];
      const columnNames = typedTableInfo.map(col => col.name);
      console.log('📊 Current drivers columns:', columnNames);
      
      // Add missing columns that might be in Turso
      const columnsToAdd = [
        { name: 'license_expiry', type: 'TEXT NOT NULL' },
        { name: 'registration_expiry', type: 'TEXT NOT NULL' },
        { name: 'license_front_url', type: 'TEXT' },
        { name: 'license_back_url', type: 'TEXT' },
        { name: 'registration_front_url', type: 'TEXT' },
        { name: 'registration_back_url', type: 'TEXT' },
        { name: 'national_id_front_url', type: 'TEXT' },
        { name: 'national_id_back_url', type: 'TEXT' },
        { name: 'vehicle_front_url', type: 'TEXT' },
        { name: 'vehicle_back_url', type: 'TEXT' },
        { name: 'last_online', type: 'TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL' }
      ];
      
      for (const column of columnsToAdd) {
        const exists = typedTableInfo.some(col => col.name === column.name);
        if (!exists) {
          console.log(`📝 Adding ${column.name} column to drivers table...`);
          try {
            // Handle NOT NULL constraint differently
            if (column.type.includes('NOT NULL') && !column.type.includes('DEFAULT')) {
              // Add without NOT NULL first, then update with default value
              await expoDb.execAsync(`ALTER TABLE drivers ADD COLUMN ${column.name.replace('NOT NULL', '').trim()};`);
              // Set default value for existing rows
              if (column.name === 'license_expiry' || column.name === 'registration_expiry') {
                await expoDb.execAsync(`UPDATE drivers SET ${column.name} = '2024-12-31' WHERE ${column.name} IS NULL;`);
              }
            } else {
              await expoDb.execAsync(`ALTER TABLE drivers ADD COLUMN ${column.name} ${column.type};`);
            }
            console.log(`✅ Added ${column.name} column to drivers table`);
          } catch (alterError) {
            console.warn(`⚠️ Could not add ${column.name} to drivers table:`, alterError);
          }
        }
      }
      
    } catch (tableError) {
      console.log('⚠️ Drivers table does not exist, creating it...');
      // Table doesn't exist, create it with all columns
      await expoDb.execAsync(`
        CREATE TABLE IF NOT EXISTS drivers (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          phone_number TEXT NOT NULL,
          first_name TEXT NOT NULL,
          last_name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          profile_picture_url TEXT,
          balance INTEGER DEFAULT 0 NOT NULL,
          license_front_url TEXT,
          license_back_url TEXT,
          registration_front_url TEXT,
          registration_back_url TEXT,
          national_id_front_url TEXT,
          national_id_back_url TEXT,
          vehicle_front_url TEXT,
          vehicle_back_url TEXT,
          vehicle_type TEXT NOT NULL,
          car_name TEXT NOT NULL,
          number_plate TEXT NOT NULL,
          license_expiry TEXT NOT NULL,
          registration_expiry TEXT NOT NULL,
          is_online INTEGER DEFAULT 0 NOT NULL,
          last_location TEXT,
          latitude REAL,
          longitude REAL,
          last_online TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          status TEXT DEFAULT 'pending' NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);
      console.log('✅ Created drivers table with all columns');
    }
    
    console.log('✅ Drivers table schema fixed');
  } catch (error) {
    console.error('❌ Error fixing drivers schema:', error);
  }
};

/**
 * Update Profile Picture
 * Updates both Cloud (Turso) and Local (SQLite) databases
 */
export const updateUserProfilePicture = async (customerId: number, imageUrl: string): Promise<boolean> => {
  try {
    console.log(`🖼️ Updating profile picture for user ${customerId}...`);

    // 1. Update CLOUD database (Turso)
    const cloudQuery = `UPDATE customers SET profile_picture_url = ?, updated_at = ? WHERE id = ?`;
    const now = new Date().toISOString();
    
    await executeTursoQuery(cloudQuery, [imageUrl, now, customerId]);
    console.log('✅ Profile picture updated in Cloud');

    // 2. Update LOCAL database
    await db.update(customersTable)
      .set({ 
        profilePictureUrl: imageUrl,
        updatedAt: now 
      })
      .where(eq(customersTable.id, customerId));
      
    console.log('✅ Profile picture updated locally');
    return true;

  } catch (error) {
    console.error('❌ Failed to update profile picture in DB:', error);
    throw error;
  }
};

/**
 * Sync specific customer to cloud - Call after login/signup
 */
export const syncCustomerToCloud = async (customerId: number): Promise<boolean> => {
  try {
    console.log(`☁️ Syncing customer ${customerId} to cloud...`);
    
    // 1. Get customer from local database
    const localCustomer = await db.query.customersTable.findFirst({
      where: eq(customersTable.id, customerId)
    });
    
    if (!localCustomer) {
      console.error('❌ Customer not found in local database');
      return false;
    }
    
    // 2. Check if customer exists in cloud
    const checkQuery = `SELECT id FROM customers WHERE id = ?`;
    const existsResult = await executeTursoQuery(checkQuery, [customerId]);
    
    const existsInCloud = existsResult[0]?.results?.rows?.length > 0;
    
    if (existsInCloud) {
      // UPDATE existing customer in cloud
      console.log('📝 Updating existing customer in cloud...');
      
      const updateQuery = `
        UPDATE customers 
        SET username = ?, 
            email = ?, 
            phone_number = ?, 
            password = ?,
            profile_picture_url = ?,
            auth_provider = ?,
            is_verified = ?,
            last_login = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
      `;
      
      await executeTursoQuery(updateQuery, [
        localCustomer.username,
        localCustomer.email,
        localCustomer.phoneNumber,
        localCustomer.password,
        localCustomer.profilePictureUrl,
        localCustomer.authProvider || 'phone',
        localCustomer.isVerified ? 1 : 0,
        new Date().toISOString(),
        localCustomer.status,
        new Date().toISOString(),
        customerId
      ]);
      
    } else {
      // INSERT new customer to cloud
      console.log('➕ Inserting new customer to cloud...');
      
      const insertQuery = `
        INSERT INTO customers (
          id, username, email, google_id, phone_number, password, 
          auth_provider, profile_picture_url, is_verified, 
          home_address, work_address, last_location, latitude, longitude,
          status, created_at, updated_at, last_login
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await executeTursoQuery(insertQuery, [
        customerId,
        localCustomer.username,
        localCustomer.email,
        localCustomer.googleId,
        localCustomer.phoneNumber,
        localCustomer.password,
        localCustomer.authProvider || 'phone',
        localCustomer.profilePictureUrl,
        localCustomer.isVerified ? 1 : 0,
        localCustomer.homeAddress,
        localCustomer.workAddress,
        localCustomer.lastLocation ? JSON.stringify(localCustomer.lastLocation) : null,
        localCustomer.latitude,
        localCustomer.longitude,
        localCustomer.status,
        localCustomer.createdAt || new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      ]);
    }
    
    console.log(`✅ Customer ${customerId} synced to cloud successfully`);
    return true;
    
  } catch (error) {
    console.error('❌ Failed to sync customer to cloud:', error);
    return false;
  }
};

export const syncCustomersBeforeCheck = async (): Promise<void> => {
  try {
    console.log('🔄 Syncing customers from cloud before check...');
    
    const customersResult = await executeTursoQuery('SELECT * FROM customers');
    const customers = customersResult[0]?.results?.rows || [];

    // Clear local customers table
    await db.delete(customersTable).execute();
    
    if (customers.length > 0) {
      const cols = customersResult[0].results.columns;
      
      // Insert using drizzle
      for (const row of customers) {
        const customerData: any = {};
        cols.forEach((col: string, index: number) => {
          customerData[col] = row[index];
        });
        
        await db.insert(customersTable).values(customerData).execute();
      }
      
      console.log(`✅ Synced ${customers.length} customers from cloud`);
    } else {
      console.log("⚠️ No customers in cloud database");
    }
    
  } catch (error) {
    console.error('❌ Error syncing customers:', error);
  }
};

/**
 * Check if a user exists in the cloud database
 */
export const checkUserInCloud = async (username: string, phoneNumber: string): Promise<boolean> => {
  try {
    console.log('🔍 Checking cloud for user:', { username, phoneNumber });
    
    const query = `
      SELECT COUNT(*) as count FROM customers 
      WHERE username = ? OR phone_number = ?
    `;
    
    const response = await executeTursoQuery(query, [username, phoneNumber]);
    
    if (response && response.length > 0 && response[0].results?.rows) {
      const rows = response[0].results.rows;
      if (rows.length > 0) {
        const count = rows[0][0];
        const userExists = count > 0;
        console.log(`🔍 Cloud check result: ${userExists ? 'User exists' : 'User does not exist'}`);
        return userExists;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking cloud database:', error);
    return false;
  }
};

/**
 * Check if a user exists by email in the cloud database (for Google Sign-Up)
 */
export const checkUserByEmailInCloud = async (email: string): Promise<boolean> => {
  try {
    console.log('🔍 Checking cloud for user by email:', { email });
    
    const query = `
      SELECT COUNT(*) as count FROM customers 
      WHERE email = ?
    `;
    
    const response = await executeTursoQuery(query, [email]);
    
    if (response && response.length > 0 && response[0].results?.rows) {
      const rows = response[0].results.rows;
      if (rows.length > 0) {
        const count = rows[0][0];
        const userExists = count > 0;
        console.log(`🔍 Cloud email check result: ${userExists ? 'User exists' : 'User does not exist'}`);
        return userExists;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking cloud database for email:', error);
    return false;
  }
};

/**
 * Clear local database tables
 */
export const clearLocalDatabase = async (): Promise<void> => {
  try {
    console.log('🗑️ Clearing local database...');
    
    // Clear customers table
    await db.delete(customersTable).execute();
    
    // Clear OTP table
    await db.delete(otpTable).execute();
    
    console.log('✅ Local database cleared');
  } catch (error) {
    console.error('❌ Error clearing local database:', error);
    throw error;
  }
};

/**
 * Check for existing user - Production version
 * Checks both local and cloud databases
 */
export const checkForExistingUser = async (username: string, phoneNumber: string): Promise<boolean> => {
  try {
    console.log('🔍 Checking for existing user:', { 
      username: username.trim(), 
      phoneNumber 
    });
    
    // 1. Check CLOUD database FIRST (source of truth)
    const cloudExists = await checkUserInCloud(username.trim(), phoneNumber);
    
    if (cloudExists) {
      console.log('❌ User exists in cloud database');
      return true;
    }

    // 2. Check local database (secondary check)
    try {
      const localResult = await db
        .select()
        .from(customersTable)
        .where(
          or(
            eq(customersTable.username, username.trim()),
            eq(customersTable.phoneNumber, phoneNumber)
          )
        )
        .limit(1);

      if (localResult.length > 0) {
        console.log('⚠️ User exists in local database but not in cloud - local data may be stale');
        // Clear stale data
        await db
          .delete(customersTable)
          .where(
            or(
              eq(customersTable.username, username.trim()),
              eq(customersTable.phoneNumber, phoneNumber)
            )
          );
        console.log('🗑️ Cleared stale local data');
        return false;
      }
    } catch (localError) {
      console.log('⚠️ Local check failed, table might not exist yet:', localError);
    }

    console.log('✅ No existing user found');
    return false;
    
  } catch (error) {
    console.error('Error checking for existing user:', error);
    return false;
  }
};

/**
 * Check if user exists by email (for Google Sign-Up)
 */
export const checkForExistingUserByEmail = async (email: string): Promise<boolean> => {
  try {
    console.log('🔍 Checking for existing user by email:', { email });
    
    // 1. Check cloud database
    const cloudExists = await checkUserByEmailInCloud(email);
    
    if (cloudExists) {
      console.log('❌ User exists in cloud database by email');
      return true;
    }

    // 2. Check local database
    try {
      const localResult = await db
        .select()
        .from(customersTable)
        .where(eq(customersTable.email, email))
        .limit(1);

      if (localResult.length > 0) {
        console.log('⚠️ User exists in local database by email but not in cloud');
        // Clear stale data
        await db
          .delete(customersTable)
          .where(eq(customersTable.email, email));
        console.log('🗑️ Cleared stale local data by email');
        return false;
      }
    } catch (localError) {
      console.log('⚠️ Local email check failed:', localError);
    }

    console.log('✅ No existing user found by email');
    return false;
    
  } catch (error) {
    console.error('Error checking for existing user by email:', error);
    return false;
  }
};

/**
 * Insert user into cloud database - UPDATED for Google Sign-Up
 */
export const insertUserToCloud = async (
  username: string, 
  phoneNumber: string | null, 
  hashedPassword: string | null,
  email: string | null = null,
  googleId: string | null = null,
  profilePictureUrl: string | null = null,
  authProvider: string = 'phone'
): Promise<boolean> => {
  try {
    console.log('☁️ Inserting user to cloud...', { 
      username, 
      phoneNumber, 
      hasEmail: !!email,
      authProvider 
    });
    
    const query = `
      INSERT INTO customers (
        username, 
        phone_number, 
        password, 
        email, 
        google_id, 
        profile_picture_url, 
        auth_provider,
        is_verified, 
        status, 
        created_at, 
        updated_at,
        last_login
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
      username,
      phoneNumber,
      hashedPassword,
      email,
      googleId,
      profilePictureUrl,
      authProvider,
      authProvider === 'google' ? 1 : 1,
      'active',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString()
    ];
    
    await executeTursoQuery(query, params);
    
    console.log('✅ User inserted to cloud successfully');
    return true;
  } catch (error) {
    console.error('❌ Error inserting user to cloud:', error);
    return false;
  }
};

/**
 * Insert Google user into cloud database (simplified version)
 */
export const insertGoogleUserToCloud = async (
  username: string,
  email: string,
  googleId: string,
  profilePictureUrl: string | null = null
): Promise<boolean> => {
  return insertUserToCloud(
    username,
    null,
    null,
    email,
    googleId,
    profilePictureUrl,
    'google'
  );
};

/**
 * Push data to Turso (generic)
 */
export const pushToTurso = async (sql: string, params: any[] = []): Promise<void> => {
  try {
    await executeTursoQuery(sql, params);
    console.log('✅ Data pushed to Turso');
  } catch (error) {
    console.error('❌ Push to Turso failed:', error);
    throw error;
  }
};

/**
 * RESET AND REBUILD DATABASE - Fixes missing columns
 */
export const resetAndRebuildDatabase = async (): Promise<void> => {
  try {
    console.log('🔄 RESETTING ENTIRE DATABASE...');
    
    // Drop ALL tables (clean slate)
    const dropTables = [
      'DROP TABLE IF EXISTS admins;',
      'DROP TABLE IF EXISTS customers;',
      'DROP TABLE IF EXISTS drivers;',
      'DROP TABLE IF EXISTS delivery_requests;',
      'DROP TABLE IF EXISTS driver_responses;',
      'DROP TABLE IF EXISTS driver_transactions;',
      'DROP TABLE IF EXISTS otps;',
      'DROP TABLE IF EXISTS messages;',
      'DROP TABLE IF EXISTS driver_commission_deductions;',
      'DROP TABLE IF EXISTS platform_earnings;',
      'DROP TABLE IF EXISTS driver_ratings;',
      'DROP TABLE IF EXISTS payment_references;',
      'DROP TABLE IF EXISTS admin_wallet_adjustments;',
    ];
    
    for (const dropStatement of dropTables) {
      try {
        await expoDb.execAsync(dropStatement);
      } catch (e) {
        // Ignore errors for tables that might not exist
      }
    }
    
    console.log('✅ All tables dropped');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Call initializeDatabase to recreate with correct schema
    await initializeDatabase();
    
    console.log('✅ Database completely reset and rebuilt with correct schema');
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    throw error;
  }
};

/**
 * Check if email column exists
 */
export const checkEmailColumn = async (): Promise<boolean> => {
  try {
    const result = await expoDb.getAllAsync("PRAGMA table_info(customers)");
    const hasEmail = result.some((col: any) => col.name === 'email');
    console.log(`🔍 Email column exists: ${hasEmail}`);
    console.log('📊 All columns:', result.map((col: any) => col.name));
    return hasEmail;
  } catch (error) {
    console.error('❌ Error checking email column:', error);
    return false;
  }
};

/**
 * Fix existing database schema - Add missing columns for ALL tables
 */
export const fixDatabaseSchema = async (): Promise<void> => {
  try {
    console.log('🔧 Fixing database schema...');
    
    // FIRST: Fix the phone_number constraint for customers
    await fixPhoneNumberConstraint();
    
    // SECOND: Fix drivers table schema
    await fixDriversSchema();
    
    // Check customers table exists and add missing columns
    try {
      const tableInfo = await expoDb.getAllAsync("PRAGMA table_info(customers)");
      
      interface TableColumnInfo {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }
      
      const typedTableInfo = tableInfo as TableColumnInfo[];
      console.log('📊 Current customers columns:', typedTableInfo.map(col => col.name));
      
      // Add missing columns for customers table
      const columnsToAdd = [
        { name: 'email', type: 'TEXT' },
        { name: 'google_id', type: 'TEXT' },
        { name: 'profile_picture_url', type: 'TEXT' },
        { name: 'auth_provider', type: 'TEXT DEFAULT "phone"' }
      ];
      
      for (const column of columnsToAdd) {
        const exists = typedTableInfo.some(col => col.name === column.name);
        if (!exists) {
          console.log(`📝 Adding ${column.name} column to customers table...`);
          try {
            await expoDb.execAsync(`ALTER TABLE customers ADD COLUMN ${column.name} ${column.type};`);
            console.log(`✅ Added ${column.name} column to customers table`);
          } catch (alterError) {
            console.warn(`⚠️ Could not add ${column.name} to customers table:`, alterError);
          }
        }
      }
      
    } catch (tableError) {
      console.log('⚠️ Customers table does not exist, creating it...');
      // Table doesn't exist, create it with all columns
      await expoDb.execAsync(`
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          username TEXT UNIQUE NOT NULL,
          email TEXT,
          google_id TEXT,
          phone_number TEXT,
          password TEXT,
          auth_provider TEXT DEFAULT 'phone',
          profile_picture_url TEXT,
          is_verified INTEGER DEFAULT 0 NOT NULL,
          last_login TEXT DEFAULT CURRENT_TIMESTAMP,
          home_address TEXT,
          work_address TEXT,
          last_location TEXT,
          latitude REAL,
          longitude REAL,
          status TEXT DEFAULT 'active' NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);
      console.log('✅ Created customers table with all columns');
    }
    
    console.log('✅ Database schema fixed');
  } catch (error) {
    console.error('❌ Error fixing database schema:', error);
  }
};

/**
 * Check if database is ready (simple version)
 */
export const isDatabaseReady = async (): Promise<boolean> => {
  try {
    await expoDb.getAllAsync("SELECT 1 FROM customers LIMIT 1");
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Complete database initialization that creates ALL tables with correct schema
 */
export const initializeDatabase = async (): Promise<boolean> => {
  try {
    console.log("🔧 Initializing database...");
    
    // First, check if database is accessible
    try {
      await expoDb.execAsync("CREATE TABLE IF NOT EXISTS test_db_init (id INTEGER);");
      await expoDb.execAsync("DROP TABLE IF EXISTS test_db_init;");
      console.log("✅ Database is accessible");
    } catch (dbError) {
      console.error("❌ Database not accessible:", dbError);
      return false;
    }
    
    // ========== CREATE CUSTOMERS TABLE FIRST ==========
    const createCustomersTable = `
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        google_id TEXT,
        phone_number TEXT,
        password TEXT,
        auth_provider TEXT DEFAULT 'phone',
        profile_picture_url TEXT,
        is_verified INTEGER DEFAULT 0 NOT NULL,
        last_login TEXT DEFAULT CURRENT_TIMESTAMP,
        home_address TEXT,
        work_address TEXT,
        last_location TEXT,
        latitude REAL,
        longitude REAL,
        status TEXT DEFAULT 'active' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;
    
    await expoDb.execAsync(createCustomersTable);
    console.log("✅ Customers table created/verified");
    
    // ========== CREATE OTP TABLE ==========
    const createOtpTable = `
      CREATE TABLE IF NOT EXISTS otps (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        phone_number TEXT NOT NULL,
        code TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expires_at TEXT NOT NULL
      );
    `;
    
    await expoDb.execAsync(createOtpTable);
    console.log("✅ OTP table created/verified");
    
    // ========== CREATE DRIVERS TABLE WITH ALL COLUMNS ==========
    const createDriversTable = `
      CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        phone_number TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        profile_picture_url TEXT,
        balance INTEGER DEFAULT 0 NOT NULL,
        license_front_url TEXT,
        license_back_url TEXT,
        registration_front_url TEXT,
        registration_back_url TEXT,
        national_id_front_url TEXT,
        national_id_back_url TEXT,
        vehicle_front_url TEXT,
        vehicle_back_url TEXT,
        vehicle_type TEXT NOT NULL,
        car_name TEXT NOT NULL,
        number_plate TEXT NOT NULL,
        license_expiry TEXT NOT NULL,
        registration_expiry TEXT NOT NULL,
        is_online INTEGER DEFAULT 0 NOT NULL,
        last_location TEXT,
        latitude REAL,
        longitude REAL,
        last_online TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `;
    
    await expoDb.execAsync(createDriversTable);
    console.log("✅ Drivers table created/verified");
    
    // ========== CREATE DELIVERY REQUESTS TABLE ==========
    const createDeliveryRequestsTable = `
      CREATE TABLE IF NOT EXISTS delivery_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        customer_id INTEGER NOT NULL,
        customer_username TEXT NOT NULL,
        pickup_location TEXT,
        dropoff_location TEXT,
        pickup_address TEXT,
        pickup_latitude REAL,
        pickup_longitude REAL,
        dropoff_address TEXT,
        dropoff_latitude REAL,
        dropoff_longitude REAL,
        fare REAL NOT NULL,
        distance REAL NOT NULL,
        vehicle_type TEXT NOT NULL DEFAULT 'car',
        package_details TEXT,
        recipient_phone_number TEXT,
        status TEXT DEFAULT 'pending' NOT NULL,
        assigned_driver_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expires_at TEXT NOT NULL,
        driver_arrived_at TEXT,
        delivery_completed_at TEXT,
        delivery_photo_url TEXT,
        commission_taken INTEGER DEFAULT 0,
        commission_amount REAL DEFAULT 0,
        customer_confirmed_at TEXT,
        auto_confirmed_at TEXT,
        delivery_status TEXT DEFAULT 'pending' NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_driver_id) REFERENCES drivers(id)
      );
    `;
    
    await expoDb.execAsync(createDeliveryRequestsTable);
    console.log("✅ Delivery requests table created/verified");
    
    // ========== CREATE OTHER ESSENTIAL TABLES ==========
    const createOtherTables = `
      CREATE TABLE IF NOT EXISTS driver_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        request_id INTEGER NOT NULL,
        driver_id INTEGER NOT NULL,
        response TEXT NOT NULL,
        responded_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (request_id) REFERENCES delivery_requests(id) ON DELETE CASCADE,
        FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS driver_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        driver_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        payment_intent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        delivery_id INTEGER NOT NULL,
        sender_type TEXT NOT NULL,
        sender_id INTEGER NOT NULL,
        message_type TEXT DEFAULT 'text' NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        metadata TEXT,
        is_read INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (delivery_id) REFERENCES delivery_requests(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS driver_commission_deductions (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        driver_id INTEGER NOT NULL,
        delivery_id INTEGER NOT NULL,
        fare_amount REAL NOT NULL,
        commission_percentage REAL DEFAULT 0.135 NOT NULL,
        commission_amount REAL NOT NULL,
        driver_balance_before INTEGER NOT NULL,
        driver_balance_after INTEGER NOT NULL,
        status TEXT DEFAULT 'completed' NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
        FOREIGN KEY (delivery_id) REFERENCES delivery_requests(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS platform_earnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        delivery_id INTEGER NOT NULL,
        commission_amount REAL NOT NULL,
        driver_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (delivery_id) REFERENCES delivery_requests(id) ON DELETE CASCADE,
        FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );
    `;
    
    await expoDb.execAsync(createOtherTables);
    console.log("✅ Other essential tables created/verified");
    
    // Verify all tables were created
    try {
      const tables = await expoDb.getAllAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
      );
      console.log("📊 All tables in database:", tables.map((t: any) => t.name));
    } catch (tableError) {
      console.log("⚠️ Could not list tables:", tableError);
    }
    
    console.log("✅ Database initialization completed successfully");
    return true;
    
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
    
    // Try a simplified fallback
    try {
      console.log("🔄 Attempting simplified fallback setup...");
      
      // Create only the absolutely essential tables
      await expoDb.execAsync(`
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          username TEXT UNIQUE NOT NULL,
          email TEXT,
          google_id TEXT,
          phone_number TEXT,
          password TEXT,
          auth_provider TEXT DEFAULT 'phone',
          is_verified INTEGER DEFAULT 0 NOT NULL,
          status TEXT DEFAULT 'active' NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        );
      `);
      
      await expoDb.execAsync(`
        CREATE TABLE IF NOT EXISTS otps (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          phone_number TEXT NOT NULL,
          code TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);
      
      console.log("✅ Created simplified essential tables");
      return true;
    } catch (fallbackError) {
      console.error("❌ Fallback setup also failed:", fallbackError);
      return false;
    }
  }
};

/**
 * Sync function: Pull data from Turso and update local database
 */
export const syncDb = async () => {
  try {
    console.log("🔄 Starting database sync with Turso...");

    // FIRST: Ensure all tables exist with correct schema
    console.log("🔄 Ensuring all tables exist with correct schema...");
    await fixDatabaseSchema(); // This will fix any missing columns
    
    // 1. FETCH ALL CUSTOMERS FROM TURSO
    const customersResult = await executeTursoQuery('SELECT * FROM customers');
    const customers = customersResult[0]?.results?.rows || [];

    if (customers.length > 0) {
      // Clear local customers table
      await expoDb.execAsync('DELETE FROM customers;');
      
      const cols = customersResult[0].results.columns;
      console.log("📊 Cloud customers columns:", cols);
      
      // Get local customers columns
      const localCustomersInfo = await expoDb.getAllAsync("PRAGMA table_info(customers)");
      const localCustomerColumns = localCustomersInfo.map((col: any) => col.name);
      console.log("📊 Local customers columns:", localCustomerColumns);
      
      // Insert using raw SQL with column validation
      for (const row of customers) {
        const rowData: Record<string, any> = {};
        cols.forEach((col: string, index: number) => {
          rowData[col] = row[index];
        });
        
        // Filter to only include columns that exist locally
        const validCols = cols.filter((col: string) => localCustomerColumns.includes(col));
        const validValues = validCols.map((col: string) => {
          const value = rowData[col];
          if (value === null) return 'NULL';
          if (typeof value === 'number') return value;
          return `'${String(value).replace(/'/g, "''")}'`;
        });
        
        if (validCols.length > 0) {
          const insertSQL = `INSERT INTO customers (${validCols.join(', ')}) VALUES (${validValues.join(', ')});`;
          await expoDb.execAsync(insertSQL);
        }
      }
      
      console.log(`✅ Synced ${customers.length} customers from Turso`);
    } else {
      console.log("⚠️ No customers found in Turso database");
    }

    // 2. Fetch all drivers from Turso
    const driversResult = await executeTursoQuery('SELECT * FROM drivers');
    const drivers = driversResult[0]?.results?.rows || [];

    if (drivers.length > 0) {
      // Clear local drivers table
      await expoDb.execAsync('DELETE FROM drivers;');
      
      const cols = driversResult[0].results.columns;
      console.log("📊 Cloud drivers columns:", cols);
      
      // Get local drivers columns
      const localDriversInfo = await expoDb.getAllAsync("PRAGMA table_info(drivers)");
      const localDriverColumns = localDriversInfo.map((col: any) => col.name);
      console.log("📊 Local drivers columns:", localDriverColumns);
      
      // Insert using raw SQL with column validation
      for (const row of drivers) {
        const rowData: Record<string, any> = {};
        cols.forEach((col: string, index: number) => {
          rowData[col] = row[index];
        });
        
        // Filter to only include columns that exist locally
        const validCols = cols.filter((col: string) => localDriverColumns.includes(col));
        const validValues = validCols.map((col: string) => {
          const value = rowData[col];
          if (value === null) return 'NULL';
          if (typeof value === 'number') return value;
          return `'${String(value).replace(/'/g, "''")}'`;
        });
        
        if (validCols.length > 0) {
          const insertSQL = `INSERT INTO drivers (${validCols.join(', ')}) VALUES (${validValues.join(', ')});`;
          await expoDb.execAsync(insertSQL);
        }
      }
      
      console.log(`✅ Synced ${drivers.length} drivers from Turso`);
    } else {
      console.log("⚠️ No drivers found in Turso database");
    }

    // 3. Sync delivery requests
    const requestsResult = await executeTursoQuery('SELECT * FROM delivery_requests');
    const requests = requestsResult[0]?.results?.rows || [];
    
    if (requests.length > 0) {
      // Clear local delivery_requests table
      await expoDb.execAsync('DELETE FROM delivery_requests;');
      
      const requestCols = requestsResult[0].results.columns;
      console.log("📊 Cloud delivery_requests columns:", requestCols);
      
      // Get local delivery_requests columns
      const localRequestsInfo = await expoDb.getAllAsync("PRAGMA table_info(delivery_requests)");
      const localRequestColumns = localRequestsInfo.map((col: any) => col.name);
      console.log("📊 Local delivery_requests columns:", localRequestColumns);
      
      for (const row of requests) {
        const rowData: Record<string, any> = {};
        requestCols.forEach((col: string, index: number) => {
          rowData[col] = row[index];
        });
        
        // Filter to only include columns that exist locally
        const validCols = requestCols.filter((col: string) => localRequestColumns.includes(col));
        const validValues = validCols.map((col: string) => {
          const value = rowData[col];
          if (value === null) return 'NULL';
          if (typeof value === 'number') return value;
          return `'${String(value).replace(/'/g, "''")}'`;
        });
        
        if (validCols.length > 0) {
          const insertSQL = `INSERT INTO delivery_requests (${validCols.join(', ')}) VALUES (${validValues.join(', ')});`;
          await expoDb.execAsync(insertSQL);
        }
      }
      
      console.log(`✅ Synced ${requests.length} delivery requests from Turso`);
    }

    console.log("✅ Database sync completed successfully");
  } catch (error) {
    console.error("❌ Sync error:", error);
    throw error;
  }
};

/**
 * Initialize customer data - call this after customer login
 */
export const initializeCustomerData = async (customerId: number) => {
  try {
    console.log(`👤 Initializing data for customer ID: ${customerId}`);
    
    // Ensure schema is correct
    await fixDatabaseSchema();
    
    // Get this specific customer from Turso
    const customerResult = await executeTursoQuery(
      'SELECT * FROM customers WHERE id = ?',
      [customerId]
    );
    
    const customer = customerResult[0]?.results?.rows[0];
    
    if (customer) {
      // Clear existing and insert this customer
      await expoDb.execAsync('DELETE FROM customers;');
      const cols = customerResult[0].results.columns;
      
      // Get local columns
      const localTableInfo = await expoDb.getAllAsync("PRAGMA table_info(customers)");
      const localColumns = localTableInfo.map((col: any) => col.name);
      
      // Filter to only include columns that exist locally
      const validCols = cols.filter((col: string) => localColumns.includes(col));
      const values = validCols.map((col: string) => {
        const index = cols.indexOf(col);
        const value = customer[index];
        if (value === null) return 'NULL';
        if (typeof value === 'number') return value;
        return `'${String(value).replace(/'/g, "''")}'`;
      }).join(', ');
      
      const insertSQL = `INSERT INTO customers (${validCols.join(', ')}) VALUES (${values});`;
      await expoDb.execAsync(insertSQL);
      console.log(`✅ Customer ${customerId} synced to local database`);
    }
    
    // Get this customer's delivery requests
    const requestsResult = await executeTursoQuery(
      'SELECT * FROM delivery_requests WHERE customer_id = ? ORDER BY created_at DESC',
      [customerId]
    );
    
    const requests = requestsResult[0]?.results?.rows || [];
    
    if (requests.length > 0) {
      await expoDb.execAsync('DELETE FROM delivery_requests;');
      const requestCols = requestsResult[0].results.columns;
      
      // Get local delivery_requests columns
      const localRequestsInfo = await expoDb.getAllAsync("PRAGMA table_info(delivery_requests)");
      const localRequestColumns = localRequestsInfo.map((col: any) => col.name);
      
      for (const row of requests) {
        const rowData: Record<string, any> = {};
        requestCols.forEach((col: string, index: number) => {
          rowData[col] = row[index];
        });
        
        // Filter to only include columns that exist locally
        const validCols = requestCols.filter((col: string) => localRequestColumns.includes(col));
        const validValues = validCols.map((col: string) => {
          const value = rowData[col];
          if (value === null) return 'NULL';
          if (typeof value === 'number') return value;
          return `'${String(value).replace(/'/g, "''")}'`;
        });
        
        if (validCols.length > 0) {
          const insertSQL = `INSERT INTO delivery_requests (${validCols.join(', ')}) VALUES (${validValues.join(', ')});`;
          await expoDb.execAsync(insertSQL);
        }
      }
      
      console.log(`✅ Synced ${requests.length} delivery requests for customer ${customerId}`);
    }
    
  } catch (error) {
    console.error("❌ Error initializing customer data:", error);
    throw error;
  }
};

/**
 * Force sync for active deliveries (for chat functionality)
 */
export const syncActiveDelivery = async (deliveryId: number) => {
  try {
    console.log(`📦 Syncing active delivery: ${deliveryId}`);
    
    const deliveryResult = await executeTursoQuery(
      `SELECT dr.*, 
              (SELECT json_group_array(json_object('id', m.id, 'content', m.content, 'sender_type', m.sender_type, 
                'sender_id', m.sender_id, 'message_type', m.message_type, 'image_url', m.image_url, 
                'is_read', m.is_read, 'created_at', m.created_at))
               FROM messages m WHERE m.delivery_id = dr.id) as messages
       FROM delivery_requests dr 
       WHERE dr.id = ?`,
      [deliveryId]
    );
    
    const delivery = deliveryResult[0]?.results?.rows[0];
    
    if (delivery) {
      const deliveryCols = deliveryResult[0].results.columns.filter((col: string) => col !== 'messages');
      const deliveryValues = delivery.slice(0, deliveryCols.length).map((v: any) => {
        if (v === null) return 'NULL';
        if (typeof v === 'number') return v;
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(', ');
      
      // Delete and reinsert this delivery
      await expoDb.execAsync(`DELETE FROM delivery_requests WHERE id = ${deliveryId};`);
      const insertSQL = `INSERT INTO delivery_requests (${deliveryCols.join(', ')}) VALUES (${deliveryValues});`;
      await expoDb.execAsync(insertSQL);
      
      // Parse and insert messages
      const messagesJson = delivery[deliveryCols.length];
      if (messagesJson && messagesJson !== 'null') {
        try {
          const messages = JSON.parse(messagesJson);
          await expoDb.execAsync(`DELETE FROM messages WHERE delivery_id = ${deliveryId};`);
          
          for (const msg of messages) {
            await expoDb.execAsync(`
              INSERT INTO messages (delivery_id, sender_type, sender_id, message_type, content, image_url, is_read, created_at)
              VALUES (${deliveryId}, '${msg.sender_type}', ${msg.sender_id}, '${msg.message_type}', 
                     '${msg.content.replace(/'/g, "''")}', 
                     ${msg.image_url ? `'${msg.image_url.replace(/'/g, "''")}'` : 'NULL'}, 
                     ${msg.is_read ? 1 : 0}, '${msg.created_at}')
            `);
          }
          
          console.log(`✅ Synced ${messages.length} messages for delivery ${deliveryId}`);
        } catch (e) {
          console.warn("⚠️ Could not parse messages:", e);
        }
      }
      
      console.log(`✅ Delivery ${deliveryId} synced successfully`);
    }
    
  } catch (error) {
    console.error("❌ Error syncing active delivery:", error);
  }
};

/**
 * Quick sync for driver - loads only essential data
 */
export const quickSyncForDriver = async (driverId: number) => {
  try {
    console.log(`🚗 Quick sync for driver ${driverId}`);
    
    // Sync this driver's data
    const driverResult = await executeTursoQuery(
      'SELECT * FROM drivers WHERE id = ?',
      [driverId]
    );
    
    const driver = driverResult[0]?.results?.rows[0];
    
    if (driver) {
      await expoDb.execAsync('DELETE FROM drivers;');
      const cols = driverResult[0].results.columns;
      
      const values = driver.map((v: any) => {
        if (v === null) return 'NULL';
        if (typeof v === 'number') return v;
        return `'${String(v).replace(/'/g, "''")}'`;
      }).join(', ');
      
      const insertSQL = `INSERT INTO drivers (${cols.join(', ')}) VALUES (${values});`;
      await expoDb.execAsync(insertSQL);
      console.log(`✅ Driver ${driverId} synced`);
    }
    
    // Sync active delivery for this driver
    const activeDeliveryResult = await executeTursoQuery(
      `SELECT * FROM delivery_requests 
       WHERE assigned_driver_id = ? 
       AND status IN ('accepted', 'in_progress', 'arrived', 'picked_up')
       ORDER BY created_at DESC LIMIT 1`,
      [driverId]
    );
    
    const activeDelivery = activeDeliveryResult[0]?.results?.rows[0];
    
    if (activeDelivery) {
      await syncActiveDelivery(activeDelivery.id);
    }
    
    console.log(`✅ Quick sync completed for driver ${driverId}`);
    
  } catch (error) {
    console.error("❌ Quick sync error:", error);
  }
};
