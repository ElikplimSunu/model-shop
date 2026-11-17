/**
 * The base64 picture inside a Gemini Interactions API reply, or null.
 * Google's docs (17 Nov 2026) put it at steps[] -> type "model_output" -> content[] -> type "image" -> data,
 * and show no full raw reply, so this also accepts the SDK's output_image shortcut.
 */
export function geminiPicture(body: unknown): string | null {
  const b = body as { output_image?: { data?: unknown }; steps?: { type?: string; content?: { type?: string; data?: unknown }[] }[] } | null;
  if (typeof b?.output_image?.data === 'string') return b.output_image.data;
  for (const step of b?.steps ?? []) {
    if (step?.type !== 'model_output') continue;
    const img = step.content?.find((c) => c?.type === 'image' && typeof c.data === 'string');
    if (img) return img.data as string;
  }
  return null;
}
