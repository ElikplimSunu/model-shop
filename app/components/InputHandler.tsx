'use client';

import { useEffect, useState } from 'react';
import type { GenerationInput } from '@/types/3d-model';

interface InputHandlerProps {
  onSubmit: (input: GenerationInput) => Promise<void>;
  isLoading: boolean;
}

const MAX_TEXT = 500;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXAMPLES = [
  'Brutalist concrete observation tower with sharp geometric angles and recessed glass windows',
  'Two-storey timber house with a pitched tin roof and a wraparound veranda',
  'Traditional Japanese pagoda with curved crimson roofs and golden finials',
  'Mid-century lounge chair with curved walnut armrests and brushed steel legs',
];

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export default function InputHandler({ onSubmit, isLoading }: InputHandlerProps) {
  const [mode, setMode] = useState<'image' | 'text'>('image');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  // the page keeps its own copy of the preview for the run log, so this one can go when it changes
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = (f: File | undefined) => {
    setProblem(null);
    if (!f) return;
    if (!TYPES.includes(f.type)) return setProblem('That file type will not work. Use a JPG, PNG or WebP photo.');
    if (f.size > MAX_BYTES) return setProblem(`That photo is ${kb(f.size)}. The limit is 10 MB.`);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async () => {
    if (isLoading) return;
    if (mode === 'text') {
      if (!text.trim()) return setProblem('Describe the object first.');
      return onSubmit({ type: 'text', data: text.trim() });
    }
    if (!file) return setProblem('Add a photo first.');
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    }).catch(() => null);
    if (!data) return setProblem('Could not read that photo. Try another one.');
    // a fresh URL for the log, because this component revokes its own when the photo changes
    await onSubmit({ type: 'image', data, preview: URL.createObjectURL(file), name: file.name });
  };

  const ready = mode === 'text' ? text.trim().length > 0 : !!file;

  return (
    <div className="block">
      <h2 className="label"><b>01</b>Source</h2>

      <div className="tabs" role="tablist">
        {(['image', 'text'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} disabled={isLoading}
            onClick={() => { setMode(m); setProblem(null); }}>
            {m === 'image' ? 'From a photo' : 'From a description'}
          </button>
        ))}
      </div>

      {mode === 'image' ? (
        <>
          <label className="drop" data-over={over}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!isLoading) pick(e.dataTransfer.files[0]); }}>
            <input type="file" accept={TYPES.join(',')} disabled={isLoading} className="sr-only"
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            {preview && file ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img src={preview} alt="The photo you picked" />
                <span className="caption mono">{file.name} · {kb(file.size)}</span>
              </>
            ) : (
              <>
                <strong>Drop a photo here, or click to choose one</strong>
                <small className="mono">JPG, PNG or WebP · up to 10 MB</small>
              </>
            )}
          </label>
          <p className="hint">Best results: one object, the whole thing in frame, a plain background.</p>
        </>
      ) : (
        <>
          <textarea className="prompt" value={text} maxLength={MAX_TEXT} disabled={isLoading}
            placeholder="A small stone chapel with a slate roof and one arched wooden door"
            onChange={(e) => { setText(e.target.value); setProblem(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
          <div className="count mono"><span>Describe one object</span><span>{text.length} / {MAX_TEXT}</span></div>
          <ul className="examples">
            {EXAMPLES.map((ex, i) => (
              <li key={ex}>
                <button type="button" disabled={isLoading} onClick={() => { setText(ex); setProblem(null); }}>
                  <span>{String(i + 1).padStart(2, '0')}</span>{ex}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {problem && <div className="err" role="alert" style={{ marginTop: 14 }}><p>{problem}</p></div>}

      <button type="button" className="go" disabled={!ready || isLoading} onClick={submit}>
        {isLoading ? 'Generating…' : 'Generate model'}
        <kbd>{mode === 'text' ? '⌘ ↵' : '→'}</kbd>
      </button>
    </div>
  );
}
