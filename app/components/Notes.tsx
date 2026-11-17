'use client';

import { memo, useEffect, useRef } from 'react';

// Seconds on the GPU (L40S, seed 42), from the comparison runs on 16 Nov 2026.
const TIMES = [
  { name: 'TRELLIS.2', note: 'in use for photos', s: [133, 48, 91] },
  { name: 'TRELLIS v1', note: '', s: [52, 26, 24] },
  { name: 'Hunyuan3D-2.1', note: '', s: [104, 90, 80] },
];

/**
 * Sheet A-02. Static on purpose: the cursor crew (lib/cursor-swarm.js) splits this text into spans
 * while it builds, so nothing in here may ever re-render. memo() with no props keeps React away from it.
 */
function Notes() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    let swarm: { destroy(): void } | null = null;
    let gone = false;
    import('@/lib/cursor-swarm.js').then(({ default: CursorSwarm }) => {
      if (gone || !root.current) return;
      const css = getComputedStyle(document.documentElement);
      swarm = new CursorSwarm({
        root: root.current,
        // Four cursors share the sheet, a little faster than reading pace. adaptiveSpeed stays off: it sped up
        // to 4x whenever a whole row entered the screen at once, which made the steps unreadable.
        cursors: 4,
        colors: [css.getPropertyValue('--red').trim(), '#3b82c4', '#3a9a6a', '#d08a1e'], // the same crew colours as the Buildings page
        startPosition: 'outside',
        labels: false, hud: false, sparks: false, // keep the drafting tools (guides, measuring box), drop the agent name tags and status pill
        deconstruct: false,
        exitAfterBuild: 'edge',
        adaptiveSpeed: false,
        speed: 1.5,
      }).init();
    });
    return () => { gone = true; swarm?.destroy(); };
  }, []);

  return (
    <section className="notes" id="notes" ref={root} data-cs="none">
      <div className="notes-inner" data-cs="none">
        <p className="label" data-cs="none"><b>A-02</b>General notes</p>
        {/* On its own page the sheet is all you see, so the heading and intro show at once; the cursor draws the rest */}
        <h2 data-cs-ignore>How a photo becomes a model</h2>
        <p className="lede" data-cs-ignore>
          Each request goes to an AI model running on a rented GPU. It reads the photo or description and
          draws a full 3D object, the way a model maker builds a massing model and then adds the detail.
        </p>

        <ol className="steps" data-cs="none">
          <li data-cs="none"><div className="n">1</div><h3>Read the photo</h3><p>The background is cut away, then Meta&apos;s DINOv3 vision model reads the photo into features the 3D model builds from.</p></li>
          <li data-cs="none"><div className="n">2</div><h3>Block out</h3><p>The model decides which cells of a coarse 3D grid the object fills, like massing blocks on a site model.</p></li>
          <li data-cs="none"><div className="n">3</div><h3>Detail</h3><p>Inside those cells it adds the fine shape and the surface colour.</p></li>
          <li data-cs="none"><div className="n">4</div><h3>Export</h3><p>The result becomes a triangle mesh with a painted texture, saved as one .glb file that opens almost anywhere.</p></li>
        </ol>

        <div className="cols">
          <div>
            <h3>Three models, same three photos</h3>
            {/* scanned in as one piece: a single cursor typing fifteen cells would take too long */}
            <div data-cs="media" data-cs-dir="t">
            <table className="times" data-cs="skip">
              <thead>
                <tr><th>Model</th><th className="r">Cut-out</th><th className="r">Chair</th><th className="r">Mug</th></tr>
              </thead>
              <tbody>
                {TIMES.map((m) => (
                  <tr key={m.name} className={m.note ? 'pick' : ''}>
                    <td>{m.name}{m.note && <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}> · {m.note}</span>}</td>
                    {m.s.map((s, i) => <td key={i} className="num">{s} s</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="hint">Seconds of GPU work once the model is loaded. A cold start adds about two minutes.</p>
          </div>
          <div className="next-up">
            <h3>Next on the board: buildings</h3>
            <p>
              The aim is to turn drawings and photos of buildings into detailed building models. That is not
              tested yet. These models learned mostly from single objects, so whole buildings are the open
              question for the next round.
            </p>
            <p style={{ margin: 0 }}>Photos use TRELLIS.2 with Meta&apos;s DINOv3 as its eyes. Descriptions first become a picture (FLUX, hosted by NVIDIA) that you check, then take the same photo path. Microsoft recommends this over its own text model, which drops style and material words.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default memo(Notes);
