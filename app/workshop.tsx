'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useRef, useState } from 'react';
import type { GenerationInput, GenerateModelResponse } from '@/types/3d-model';
import type { Quality } from './components/InputHandler';

export type Kind = 'photo' | 'text' | 'file';
// ponytail: runs live only in this tab's memory (GLBs are 2 to 36 MB each); add storage if people want them back later
export type Run = { id: number; kind: Kind; label: string; url: string; bytes: number; ref?: string; seconds?: number; high?: boolean };
// kind is the GPU that runs the job: descriptions become a picture first, so they run as 'photo' too
export type Job = { kind: 'photo' | 'text'; started: number; warm: boolean; high: boolean };
type Problem = { message: string; detail?: string } | null;

// Modal keeps a GPU for 60 s after its last request (scaledown_window in trellis_modal.py / trellis1_modal.py).
const WARM_MS = 55_000;
// Expected windows in seconds, from runs logged on 16 Nov 2026. Cold Draft took 4:09 and 5:38 through the
// app (cold starts vary). High: chair 161 s and tower 241 s of GPU work; warm High through the app 2:58.
export const WINDOW = { draft: { cold: [150, 360], warm: [30, 140] }, high: { cold: [300, 540], warm: [150, 300] } } as const;
export const halves = (s: number) => { const h = Math.round(s / 30) / 2; return `${Math.floor(h)}${h % 1 ? '½' : ''}`; };
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

type Shop = {
  runs: Run[]; active: Run | null; setActiveId: (id: number) => void;
  job: Job | null; error: Problem; setError: (p: Problem) => void;
  submit: (input: GenerationInput, quality: Quality) => Promise<void>;
  openFile: (f: File | undefined) => void; openSample: () => Promise<void>;
};
const ShopContext = createContext<Shop | null>(null);
export function useShop() {
  const shop = useContext(ShopContext);
  if (!shop) throw new Error('useShop must be used inside <Workshop>');
  return shop;
}

const PAGES = [['/', 'Objects'], ['/buildings', 'Buildings'], ['/how-it-works', 'How it works']] as const;

/**
 * Sits in the root layout, which Next keeps mounted across page changes. So the run log and a job on
 * the GPU live here, not in a page: leaving the Objects page mid-job must never drop a paid result.
 */
export default function Workshop({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<Problem>(null);
  const lastDone = useRef<Partial<Record<'photo' | 'text', number>>>({});
  const path = usePathname();

  const addRun = (run: Omit<Run, 'id'>) => {
    const id = Date.now();
    setRuns((rs) => [{ ...run, id }, ...rs]);
    setActiveId(id);
    setError(null);
    // On a phone the view sits below the form. Wait for the job panel to close first, or the scroll overshoots.
    if (matchMedia('(max-width: 1023px)').matches) setTimeout(() => document.querySelector('.view')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  const submit = async (input: GenerationInput, quality: Quality) => {
    const kind = input.type === 'image' ? 'photo' : 'text';
    const started = Date.now();
    const high = quality === 'high';
    setJob({ kind, started, warm: started - (lastDone.current[kind] ?? 0) < WARM_MS, high });
    setError(null);
    try {
      const res = await fetch('/api/generate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: input.type, data: input.data, quality }),
      });
      const result: GenerateModelResponse = await res.json().catch(() => ({ success: false, error: { code: `HTTP_${res.status}`, message: res.statusText } }));
      lastDone.current[kind] = Date.now();
      if (!result.success || !result.model) {
        setError({ message: 'The GPU could not make this one.', detail: result.error ? `${result.error.code}: ${result.error.message}` : undefined });
        return;
      }
      const blob = await (await fetch(`data:model/gltf-binary;base64,${result.model.data}`)).blob();
      addRun({
        kind: input.type === 'image' && input.fromText ? 'text' : kind,
        high,
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

  const shop: Shop = { runs, active: runs.find((r) => r.id === activeId) ?? null, setActiveId, job, error, setError, submit, openFile, openSample };

  return (
    <ShopContext.Provider value={shop}>
      <div className="frame">
        <header className="bar">
          <Link href="/" className="brand">Model <i>Shop</i></Link>
          {job && path !== '/' && <Link href="/" className="gpu-pill mono" title="A model is being made. Open Objects to watch it."><span>On the GPU</span></Link>}
          <nav>
            {PAGES.map(([href, name]) => (
              <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{name}</Link>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </ShopContext.Provider>
  );
}
