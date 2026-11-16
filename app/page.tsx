'use client';

import { useEffect, useRef, useState } from 'react';
import InputHandler from './components/InputHandler';
import ModelViewer from './components/ModelViewer';
import Notes from './components/Notes';
import type { GenerationInput, GenerateModelResponse } from '@/types/3d-model';

type Kind = 'photo' | 'text' | 'file';
// ponytail: runs live only in this tab's memory (GLBs are 2 to 14 MB each); add storage if people want them back later
type Run = { id: number; kind: Kind; label: string; url: string; bytes: number; ref?: string; seconds?: number };
type Job = { kind: 'photo' | 'text'; started: number; warm: boolean };

// Modal keeps a GPU for 60 s after its last request (scaledown_window in trellis_modal.py / trellis1_modal.py).
const WARM_MS = 55_000;
// Expected windows in seconds, from the cold and warm runs logged on 16 Nov 2026.
const WINDOW = { cold: [150, 270], warm: [30, 140] } as const;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Its own component, so the one-second tick never re-renders the 3D view. */
function JobPanel({ job }: { job: Job }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, (now - job.started) / 1000);
  const [lo, hi] = job.warm ? WINDOW.warm : WINDOW.cold;
  const span = job.warm ? 180 : 300;
  const pct = (x: number) => `${Math.min(100, (x / span) * 100)}%`;
  const minutes = Array.from({ length: span / 60 + 1 }, (_, i) => i);

  return (
    <div className="block job" aria-live="polite">
      <h2 className="label"><b>02</b>On the GPU<span className="aside">{job.kind === 'photo' ? 'TRELLIS.2 · Meta DINOv3' : 'TRELLIS text · CLIP'}</span></h2>
      <p className="clock num">{clock(s)}</p>
      <p>
        {s > hi
          ? 'Taking longer than usual. It is still waiting for the GPU to answer.'
          : job.warm
            ? 'The GPU was used less than a minute ago, so it should still be warm: usually under 2½ minutes.'
            : 'The GPU starts from cold, so this usually takes 2½ to 4½ minutes. The next one will be quicker.'}
      </p>
      <div className="scale" aria-hidden="true">
        {minutes.slice(0, -1).map((m) => <span key={m} className="bar-seg" style={{ left: pct(m * 60), width: pct(60) }} />)}
        <span className="band" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
        {minutes.map((m) => <span key={m} className="tick num" style={{ left: pct(m * 60) }}>{m}</span>)}
        <span className="now" style={{ left: pct(s) }} />
      </div>
      <p className="hint mono" style={{ marginTop: 6 }}>minutes · hatched: the usual window</p>
    </div>
  );
}

export default function Home() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const lastDone = useRef<Partial<Record<'photo' | 'text', number>>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const active = runs.find((r) => r.id === activeId) ?? null;

  const addRun = (run: Omit<Run, 'id'>) => {
    const id = Date.now();
    setRuns((rs) => [{ ...run, id }, ...rs]);
    setActiveId(id);
    setError(null);
    // On a phone the view sits below the form. Wait for the job panel to close first, or the scroll overshoots.
    if (matchMedia('(max-width: 1023px)').matches) setTimeout(() => document.querySelector('.view')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  const handleSubmit = async (input: GenerationInput) => {
    const kind = input.type === 'image' ? 'photo' : 'text';
    const started = Date.now();
    setJob({ kind, started, warm: started - (lastDone.current[kind] ?? 0) < WARM_MS });
    setError(null);
    try {
      const res = await fetch('/api/generate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: input.type, data: input.data }),
      });
      const result: GenerateModelResponse = await res.json().catch(() => ({ success: false, error: { code: `HTTP_${res.status}`, message: res.statusText } }));
      lastDone.current[kind] = Date.now();
      if (!result.success || !result.model) {
        setError({ message: 'The GPU could not make this one.', detail: result.error ? `${result.error.code}: ${result.error.message}` : undefined });
        return;
      }
      const blob = await (await fetch(`data:model/gltf-binary;base64,${result.model.data}`)).blob();
      addRun({
        kind,
        label: input.type === 'image' ? input.name ?? 'photo' : input.data,
        url: URL.createObjectURL(blob),
        bytes: blob.size,
        ref: input.type === 'image' ? input.preview : undefined,
        seconds: (Date.now() - started) / 1000,
      });
    } catch (e) {
      setError({ message: 'Lost the connection to the server before the model came back.', detail: e instanceof Error ? e.message : undefined });
    } finally {
      setJob(null);
    }
  };

  const openFile = (f: File | undefined) => {
    if (!f) return;
    if (!/\.glb$/i.test(f.name)) return setError({ message: 'Only .glb files open here.' });
    addRun({ kind: 'file', label: f.name, url: URL.createObjectURL(f), bytes: f.size });
  };

  const openSample = async () => {
    const blob = await fetch('/samples/mug.glb').then((r) => (r.ok ? r.blob() : null)).catch(() => null);
    if (!blob) return setError({ message: 'The sample is missing from public/samples.' });
    addRun({ kind: 'file', label: 'Sample: mug (TRELLIS.2)', url: URL.createObjectURL(blob), bytes: blob.size, ref: '/samples/mug.jpg' });
  };

  return (
    <>
      <div className="shop">
        <header className="bar">
          <span className="brand">Model <i>Shop</i></span>
          <span className="sheet-no mono">Photo or words, to 3D</span>
          <nav>
            <a href="#notes">How it works</a>
          </nav>
        </header>

        <main className="bench">
          <aside className="rail left">
            <InputHandler onSubmit={handleSubmit} isLoading={!!job} />
            {job && <JobPanel job={job} />}
            {error && !job && (
              <div className="block">
                <div className="err" role="alert">
                  <p>{error.message}</p>
                  {error.detail && <code>{error.detail}</code>}
                </div>
              </div>
            )}
          </aside>

          <ModelViewer
            url={active?.url ?? null}
            name={active?.label ?? 'model'}
            bytes={active?.bytes}
            reference={active?.ref}
            busy={!!job}
            onOpenSample={openSample}
            onError={(message) => setError({ message })}
          />

          <aside className="rail right">
            <div className="block" style={{ borderBottom: 0, paddingBottom: 10 }}>
              <h2 className="label"><b>03</b>Run log
                <span className="aside"><button type="button" className="linkish" onClick={() => fileRef.current?.click()}>Open .glb</button></span>
              </h2>
              <input ref={fileRef} type="file" accept=".glb,model/gltf-binary" className="sr-only"
                onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {runs.length === 0 ? (
              <p className="log-empty">Each model you make lands here, newest first. They stay until you close the tab.</p>
            ) : (
              <ul className="log" style={{ borderTop: '1px solid var(--rule)' }}>
                {runs.map((r) => (
                  <li key={r.id}>
                    <button type="button" aria-current={r.id === activeId} onClick={() => setActiveId(r.id)}>
                      {r.ref
                        ? /* eslint-disable-next-line @next/next/no-img-element -- local object URL */
                          <img className="thumb" src={r.ref} alt="" />
                        : <span className="thumb" aria-hidden="true">{r.kind === 'text' ? 'T' : '3D'}</span>}
                      <span style={{ minWidth: 0 }}>
                        <span className="name" title={r.label}>{r.label}</span>
                        <span className="meta num">
                          {r.kind === 'photo' ? 'Photo' : r.kind === 'text' ? 'Description' : 'File'}
                          {r.seconds ? ` · ${clock(r.seconds)}` : ''} · {mb(r.bytes)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </main>

        <dl className="titleblock">
          <div><dt>Project</dt><dd>Model Shop</dd></div>
          <div><dt>Engines</dt><dd title="Photos: Microsoft TRELLIS.2, reading the photo with Meta DINOv3. Text: Microsoft TRELLIS text-xlarge.">Photo: TRELLIS.2 + DINOv3 · Text: TRELLIS text-xlarge</dd></div>
          <div><dt>Hardware</dt><dd>Modal · NVIDIA L40S</dd></div>
          <div><dt>Scale</dt><dd>Not to scale</dd></div>
          <div><dt>Drawn</dt><dd suppressHydrationWarning>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
          <div className="sheet"><dt>Sheet</dt><dd>A-01</dd></div>
        </dl>
      </div>

      <Notes />
    </>
  );
}
