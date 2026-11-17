import { NextRequest, NextResponse } from 'next/server';
import { PICTURE_ENGINES, type PictureEngine } from '@/types/3d-model';

export const dynamic = 'force-dynamic';

// Image-to-3D models expect a product shot: one object, all of it, nothing behind it.
const SHOT = 'One single object, the whole object in frame, centered, isolated on a plain white background, three-quarter view from slightly above, soft even studio lighting.';

type Made = { image: string } | { status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Made => ({ status, code, message });

const MAKERS: Record<PictureEngine, (prompt: string) => Promise<Made>> = {
  // Alibaba's Z-Image Turbo (Apache 2.0) on our own Modal GPU; the endpoint checks the shared key on CPU first.
  async zimage(prompt) {
    const res = await fetch(process.env.MODAL_ZIMAGE_URL!, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.MODAL_TRELLIS_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(300_000), // a cold GPU plus loading the model can take minutes
    });
    if (!res.ok) return fail(502, 'PICTURE_FAILED', `Z-Image on Modal said no (status ${res.status}).`);
    return { image: Buffer.from(await res.arrayBuffer()).toString('base64') };
  },

  // NVIDIA-hosted FLUX.1 [dev]: free with NVIDIA_API_KEY, non-commercial weights.
  async flux(prompt) {
    const res = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, width: 1024, height: 1024 }), // this endpoint rejects a seed field
      signal: AbortSignal.timeout(180_000),
    });
    const art = (await res.json().catch(() => null))?.artifacts?.[0];
    if (!res.ok || !art?.base64 || art.finishReason !== 'SUCCESS') {
      return fail(502, 'PICTURE_FAILED', `FLUX said no (${art?.finishReason ?? `status ${res.status}`}).`);
    }
    return { image: art.base64 };
  },
};

/**
 * POST /api/generate-image  { prompt, engine? }  ->  { success, image: base64 }
 * Words become a picture first, because TRELLIS's own text models lose style and material words
 * (Microsoft's README recommends this route). The picture then goes through the photo path.
 * Z-Image Turbo is the default: on 17 Nov it kept every material in our four test descriptions; FLUX made steel legs wooden.
 */
export async function POST(request: NextRequest) {
  const { prompt, engine = 'zimage' } = await request.json().catch(() => ({}));
  const text = typeof prompt === 'string' ? prompt.trim().slice(0, 500) : '';
  if (!text) return NextResponse.json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Describe the object first.' } }, { status: 400 });
  if (typeof engine !== 'string' || !Object.hasOwn(PICTURE_ENGINES, engine)) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_REQUEST', message: `Unknown picture model "${String(engine).slice(0, 40)}".` } }, { status: 400 });
  }
  const { name, env } = PICTURE_ENGINES[engine as PictureEngine];
  if (!process.env[env]) return NextResponse.json({ success: false, error: { code: 'NO_KEY', message: `${name} is not set up: ${env} is missing from .env.local.` } }, { status: 500 });

  const made = await MAKERS[engine as PictureEngine](`${text}. ${SHOT}`).catch((e: Error) => fail(502, 'NETWORK', e.message));
  if ('image' in made) return NextResponse.json({ success: true, image: made.image });
  return NextResponse.json({ success: false, error: { code: made.code, message: made.message } }, { status: made.status });
}
