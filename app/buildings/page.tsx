'use client';

import { useState } from 'react';
import BuildingViewer from '../components/BuildingViewer';
import { area, pretty, problems, SAMPLES, wallsOf, type Building } from '@/lib/building';

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function read(text: string): { b?: Building; issues: string[] } {
  try {
    const b = JSON.parse(text) as Building;
    const issues = problems(b);
    return issues.length ? { issues } : { b, issues };
  } catch (e) {
    return { issues: [`These numbers could not be read: ${e instanceof Error ? e.message : 'unknown error'}`] };
  }
}

export default function Buildings() {
  const [pick, setPick] = useState(0);
  const [text, setText] = useState(() => pretty(SAMPLES[0]));
  const [good, setGood] = useState<Building>(SAMPLES[0]);
  const { issues } = read(text);

  const choose = (i: number) => { setPick(i); setText(pretty(SAMPLES[i])); setGood(SAMPLES[i]); };
  const edit = (t: string) => { setText(t); const r = read(t); if (r.b) setGood(r.b); };

  return (
    <div className="shop">
      <main className="bench builds">
        <aside className="rail left">
          <div className="block">
            <h2 className="label"><b>01</b>Building<span className="aside">built from numbers</span></h2>
            <p className="lede-s">A building is made from its measurements, not guessed by an AI, so every wall, door and window sits exactly where the numbers put it.</p>
            <ul className="examples">
              {SAMPLES.map((s, i) => (
                <li key={s.name}>
                  <button type="button" aria-pressed={pick === i} onClick={() => choose(i)}><span>{String(i + 1).padStart(2, '0')}</span>{s.name}</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="block">
            <h2 className="label"><b>·</b>Measured</h2>
            <dl className="facts num">
              {good.levels.map((lv) => {
                const walls = wallsOf(lv);
                const doors = (lv.openings ?? []).filter((o) => o.kind === 'door' || o.sill === undefined).length;
                return (
                  <div key={lv.name}>
                    <dt>{lv.name}</dt>
                    <dd>{area(lv.outline).toFixed(1)} m² · {count(walls.length, 'wall')} · {count(doors, 'door')} · {count((lv.openings?.length ?? 0) - doors, 'window')} · {lv.height.toFixed(2)} m high</dd>
                  </div>
                );
              })}
            </dl>
            <p className="hint">Area is measured inside the wall centrelines. Next: read these numbers from your own drawing.</p>
          </div>
        </aside>

        <BuildingViewer key={pick} b={good} />

        <aside className="rail right">
          <div className="block grow">
            <h2 className="label"><b>03</b>Numbers<span className="aside">metres</span></h2>
            <textarea className="spec mono" spellCheck={false} value={text} onChange={(e) => edit(e.target.value)}
              onPaste={(e) => { // a pasted building is laid out one item per line; anything that is not JSON pastes as usual
                const ta = e.currentTarget, next = ta.value.slice(0, ta.selectionStart) + e.clipboardData.getData('text') + ta.value.slice(ta.selectionEnd);
                try { const b = JSON.parse(next) as Building; e.preventDefault(); edit(pretty(b)); } catch { /* not whole JSON yet: let it paste */ }
              }}
              aria-label="The building as numbers" aria-describedby="spec-help" />
            <p id="spec-help" className="hint">
              <b>outline</b>: wall centrelines, corner by corner. <b>walls</b>: inside walls. <b>openings</b>: wall number (outline sides from 0, then inside walls),
              distance along it, width, height, and sill for windows.
            </p>
            {issues.length > 0 && (
              <div className="err" role="alert" style={{ marginTop: 12 }}>
                <p>Showing the last version that worked. To fix:</p>
                <ul>{issues.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
          </div>
        </aside>
      </main>

      <dl className="titleblock">
        <div><dt>Project</dt><dd>Model Shop</dd></div>
        <div><dt>Method</dt><dd>Built from measurements · no AI</dd></div>
        <div><dt>Units</dt><dd>Metres</dd></div>
        <div><dt>Scale</dt><dd>True size</dd></div>
        <div><dt>Drawn</dt><dd suppressHydrationWarning>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
        <div className="sheet"><dt>Sheet</dt><dd>A-02</dd></div>
      </dl>
    </div>
  );
}
