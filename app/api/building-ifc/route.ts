import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { problems, type Building } from '@/lib/building';

// A building's numbers to an IFC2X3 file for Revit, with tools/to_ifc.py (IfcOpenShell, run by uv). Free, on this Mac.
// POST  body: the building as JSON  ->  the .ifc file, or { error } in plain words
export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // the 12-floor drawing reading is about 0.1 MB
const SCRIPT = path.join(process.cwd(), 'tools', 'to_ifc.py');

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: 'That building is too big to convert (over 5 MB of numbers).' }, { status: 413 });
  let b: Building, issues: string[];
  try {
    b = JSON.parse(text);
    issues = b && typeof b === 'object' ? problems(b) : ['Not a building.'];
  } catch {
    return Response.json({ error: 'Not a building: these are not readable numbers.' }, { status: 400 });
  }
  if (issues.length) return Response.json({ error: issues.join(' ') }, { status: 400 });

  const name = String(b.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'building';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'model-shop-ifc-'));
  try {
    await writeFile(path.join(dir, 'building.json'), JSON.stringify(b));
    await new Promise<void>((ok, fail) => execFile(process.env.UV_BIN ?? 'uv', ['run', '--quiet', SCRIPT, 'building.json', `${name}.ifc`],
      { cwd: dir, timeout: 120_000 }, (e, _out, err) => (e ? fail(Object.assign(e, { stderr: err })) : ok())));
    return new Response(await readFile(path.join(dir, `${name}.ifc`)), {
      headers: { 'Content-Type': 'application/x-step', 'Content-Disposition': `attachment; filename="${name}.ifc"` },
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
    const why = err.code === 'ENOENT' ? 'could not start: is uv installed (brew install uv)?'
      : err.killed ? 'took over 2 minutes and was stopped.'
      : `failed: ${(err.stderr ?? '').trim().split('\n').pop() || err.message}`;
    return Response.json({ error: `The IFC writer ${why}` }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
