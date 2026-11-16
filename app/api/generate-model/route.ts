import { NextRequest, NextResponse } from 'next/server';
import type { GenerateModelRequest, GenerateModelResponse } from '@/types/3d-model';
import { Client } from "@gradio/client";

// Disable caching for this dynamic route
export const dynamic = 'force-dynamic';

/**
 * POST /api/generate-model
 * 
 * Handles 3D model generation requests.
 * Hybrid approach:
 * - Text-to-3D: Forwards to NVIDIA Trellis API.
 * - Image-to-3D: Uses Hugging Face microsoft/TRELLIS.2 via Gradio client.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.NVIDIA_API_KEY;
    const hfToken = process.env.HF_TOKEN;
    
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

    // --- CASE: TEXT-TO-3D (NVIDIA NIM) ---
    if (body.type === 'text') {
      // Own TRELLIS text model on Modal (trellis1_modal.py) when configured; NVIDIA otherwise.
      const modalTextUrl = process.env.MODAL_TEXT_URL;
      if (modalTextUrl && body.data.trim()) {
        console.log('Sending Text-to-3D request to Modal TRELLIS...');
        const modalResponse = await fetch(modalTextUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.MODAL_TRELLIS_KEY}`,
            'Content-Type': 'text/plain; charset=utf-8',
          },
          body: body.data.trim(),
        });
        if (!modalResponse.ok) {
          const detail = await modalResponse.text().catch(() => '');
          return NextResponse.json<GenerateModelResponse>(
            {
              success: false,
              error: { code: 'API_ERROR', message: `Modal TRELLIS text failed with status ${modalResponse.status}: ${detail.slice(0, 200)}` },
            },
            { status: 502 }
          );
        }
        return NextResponse.json<GenerateModelResponse>({
          success: true,
          model: { data: Buffer.from(await modalResponse.arrayBuffer()).toString('base64'), format: 'glb' },
        });
      }

      if (!apiKey || apiKey === 'your_nvidia_api_key_here') {
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'CONFIGURATION_ERROR',
              message: 'NVIDIA API key is not configured for Text-to-3D.',
            },
          },
          { status: 500 }
        );
      }

      if (!body.data.trim()) {
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'EMPTY_INPUT',
              message: 'Text prompt cannot be empty',
            },
          },
          { status: 400 }
        );
      }

      const trellisRequest = {
        prompt: body.data,
        mode: 'text',
        output_format: 'glb',
        slat_cfg_scale: 3,
        ss_cfg_scale: 7.5,
        slat_sampling_steps: 25,
        ss_sampling_steps: 25,
        seed: 0,
      };

      console.log('Sending Text-to-3D request to NVIDIA Trellis API...');
      
      const trellisResponse = await fetch(
        'https://ai.api.nvidia.com/v1/genai/microsoft/trellis',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(trellisRequest),
        }
      );

      if (!trellisResponse.ok) {
        const errorData = await trellisResponse.json().catch(() => ({}));
        return NextResponse.json<GenerateModelResponse>(
          {
            success: false,
            error: {
              code: 'API_ERROR',
              message: errorData.error?.message || `NVIDIA API request failed with status ${trellisResponse.status}`,
            },
          },
          { status: trellisResponse.status }
        );
      }

      const responseData = await trellisResponse.json();
      const modelData = responseData.artifacts?.[0]?.base64 || responseData.model?.data;

      if (modelData) {
        return NextResponse.json<GenerateModelResponse>({
          success: true,
          model: { data: modelData, format: 'glb' },
        });
      }

      return NextResponse.json<GenerateModelResponse>(
        {
          success: false,
          error: { code: 'INVALID_RESPONSE', message: 'NVIDIA API did not contain model data' },
        },
        { status: 500 }
      );
    }

    if (body.type === 'image') {
      // Prepare image bytes from base64
      let imageData = body.data;
      if (imageData.includes(';base64,')) {
        imageData = imageData.split(',')[1];
      }
      const buffer = Buffer.from(imageData, 'base64');

      // Own TRELLIS.2 on Modal (trellis_modal.py) when configured; HF Space otherwise.
      // Modal answers long jobs with a 303 to a result URL, which fetch follows on its own.
      const modalUrl = process.env.MODAL_TRELLIS_URL;
      if (modalUrl) {
        console.log('Sending Image-to-3D request to Modal TRELLIS.2...');
        // High: TRELLIS.2's finest pass, about 3x the time and file size (see QUALITY in trellis_modal.py)
        const modalResponse = await fetch(body.quality === 'high' ? `${modalUrl}?quality=high` : modalUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.MODAL_TRELLIS_KEY}`,
            'Content-Type': 'application/octet-stream',
          },
          body: buffer,
        });
        if (!modalResponse.ok) {
          const detail = await modalResponse.text().catch(() => '');
          return NextResponse.json<GenerateModelResponse>(
            {
              success: false,
              error: { code: 'API_ERROR', message: `Modal TRELLIS.2 failed with status ${modalResponse.status}: ${detail.slice(0, 200)}` },
            },
            { status: 502 }
          );
        }
        return NextResponse.json<GenerateModelResponse>({
          success: true,
          model: { data: Buffer.from(await modalResponse.arrayBuffer()).toString('base64'), format: 'glb' },
        });
      }

      console.log('Connecting to Hugging Face TRELLIS.2 Space...');

      // Connect with token if available, otherwise anonymous
      const hfToken = process.env.HF_TOKEN;
      const client = await Client.connect("microsoft/TRELLIS.2", hfToken ? {
        token: hfToken as `hf_${string}`,
      } : {});

      const blob = new Blob([buffer], { type: 'image/png' });

      console.log('Step 1: Preprocessing Image...');
      await client.predict("/preprocess_image", { input: blob });

      console.log('Step 2: Getting Seed...');
      const seedResult = await client.predict("/get_seed", { 
        randomize_seed: true, 
        seed: 0 
      });
      const seed = (seedResult.data as number[])[0];

      console.log(`Step 3: Generating 3D Model (Seed: ${seed})...`);
      // Calling image_to_3d generates the state internally in the session
      await client.predict("/image_to_3d", { 
        image: blob,
        seed: seed,
        resolution: "1024",
        ss_guidance_strength: 7.5,
        ss_guidance_rescale: 0.7,
        ss_sampling_steps: 12,
        ss_rescale_t: 5,
        shape_slat_guidance_strength: 7.5,
        shape_slat_guidance_rescale: 0.5,
        shape_slat_sampling_steps: 12,
        shape_slat_rescale_t: 3,
        tex_slat_guidance_strength: 1,
        tex_slat_guidance_rescale: 0,
        tex_slat_sampling_steps: 12,
        tex_slat_rescale_t: 3,
      });

      console.log('Step 4: Extracting GLB...');
      const extractResult = await client.predict("/extract_glb", { 
        decimation_target: 300000, 
        texture_size: 2048, 
      });

      // extractResult.data[0] is the Model3D output object which contains the file URL
      const modelOutput = (extractResult.data as { url: string; path: string }[])[0];
      if (!modelOutput || !modelOutput.url) {
        throw new Error("Failed to extract GLB: No output URL found");
      }

      console.log('Step 5: Fetching GLB and converting to base64...');
      const glbResponse = await fetch(modelOutput.url);
      if (!glbResponse.ok) throw new Error("Failed to download generated GLB");
      
      const glbBuffer = await glbResponse.arrayBuffer();
      const base64Glb = Buffer.from(glbBuffer).toString('base64');

      return NextResponse.json<GenerateModelResponse>({
        success: true,
        model: {
          data: base64Glb,
          format: 'glb',
        },
      });
    }

    return NextResponse.json<GenerateModelResponse>(
      {
        success: false,
        error: { code: 'INVALID_INPUT_TYPE', message: 'Unsupported input type.' },
      },
      { status: 400 }
    );

  } catch (err: any) {
    console.error('Unexpected error in generate-model route:', err);
    
    let message = 'An unexpected error occurred while processing your request';
    let code = 'INTERNAL_ERROR';

    // Safely extract message from different error formats (standard Error, Gradio status object, etc.)
    if (typeof err === 'string') {
      message = err;
    } else if (err && typeof err === 'object') {
      message = err.message || err.title || message;
      
      // Handle ZeroGPU quota specifically (match regardless of exact wording)
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('gpu quota') || lowerMessage.includes('quota exceeded')) {
        code = 'QUOTA_EXCEEDED';
        message = `Hugging Face ZeroGPU quota exceeded: ${message}. To bypass this, you can duplicate the 'microsoft/TRELLIS.2' space to your own account and run it on a private GPU.`;
      } else if (err.type === 'status' && err.stage === 'error') {
        code = 'GRADIO_ERROR';
      }
    }

    return NextResponse.json<GenerateModelResponse>(
      {
        success: false,
        error: {
          code,
          message,
        },
      },
      { status: 500 }
    );
  }
}
