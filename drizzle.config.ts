// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'turso',
  dbCredentials: {
    // Use the sync URL (remove the libsql:// prefix and add https://)
    url: process.env.EXPO_PUBLIC_TURSO_SYNC_URL!.replace('libsql://', 'https://'),
    authToken: process.env.EXPO_PUBLIC_TURSO_AUTH_TOKEN!,
  },
});

// Note: This config is for running drizzle-kit commands from your terminal
// to push schema changes to Turso. It doesn't run in your React Native app.