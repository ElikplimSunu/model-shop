'use client';

import { useEffect, useRef, useState } from 'react';
import type { Building } from '@/lib/building';

// Upload a CAD drawing set (PDF); Claude reads it into a building on this Mac (app/api/read-drawing, tools/read_drawing.py).
type Floor = { name: string; level: number; state: string; note: string; pick?: boolean };
type Status = {
  id: string; stage?: string; log?: string[]; cost?: number; cap?: number; estimate?: number;
  floors?: Floor[]; done?: boolean; error?: string | null; warning?: string; left_out?: { name: string; why: string }[];
  building?: Building; issues?: string[];
};

const KEY = 'drawing-job';
const API = '/api/read-drawing';
const money = (n = 0) => `$${n.toFixed(2)}`;
const STATE: Record<string, string> = { waiting: 'waiting', walls: 'reading walls', furniture: 'reading furniture', done: 'read', failed: 'failed', skipped: 'not read' };

export default function DrawingUpload({ onBuilding }: { onBuilding: (b: Building, id: string) => void }) {
  const [id, setId] = useState<string | null>(null);
  const [s, setS] = useState<Status | null>(null);
  const [pickedRaw, setPicked] = useState<number[] | null>(null);
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const loaded = useRef('');

  const forget = () => { setId(null); setS(null); setPicked(null); try { localStorage.removeItem(KEY); } catch { /* fine */ } };

  useEffect(() => { // pick up a reading that was running when the page was closed
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is read after hydration; a lazy initial state would not match the server render
    try { const saved = localStorage.getItem(KEY); if (saved) setId(saved); } catch { /* storage blocked: start fresh */ }
  }, []);

  useEffect(() => {
    if (!id) return;
    let stop = false, timer = 0;
    const poll = async () => {
      const r = await fetch(`${API}?id=${id}`, { cache: 'no-store' }).catch(() => null);
      if (stop) return;
      if (r?.status === 404) { forget(); return; }
      const next = r?.ok ? await r.json() as Status : null;
      if (next) setS(next);
      if (!next?.done) timer = window.setTimeout(poll, 2000);
    };
    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  useEffect(() => { // a finished building goes into the viewer once
    if (id && s?.building && loaded.current !== id) { loaded.current = id; onBuilding(s.building, id); }
  }, [id, s, onBuilding]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setErr(''); setSending(true);
    const form = new FormData();
    form.append('file', file);
    const r = await fetch(API, { method: 'POST', body: form }).catch(() => null);
    const d = await r?.json().catch(() => null) as { id?: string; error?: string } | null;
    setSending(false);
    if (!r?.ok || !d?.id) { setErr(d?.error ?? 'The upload did not reach the app.'); if (d?.id) setId(d.id); return; }
    setS(null); setPicked(null); setId(d.id);
    try { localStorage.setItem(KEY, d.id); } catch { /* the reading still runs; it just will not resume after a reload */ }
  };

  const act = async (action: 'go' | 'cancel', body?: object) => {
    setErr('');
    const r = await fetch(`${API}?id=${id}&action=${action}`, { method: 'POST', body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }).catch(() => null);
    if (!r?.ok) setErr((await r?.json().catch(() => null))?.error ?? 'The app did not answer.');
  };

  const floors = s?.floors ?? [];
  const picked = pickedRaw ?? floors.flatMap((f, i) => (f.pick === false ? [] : [i])); // the reader unticks floors it doubts
  const each = floors.length ? (s?.estimate ?? 0) / floors.length : 0;
  const toggle = (i: number) => setPicked(picked.includes(i) ? picked.filter((j) => j !== i) : [...picked, i].sort((a, b) => a - b));
  const last = s?.log?.at(-1)?.replace(/^\d\d:\d\d:\d\d /, '');

  return (
    <div className="block">
      <h2 className="label"><b>·</b>From a drawing<span className="aside">Claude reads it</span></h2>

      {!id && (
        <>
          <label className="drop" style={{ minHeight: 120 }}>
            <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={sending}
              onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            <strong>{sending ? 'Uploading…' : 'Choose a drawing set (PDF)'}</strong>
            <small>CAD drawings with their text, not scans</small>
          </label>
          <p className="hint">Claude sorts the pages and finds each floor first (a few cents). You then choose which floors to read, at about {money(0.5)} each.</p>
        </>
      )}

      {id && s && (
        <div className="reader" aria-live="polite">
          {!s.done && s.stage !== 'confirm' && <p className="lede-s">{last ?? 'Starting…'}</p>}

          {s.stage === 'confirm' && !s.done && (
            <>
              <p className="lede-s">Found {floors.length} {floors.length === 1 ? 'floor' : 'floors'}. Choose which to read:</p>
              {s.warning && <div className="err" role="alert" style={{ marginTop: 10 }}><p>{s.warning}</p></div>}
              <ul className="floors">
                {floors.map((f, i) => (
                  <li key={f.name}>
                    <label><input type="checkbox" checked={picked.includes(i)} onChange={() => toggle(i)} />{f.name}<span className="num">{f.level >= 0 ? '+' : ''}{f.level.toFixed(2)} m</span></label>
                    {f.note && <small>{f.note}</small>}
                  </li>
                ))}
              </ul>
              {s.left_out && s.left_out.length > 0 && (
                <details className="hint"><summary>{s.left_out.length} more {s.left_out.length === 1 ? 'plan' : 'plans'} could not be measured</summary>
                  <ul>{s.left_out.map((p, i) => <li key={i}>{p.name}: {p.why}</li>)}</ul>
                </details>
              )}
              <button type="button" className="go" disabled={!picked.length} onClick={() => act('go', { floors: picked })}>
                Read {picked.length} {picked.length === 1 ? 'floor' : 'floors'}<kbd>about {money(each * picked.length)}</kbd>
              </button>
            </>
          )}

          {s.stage !== 'confirm' && floors.length > 0 && (
            <ul className="floors">
              {floors.map((f, i) => (
                <li key={f.name} data-state={f.state}>
                  <span>{f.name}</span><span className="num">{STATE[f.state] ?? f.state}</span>
                  {f.state === 'done' && <a href={`${API}?id=${id}&file=check-${i}.jpg`} target="_blank" rel="noreferrer">check</a>}
                  {f.state === 'failed' && f.note && <small>{f.note}</small>}
                </li>
              ))}
            </ul>
          )}

          <p className="hint num">Spent {money(s.cost)}{s.cap ? ` of a ${money(s.cap)} cap` : ''}</p>

          {s.error && <div className="err" role="alert"><p>{s.error}</p></div>}
          {s.done && s.issues && s.issues.length > 0 && <div className="err" role="alert"><p>The reading came back with problems; it is in Numbers to fix.</p></div>}
          {s.done && s.building && !s.issues?.length && (
            <p className="hint">In the viewer now. Read from the drawing, so check it: open each floor&apos;s check picture (blue walls, orange doors, purple windows, red furniture over the plan). Plainer than the hand-built examples: no site, colours or facade. A floor that failed keeps its place with the outline of its neighbour and no walls inside.</p>
          )}

          <p className="hint">
            {!s.done
              ? <button type="button" className="linkish" onClick={() => act('cancel')}>Cancel</button>
              : <button type="button" className="linkish" onClick={forget}>Read another drawing</button>}
          </p>
        </div>
      )}

      {err && <div className="err" role="alert" style={{ marginTop: 12 }}><p>{err}</p></div>}
    </div>
  );
}
