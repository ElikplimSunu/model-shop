'use client';

import { useEffect, useRef, useState } from 'react';
import InputHandler from './components/InputHandler';
import ModelViewer from './components/ModelViewer';
import { ENGINES } from '@/types/3d-model';
import { clock, halves, mb, useShop, WINDOW, type Job } from './workshop';

/** Its own component, so the one-second tick never re-renders the 3D view. */
function JobPanel({ job }: { job: Job }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, (now - job.started) / 1000);
  const { name, reads } = ENGINES[job.engine];
  // Usual windows are measured for TRELLIS.2 only; the other models show elapsed time until they have runs to go on.
  // ponytail: add their windows to WINDOW once real runs through the app have been timed
  const w = job.engine === 'trellis2' ? (job.high ? WINDOW.high : WINDOW.draft) : null;
  const [lo, hi] = w ? (job.warm ? w.warm : w.cold) : [0, 0];
  const span = w ? (Math.floor(hi / 60) + 1) * 60 : Math.max(5, Math.ceil((s + 1) / 60)) * 60;
  const pct = (x: number) => `${Math.min(100, (x / span) * 100)}%`;
  const minutes = Array.from({ length: span / 60 + 1 }, (_, i) => i);

  return (
    <div className="block job" aria-live="polite">
      <h2 className="label"><b>02</b>On the GPU<span className="aside">{name} · {reads}{job.high ? ' · High' : ''}</span></h2>
      <p className="clock num">{clock(s)}</p>
      <p>
        {!w
          ? job.warm
            ? `${name}'s GPU was used less than a minute ago, so it should still be warm.`
            : `${name} runs on its own GPU, which starts from cold. There is no usual time for it yet; a cold start alone takes a few minutes.`
          : s > hi
            ? 'Taking longer than usual. It is still waiting for the GPU to answer.'
            : job.warm
              ? `The GPU was used less than a minute ago, so it should still be warm: usually under ${halves(hi)} minutes.`
              : `The GPU starts from cold, so this usually takes ${halves(lo)} to ${halves(hi)} minutes. The next one will be quicker.`}
      </p>
      <div className="scale" aria-hidden="true">
        {minutes.slice(0, -1).map((m) => <span key={m} className="bar-seg" style={{ left: pct(m * 60), width: pct(60) }} />)}
        {w && <span className="band" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />}
        {minutes.map((m) => <span key={m} className="tick num" style={{ left: pct(m * 60) }}>{m}</span>)}
        <span className="now" style={{ left: pct(s) }} />
      </div>
      <p className="hint mono" style={{ marginTop: 6 }}>{w ? 'minutes · hatched: the usual window' : 'minutes'}</p>
    </div>
  );
}

export default function Objects() {
  const { runs, active, setActiveId, job, error, setError, submit, openFile, openSample } = useShop();
  const activeId = active?.id ?? null;
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shop">
        <main className="bench">
          <aside className="rail left">
            <InputHandler onSubmit={submit} isLoading={!!job} />
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
                          {r.engine ? ` · ${ENGINES[r.engine].name}` : ''}{r.high ? ' · High' : ''}{r.seconds ? ` · ${clock(r.seconds)}` : ''} · {mb(r.bytes)}
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
          <div><dt>Engines</dt><dd title="Photos: Microsoft TRELLIS.2 (default), TRELLIS v1 or Tencent Hunyuan3D-2.1, each on its own GPU. Descriptions: a FLUX picture first (on NVIDIA), then the chosen model.">TRELLIS.2, TRELLIS v1 or Hunyuan3D-2.1 · Words: FLUX picture first</dd></div>
          <div><dt>Hardware</dt><dd>Modal · NVIDIA L40S</dd></div>
          <div><dt>Scale</dt><dd>Not to scale</dd></div>
          <div><dt>Drawn</dt><dd suppressHydrationWarning>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
          <div className="sheet"><dt>Sheet</dt><dd>A-01</dd></div>
        </dl>
    </div>
  );
}
