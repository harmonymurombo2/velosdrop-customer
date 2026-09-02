// lib/uploadCustomerProfilePicture.ts
export const uploadCustomerProfilePicture = async (
  imageUri: string,
  customerId: number
): Promise<string> => {
  try {
    console.log('📤 Starting CUSTOMER profile picture upload...', { customerId });

    // 1. Get Cloudinary configuration
    const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

    // 2. Validate configuration
    if (!cloudName || !uploadPreset) {
      throw new Error('Cloudinary configuration is missing. Check your .env file.');
    }

    // 3. Get file information
    const filename = imageUri.split('/').pop() || 'customer_profile.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const fileExtension = match ? match[1].toLowerCase() : 'jpg';
    const mimeType = `image/${fileExtension}`;

    // 4. Create FormData (React Native format)
    const formData = new FormData();
    
    // Append file in React Native format
    formData.append('file', {
      uri: imageUri,
      type: mimeType,
      name: `customer_${customerId}_profile_${Date.now()}.${fileExtension}`,
    } as any);

    // 5. Add upload preset and tags
    formData.append('upload_preset', uploadPreset);
    formData.append('tags', `customer_${customerId},profile_picture`);
    formData.append('context', `customer=${customerId}|type=profile_picture`);

    // 6. Create upload URL
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    
    console.log('🚀 Uploading customer picture to Cloudinary:', uploadUrl);

    // 7. Send request
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    // 8. Check response
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Customer profile upload failed:', response.status, errorText);
      
      let errorMessage = `Profile upload failed (${response.status})`;
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Not JSON, use raw text
      }
      
      throw new Error(errorMessage);
    }

    // 9. Parse response
    const data = await response.json();
    
    if (!data.secure_url) {
      console.error('❌ No secure_url in response:', data);
      throw new Error('Cloudinary did not return a profile image URL');
    }
    
    // 10. Apply transformation for consistent sizing
    const transformedUrl = data.secure_url.replace(
      '/upload/', 
      '/upload/c_fill,g_face,w_400,h_400/'
    );
    
    console.log('✅ Customer profile picture uploaded successfully!');
    console.log('📦 Transformed URL:', transformedUrl);
    
    // 11. DO NOT call the API - Turso update happens in UserContext
    console.log('✅ Profile uploaded to Cloudinary. Database update handled by UserContext.');
    
    return transformedUrl;
    
  } catch (error: any) {
    console.error('❌ Customer profile upload error:', error.message);
    
    if (error.message.includes('Network request failed')) {
      throw new Error('Network error. Check your internet connection.');
    }
    
    throw error;
  }
};

// REMOVE the entire syncCustomerProfileToDatabase function!