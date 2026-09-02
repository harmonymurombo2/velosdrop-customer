// src/services/google-auth.service.ts
import {
  GoogleSignin,
  statusCodes,
  type User,
} from '@react-native-google-signin/google-signin';

// Configure Google Sign-In
GoogleSignin.configure({
  // Your web client ID from Google Cloud Console
  webClientId: '197377244964-402g6igdhcppjm0ro4v1l4hteo3b5jvm.apps.googleusercontent.com',
  offlineAccess: true,
  forceCodeForRefreshToken: false,
  scopes: ['email', 'profile'],
});

export interface GoogleUserData {
  id: string;
  email: string;
  name: string;
  givenName?: string;
  familyName?: string;
  photo?: string;
  idToken: string;
  serverAuthCode?: string;
}

// Type for the actual response structure
interface GoogleSignInResponse {
  user: User & {
    name?: string;
    photo?: string;
    givenName?: string;
    familyName?: string;
  };
  serverAuthCode?: string;
  idToken?: string;
  scopes?: string[];
}

export const googleAuthService = {
  async signIn(): Promise<GoogleUserData | null> {
    try {
      console.log('🔐 Starting Google Sign-In...');

      // 1. Check for Google Play Services
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      console.log('✅ Google Play Services available');

      // 2. Sign out first to clear any cached credentials
      try {
        await GoogleSignin.signOut();
      } catch (e) {
        // Ignore sign out errors
      }

      // 3. Perform the sign-in
      console.log('🔑 Attempting Google Sign-In...');
      const signInResult = await GoogleSignin.signIn();
      console.log('✅ Google Sign-In UI completed');

      if (!signInResult) {
        throw new Error('No sign-in data received');
      }

      // 4. Get the ID token and other details
      console.log('🔐 Getting tokens...');
      const tokens = await GoogleSignin.getTokens();

      if (!tokens.idToken) {
        throw new Error('No ID token received');
      }

      // 5. DEBUG: Log the complete response structure
      console.log('🔍 Google Sign-In Response Type:', typeof signInResult);
      console.log('🔍 Google Sign-In Response Keys:', Object.keys(signInResult as any));
      
      // 6. Extract user data using proper type casting
      const response = signInResult as any;
      
      // Check different possible response structures
      let email = '';
      let id = '';
      let name = '';
      let givenName = '';
      let familyName = '';
      let photo = '';
      let serverAuthCode = '';

      // Method 1: Check if response has user property
      if (response.user && response.user.email) {
        const user = response.user;
        email = user.email;
        id = user.id || '';
        name = user.name || '';
        givenName = user.givenName || '';
        familyName = user.familyName || '';
        photo = user.photo || '';
        serverAuthCode = response.serverAuthCode || '';
      }
      // Method 2: Check if response itself has email (direct properties)
      else if (response.email) {
        email = response.email;
        id = response.id || response.userId || '';
        name = response.name || response.displayName || '';
        givenName = response.givenName || response.firstName || '';
        familyName = response.familyName || response.lastName || '';
        photo = response.photo || response.imageUrl || '';
        serverAuthCode = response.serverAuthCode || '';
      }
      // Method 3: Check if response has data property
      else if (response.data && response.data.user) {
        const user = response.data.user;
        email = user.email || '';
        id = user.id || '';
        name = user.name || '';
        givenName = user.givenName || '';
        familyName = user.familyName || '';
        photo = user.photo || '';
        serverAuthCode = response.data.serverAuthCode || '';
      }

      console.log('🔍 Extracted email:', email);
      console.log('🔍 Extracted id:', id);
      console.log('🔍 Response structure:', JSON.stringify(response, null, 2).substring(0, 500) + '...');

      if (!email) {
        console.error('❌ No email found in response.');
        console.error('❌ Full response:', JSON.stringify(response, null, 2));
        throw new Error('Invalid user data received - no email found');
      }

      // 7. Return the formatted user data
      const user: GoogleUserData = {
        id: id || `google-${Date.now()}`,
        email: email,
        name: name || email.split('@')[0],
        givenName: givenName || undefined,
        familyName: familyName || undefined,
        photo: photo || undefined,
        idToken: tokens.idToken,
        serverAuthCode: serverAuthCode || undefined,
      };

      console.log('✅ Google Sign-In successful for:', user.email);
      console.log('✅ User data:', { id: user.id, name: user.name, email: user.email });
      return user;
    } catch (error: any) {
      console.error('❌ Google Sign-In Error:', error);

      // Handle specific error codes
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log('User cancelled Google Sign-In');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        console.log('Google Sign-In already in progress');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        console.log('Google Play Services not available or outdated');
      } else if (error.code === 'DEVELOPER_ERROR') {
        console.error('DEVELOPER_ERROR - Configuration issue');
      } else {
        console.error('Other Google Sign-In error:', error);
      }

      return null;
    }
  },

  async signOut(): Promise<void> {
    try {
      await GoogleSignin.signOut();
      console.log('✅ Google Sign-Out successful');
    } catch (error) {
      console.error('❌ Google Sign-Out Error:', error);
    }
  },

  async isSignedIn(): Promise<boolean> {
    try {
      const currentUser = await GoogleSignin.getCurrentUser();
      return !!currentUser;
    } catch (error) {
      console.error('Error checking Google sign-in status:', error);
      return false;
    }
  },

  async getCurrentUser(): Promise<GoogleUserData | null> {
    try {
      const currentUser = await GoogleSignin.getCurrentUser();
      if (!currentUser) {
        return null;
      }

      const tokens = await GoogleSignin.getTokens();
      if (!tokens.idToken) {
        return null;
      }

      // Extract data from currentUser
      const userData = currentUser as any;
      
      // Try to extract the data
      let email = '';
      let id = '';
      let name = '';
      let givenName = '';
      let familyName = '';
      let photo = '';
      let serverAuthCode = '';

      if (userData.user && userData.user.email) {
        const user = userData.user;
        email = user.email;
        id = user.id || '';
        name = user.name || '';
        givenName = user.givenName || '';
        familyName = user.familyName || '';
        photo = user.photo || '';
        serverAuthCode = userData.serverAuthCode || '';
      } else if (userData.email) {
        email = userData.email;
        id = userData.id || '';
        name = userData.name || '';
        givenName = userData.givenName || '';
        familyName = userData.familyName || '';
        photo = userData.photo || '';
        serverAuthCode = userData.serverAuthCode || '';
      }

      return {
        id: id || '',
        email: email || '',
        name: name || '',
        givenName: givenName || undefined,
        familyName: familyName || undefined,
        photo: photo || undefined,
        idToken: tokens.idToken,
        serverAuthCode: serverAuthCode || undefined,
      };
    } catch (error) {
      console.error('Error getting current Google user:', error);
      return null;
    }
  },

  async revokeAccess(): Promise<void> {
    try {
      await GoogleSignin.revokeAccess();
      console.log('✅ Google access revoked');
    } catch (error) {
      console.error('❌ Google revoke access error:', error);
    }
  },

  async getTokens(): Promise<{ idToken: string; accessToken: string } | null> {
    try {
      const tokens = await GoogleSignin.getTokens();
      return tokens;
    } catch (error) {
      console.error('Error getting Google tokens:', error);
      return null;
    }
  },
};
