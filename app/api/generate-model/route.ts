import { NextRequest, NextResponse } from 'next/server';
import type { GenerateModelRequest, GenerateModelResponse } from '@/types/3d-model';

// Disable caching for this dynamic route
export const dynamic = 'force-dynamic';

/**
 * POST /api/generate-model
 * 
 * Handles 3D model generation requests by forwarding them to NVIDIA Trellis API.
 * Validates input, authenticates with Bearer token, and returns model data or errors.
 * 
 * Requirements: 4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4
 */
export async function POST(request: NextRequest) {
  try {
    // Requirement 4.1: Authenticate using NVIDIA_API_KEY from environment
    const apiKey = process.env.NVIDIA_API_KEY;
    
    // Requirement 4.2: Return configuration error if API key is missing
    if (!apiKey || apiKey === 'your_nvidia_api_key_here') {
      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'NVIDIA API key is not configured. Please set NVIDIA_API_KEY in your environment variables.',
          },
        },
        { status: 500 }
      );
    }

    // Parse and validate request body
    let body: GenerateModelRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid JSON in request body',
          },
        },
        { status: 400 }
      );
    }

    // Validate request structure
    if (!body.type || !body.data) {
      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request must include "type" and "data" fields',
          },
        },
        { status: 400 }
      );
    }

    // Validate input type
    if (body.type !== 'image' && body.type !== 'text') {
      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT_TYPE',
            message: 'Input type must be "image" or "text".',
          },
        },
        { status: 400 }
      );
    }

    // Validate data is not empty
    if (!body.data.trim()) {
      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: {
            code: 'EMPTY_INPUT',
            message: 'Input data cannot be empty',
          },
        },
        { status: 400 }
      );
    }

    let trellisRequest: any;

    if (body.type === 'text') {
      trellisRequest = {
        prompt: body.data,
        mode: 'text',
        output_format: 'glb',
        slat_cfg_scale: 3,
        ss_cfg_scale: 7.5,
        slat_sampling_steps: 25,
        ss_sampling_steps: 25,
        seed: 0,
      };
    } else {
      let imageData = body.data;
      let imagePayload = imageData;

      // Handle correct prefixing for base64 images
      if (!imageData.startsWith('data:')) {
        let mimeType = 'image/png'; // default
        if (imageData.startsWith('/9j/')) {
          mimeType = 'image/jpeg';
        } else if (imageData.startsWith('iVBORw0KGgo')) {
          mimeType = 'image/png';
        } else if (imageData.startsWith('UklGR')) {
          mimeType = 'image/webp';
        }
        imagePayload = `data:${mimeType};base64,${imageData}`;
      } else if (imageData.includes(';base64,')) {
        // Only normalize if it's explicitly marked as base64
        imagePayload = imageData.replace(/;[^,]*,/, ';base64,');
      }
      // If it contains example_id, we leave it exactly as is

      trellisRequest = {
        image: imagePayload,
        mode: 'image',
        output_format: 'glb',
        slat_cfg_scale: 3,
        ss_cfg_scale: 7.5,
        slat_sampling_steps: 25,
        ss_sampling_steps: 25,
        seed: 0,
      };
    }

    console.log('Sending request to NVIDIA Trellis API...');
    console.log('Request parameters:', {
      mode: trellisRequest.mode,
      slat_cfg_scale: trellisRequest.slat_cfg_scale,
      ss_cfg_scale: trellisRequest.ss_cfg_scale,
      slat_sampling_steps: trellisRequest.slat_sampling_steps,
      ss_sampling_steps: trellisRequest.ss_sampling_steps,
      seed: trellisRequest.seed,
      hasImage: !!trellisRequest.image,
      hasText: !!trellisRequest.prompt,
      imagePrefix: trellisRequest.image ? trellisRequest.image.substring(0, 50) + '...' : 'N/A',
    });

    // Requirement 5.4: Send request to NVIDIA Trellis API endpoint
    // Requirement 4.3: Include Bearer token in Authorization header
    // Requirement 6.3: Handle timeouts with 60s timeout
    let trellisResponse;
    try {
      trellisResponse = await fetch(
        'https://ai.api.nvidia.com/v1/genai/microsoft/trellis',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(trellisRequest),
          // Removed manual timeout to allow for longer generation times
        }
      );
    } catch (fetchError) {
      // Requirement 6.3: Handle timeout errors
      if (fetchError instanceof Error && fetchError.name === 'TimeoutError') {
        console.error('API request timeout:', fetchError);
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'TIMEOUT_ERROR',
              message: 'The request to generate the 3D model timed out after 60 seconds. Please try again.',
            },
          },
          { status: 408 }
        );
      }

      // Requirement 6.4: Handle network errors
      if (fetchError instanceof Error && (fetchError.name === 'TypeError' || fetchError.message.includes('fetch'))) {
        console.error('Network error:', fetchError);
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'NETWORK_ERROR',
              message: 'Unable to connect to the 3D model generation service. Please check your internet connection and try again.',
            },
          },
          { status: 503 }
        );
      }

      // Requirement 6.5: Log other fetch errors
      console.error('Fetch error:', fetchError);
      throw fetchError;
    }

    // Requirement 6.2: Handle API error responses with descriptive messages
    if (!trellisResponse.ok) {
      let errorData;
      try {
        errorData = await trellisResponse.json();
      } catch {
        errorData = {};
      }

      // Requirement 4.2: Handle authentication errors specifically
      if (trellisResponse.status === 401 || trellisResponse.status === 403) {
        console.error('Authentication error:', trellisResponse.status, errorData);
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'AUTHENTICATION_ERROR',
              message: 'Invalid or expired API key. Please verify your NVIDIA API key configuration.',
            },
          },
          { status: 401 }
        );
      }

      // Handle rate limiting
      if (trellisResponse.status === 429) {
        console.error('Rate limit exceeded:', errorData);
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'RATE_LIMIT_ERROR',
              message: 'Too many requests. Please wait a moment and try again.',
            },
          },
          { status: 429 }
        );
      }

      if (trellisResponse.status === 400 || trellisResponse.status === 422) {
        console.error('Bad request error:', trellisResponse.status, errorData);
        console.error('Request that was sent:', JSON.stringify(trellisRequest, null, 2));

        let message = errorData.error?.message || errorData.detail;
        
        // Specific handling for Preview API example_id requirement
        if (typeof message === 'string' && message.includes('example_id')) {
          message = 'The Preview API currently only supports predefined example images. Please use one of the example image IDs (0-3).';
        } else if (Array.isArray(message)) {
          // Handle FastAPI style detail arrays
          const detailMsg = message.map(m => m.msg || JSON.stringify(m)).join(', ');
          if (detailMsg.includes('example_id')) {
            message = 'The Preview API currently only supports predefined example images. Please use one of the example image IDs (0-3).';
          } else {
            message = detailMsg;
          }
        }

        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: message || 'The request was invalid. Please check your input and try again.',
            },
          },
          { status: 400 }
        );
      }

      // Handle server errors
      if (trellisResponse.status >= 500) {
        console.error('Server error:', trellisResponse.status, errorData);
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'SERVER_ERROR',
              message: 'The 3D model generation service is currently unavailable. Please try again later.',
            },
          },
          { status: 503 }
        );
      }

      // Requirement 6.5: Log API errors for debugging
      console.error('API error:', trellisResponse.status, errorData);
      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: {
            code: 'API_ERROR',
            message: errorData.error?.message || `API request failed with status ${trellisResponse.status}`,
          },
        },
        { status: trellisResponse.status }
      );
    }

    // Requirement 6.1: Parse and return GLB model data from response
    let responseData;
    let rawResponseText;
    try {
      rawResponseText = await trellisResponse.text();
      console.log('Raw API response (first 500 chars):', rawResponseText.substring(0, 500));
      responseData = JSON.parse(rawResponseText);
    } catch (parseError) {
      console.error('Failed to parse API response:', parseError);
      console.error('Raw response was:', rawResponseText?.substring(0, 200));
      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'Received an invalid response from the 3D model generation service.',
          },
        },
        { status: 500 }
      );
    }

    // Diagnostic logging to understand the response structure
    console.log('API response keys:', Object.keys(responseData));
    if (responseData.artifacts) {
      console.log('artifacts length:', responseData.artifacts.length);
      if (responseData.artifacts[0]) {
        console.log('artifacts[0] keys:', Object.keys(responseData.artifacts[0]));
        console.log('artifacts[0].base64 length:', responseData.artifacts[0].base64?.length || 'N/A');
        console.log('artifacts[0].base64 prefix:', responseData.artifacts[0].base64?.substring(0, 50) || 'N/A');
      }
    }
    if (responseData.model) {
      console.log('model keys:', Object.keys(responseData.model));
    }

    // Requirement 6.1: Extract and return the 3D model data
    // The API might return data in artifacts[0].base64 or model.data
    const modelData = responseData.artifacts?.[0]?.base64 || responseData.model?.data;

    if (modelData) {
      return NextResponse.json<GenerateModelResponse>({
        success: true,
        model: {
          data: modelData,
          format: 'glb',
        },
      });
    }

    // Handle unexpected response format
    console.error('API response missing model data:', responseData);
    return NextResponse.json<GenerateModelResponse>(
      {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'API response did not contain model data',
        },
      },
      { status: 500 }
    );

  } catch (error) {
    // Requirement 6.5: Log unexpected errors for debugging
    console.error('Unexpected error in generate-model route:', error);
    
    return NextResponse.json<GenerateModelResponse>(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred while processing your request',
        },
      },
      { status: 500 }
    );
  }
}
