'use client';

import { useEffect, useState } from 'react';
import { ENGINES, PICTURE_ENGINES, type Engine, type GenerationInput, type PictureEngine } from '@/types/3d-model';

export type Quality = 'draft' | 'high';

interface InputHandlerProps {
  onSubmit: (input: GenerationInput, quality: Quality, engine: Engine) => Promise<void>;
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
  const [quality, setQuality] = useState<Quality>('draft');
  const [engine, setEngine] = useState<Engine>('trellis2');
  const detail: Quality = engine === 'trellis2' ? quality : 'draft'; // Draft / High exists only for TRELLIS.2
  // Words become a picture first (TRELLIS's text model drops style and material words), and the
  // person checks the picture before any GPU time is spent on the 3D step.
  const [picture, setPicture] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [painter, setPainter] = useState<PictureEngine>('zimage');
  const by = PICTURE_ENGINES[painter];

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

  const makePicture = async () => {
    if (!text.trim()) return setProblem('Describe the object first.');
    setDrawing(true); setProblem(null); setPicture(null);
    const r = await fetch('/api/generate-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text.trim(), engine: painter }),
    }).then((res) => res.json()).catch(() => null);
    setDrawing(false);
    if (!r?.success) return setProblem(r?.error?.message ?? 'Lost the connection to the server.');
    setPicture(r.image);
  };

  const editText = (t: string) => { setText(t); setProblem(null); setPicture(null); }; // an old picture no longer matches

  const submit = async () => {
    if (isLoading || drawing) return;
    if (mode === 'text') {
      if (!picture) return makePicture();
      return onSubmit({ type: 'image', data: picture, preview: `data:image/jpeg;base64,${picture}`, name: text.trim(), fromText: true }, detail, engine);
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
    await onSubmit({ type: 'image', data, preview: URL.createObjectURL(file), name: file.name }, detail, engine);
  };

  const ready = mode === 'text' ? text.trim().length > 0 : !!file;
  const label = isLoading ? 'Generating…' : mode === 'text' && !picture ? (drawing ? 'Drawing the picture…' : 'Make picture') : 'Generate model';

  return (
    <div className="block">
      <h2 className="label"><b>01</b>Source</h2>

      <div className="tabs" role="tablist">
        {(['image', 'text'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} disabled={isLoading || drawing}
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
          <textarea className="prompt" value={text} maxLength={MAX_TEXT} disabled={isLoading || drawing}
            placeholder="A small stone chapel with a slate roof and one arched wooden door"
            onChange={(e) => editText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }} />
          <div className="count mono"><span>Describe one object</span><span>{text.length} / {MAX_TEXT}</span></div>
          <label className="engine" style={{ marginTop: 10 }}>
            <span className="mono">Picture by</span>
            <select value={painter} disabled={isLoading || drawing} onChange={(e) => setPainter(e.target.value as PictureEngine)}>
              {(Object.keys(PICTURE_ENGINES) as PictureEngine[]).map((k) => <option key={k} value={k}>{PICTURE_ENGINES[k].name}</option>)}
            </select>
          </label>
          <p className="hint mono" style={{ marginTop: 4 }}>{by.where}</p>
          {picture || drawing ? (
            <>
              <div className="drop still" aria-live="polite">
                {drawing ? (
                  <><strong>Drawing the picture…</strong><small className="mono">{by.name} · {by.wait}</small></>
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- base64 from our own API */}
                    <img src={`data:image/jpeg;base64,${picture}`} alt="The picture made from your description" />
                    <span className="caption mono">Does it match your words? Then make it 3D.</span>
                  </>
                )}
              </div>
              {picture && !drawing && (
                <p className="hint"><button type="button" className="linkish" disabled={isLoading} onClick={makePicture}>Try another picture</button> · {by.name}, {by.wait}</p>
              )}
            </>
          ) : (
            <>
              <p className="hint">Your words become a picture first. You check it, then it becomes 3D.</p>
              <ul className="examples">
                {EXAMPLES.map((ex, i) => (
                  <li key={ex}>
                    <button type="button" disabled={isLoading} onClick={() => editText(ex)}>
                      <span>{String(i + 1).padStart(2, '0')}</span>{ex}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {problem && <div className="err" role="alert" style={{ marginTop: 14 }}><p>{problem}</p></div>}

      <label className="engine">
        <span className="mono">Model</span>
        <select value={engine} disabled={isLoading} onChange={(e) => setEngine(e.target.value as Engine)}>
          {(Object.keys(ENGINES) as Engine[]).map((k) => <option key={k} value={k}>{ENGINES[k].name}</option>)}
        </select>
      </label>

      {engine === 'trellis2' ? (
        <div className="quality" role="radiogroup" aria-label="Detail">
          {(['draft', 'high'] as const).map((q) => (
            <button key={q} type="button" role="radio" aria-checked={quality === q} disabled={isLoading} onClick={() => setQuality(q)}>
              {q === 'draft' ? 'Draft' : 'High'}
            </button>
          ))}
          <span className="mono">{quality === 'high' ? 'finer detail · about 3× the time and file size' : 'the usual detail'}</span>
        </div>
      ) : (
        <p className="hint mono">Its own GPU: the first run starts cold. One detail setting, the model&rsquo;s defaults.</p>
      )}

      <button type="button" className="go" disabled={!ready || isLoading || drawing} onClick={submit}>
        {label}
        <kbd>{mode === 'text' ? '⌘ ↵' : '→'}</kbd>
      </button>
    </div>
  );
}
