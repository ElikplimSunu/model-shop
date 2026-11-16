import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Image-to-3D models expect a product shot: one object, all of it, nothing behind it.
const SHOT = 'One single object, the whole object in frame, centered, isolated on a plain white background, three-quarter view from slightly above, soft even studio lighting.';

/**
 * POST /api/generate-image  { prompt }  ->  { success, image: base64 JPEG }
 * Words become a picture first, because TRELLIS's own text models lose style and material words
 * (Microsoft's README recommends this route). The picture then goes through the photo path.
 * ponytail: one engine (NVIDIA-hosted FLUX.1-dev, free with NVIDIA_API_KEY). Add an `engine` field when a second one has actually run.
 */
export async function POST(request: NextRequest) {
  const { prompt } = await request.json().catch(() => ({ prompt: '' }));
  const text = typeof prompt === 'string' ? prompt.trim().slice(0, 500) : '';
  if (!text) return NextResponse.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Describe the object first.' } }, { status: 400 });
  if (!process.env.NVIDIA_API_KEY) return NextResponse.json({ success: false, error: { code: 'NO_KEY', message: 'NVIDIA_API_KEY is not set in .env.local.' } }, { status: 500 });

  const res = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${text}. ${SHOT}`, width: 1024, height: 1024 }), // this endpoint rejects a seed field
    signal: AbortSignal.timeout(180_000),
  }).catch((e: Error) => e);
  if (res instanceof Error) return NextResponse.json({ success: false, error: { code: 'NETWORK', message: res.message } }, { status: 502 });

  const body = await res.json().catch(() => null);
  const art = body?.artifacts?.[0];
  if (!res.ok || !art?.base64 || art.finishReason !== 'SUCCESS') {
    const why = art?.finishReason ?? `status ${res.status}`;
    return NextResponse.json({ success: false, error: { code: 'PICTURE_FAILED', message: `The picture service said no (${why}).` } }, { status: 502 });
  }
  return NextResponse.json({ success: true, image: art.base64 });
}
