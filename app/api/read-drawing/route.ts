import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { problems, type Building } from '@/lib/building';

// Reads an uploaded drawing set into a building with tools/read_drawing.py (Claude API), one drawing at a time.
// POST (form field "file")       start a reading; returns { id }
// GET  ?id=                      its status, and the building when done
// GET  ?id=&file=check-3.jpg     a check picture
// POST ?id=&action=go            body { floors: number[] }: read those floors
// POST ?id=&action=cancel        stop it
export const dynamic = 'force-dynamic';

const ROOT = process.cwd();
const JOBS = path.join(ROOT, '.drawings'); // gitignored: third-party drawings stay on this Mac
const ID = /^[0-9a-z]{6,12}-[0-9a-f]{8}$/;
const MAX_BYTES = 200 * 1024 * 1024;

type Status = { done?: boolean; error?: string | null; stage?: string; [k: string]: unknown };

const alive = (pid: number) => { if (!(pid > 0)) return false; try { process.kill(pid, 0); return true; } catch { return false; } }; // kill(0) would test our own group
const pidOf = (dir: string) => { try { return Number(readFileSync(path.join(dir, 'pid'), 'utf8')) || 0; } catch { return 0; } };

function statusOf(id: string): Status | null {
  const dir = path.join(JOBS, id);
  if (!existsSync(dir)) return null;
  let s: Status = { stage: 'start', log: [], cost: 0, floors: [], done: false, error: null };
  try { s = JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')); } catch { /* not written yet */ }
  const pid = pidOf(dir);
  if (!s.done && pid && !alive(pid)) s = { ...s, done: true, error: `The reader stopped unexpectedly. Its log is in .drawings/${id}/log.txt.` };
  return s;
}

function busy(): string | null {
  if (!existsSync(JOBS)) return null;
  for (const id of readdirSync(JOBS)) {
    const s = ID.test(id) ? statusOf(id) : null;
    if (s && !s.done && alive(pidOf(path.join(JOBS, id)))) return id;
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  if (!ID.test(id)) return Response.json({ error: 'Unknown reading.' }, { status: 404 });
  const file = url.searchParams.get('file');
  if (file) {
    if (!/^check-\d{1,3}\.jpg$/.test(file) || !existsSync(path.join(JOBS, id, file))) return new Response('Not found', { status: 404 });
    return new Response(readFileSync(path.join(JOBS, id, file)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
  }
  const s = statusOf(id);
  if (!s) return Response.json({ error: 'Unknown reading.' }, { status: 404 });
  const out: Status & { building?: Building; issues?: string[] } = { ...s, id };
  const bf = path.join(JOBS, id, 'building.json');
  if (s.done && !s.error && existsSync(bf)) {
    const b = JSON.parse(readFileSync(bf, 'utf8')) as Building;
    out.building = b;
    out.issues = problems(b);
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const action = url.searchParams.get('action');

  if (id || action) {
    if (!id || !ID.test(id) || !statusOf(id)) return Response.json({ error: 'Unknown reading.' }, { status: 404 });
    const dir = path.join(JOBS, id);
    if (action === 'go') {
      const body = await request.json().catch(() => null) as { floors?: unknown } | null;
      const floors = Array.isArray(body?.floors) ? body.floors.filter((n): n is number => Number.isInteger(n) && n >= 0) : [];
      if (!floors.length) return Response.json({ error: 'Choose at least one floor.' }, { status: 400 });
      writeFileSync(path.join(dir, 'go.json'), JSON.stringify({ floors }));
      return Response.json({ ok: true });
    }
    if (action === 'cancel') {
      const pid = pidOf(dir);
      if (pid && alive(pid)) { try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); } } // the whole group: uv and its python
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'Unknown action.' }, { status: 400 });
  }

  const running = busy();
  if (running) return Response.json({ error: 'Another drawing is still being read. Cancel it or wait for it to finish.', id: running }, { status: 409 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'Choose a PDF drawing set.' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'That file is over 200 MB.' }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return Response.json({ error: 'That is not a PDF. Upload the drawing set as a PDF.' }, { status: 400 });

  const newId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const dir = path.join(JOBS, newId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'input.pdf'), bytes);
  writeFileSync(path.join(dir, 'name.txt'), file.name.slice(0, 200));
  const log = openSync(path.join(dir, 'log.txt'), 'a');
  // the job folder is passed as an argument; the script runs from the project, never from inside the upload's folder
  const child = spawn(process.env.UV_BIN ?? 'uv', ['run', '--quiet', path.join(ROOT, 'tools', 'read_drawing.py'), dir], {
    cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: process.env,
  });
  child.on('error', () => { /* a missing uv: without this listener the error would take the server down; reported below */ });
  if (!child.pid) {
    writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ done: true, error: 'Could not start the reader: is uv installed (brew install uv)?', log: [], floors: [], cost: 0 }));
    return Response.json({ id: newId });
  }
  writeFileSync(path.join(dir, 'pid'), String(child.pid));
  child.unref();
  return Response.json({ id: newId });
}
