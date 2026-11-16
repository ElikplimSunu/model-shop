'use client';

import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import { Component, ComponentRef, ReactNode, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type Stats = { url: string; w: number; d: number; h: number; tris: number };
type Controls = { target: THREE.Vector3; update(): void; saveState(): void };

const SIDE = 2; // every model is scaled so its longest side is 2 units; the grid and camera are set for that

const darkQuery = '(prefers-color-scheme: dark)';
export const useDark = () => useSyncExternalStore(
  (cb) => { const m = matchMedia(darkQuery); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
  () => matchMedia(darkQuery).matches,
  () => false,
);

/** Neutral studio lighting built locally (no HDR download), close to model-viewer's "neutral". */
export function Studio() {
  const gl = useThree((s) => s.gl);
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);
  return <primitive object={env} attach="environment" />;
}

function Model({ url, wireframe, onStats }: { url: string; wireframe: boolean; onStats: (s: Stats) => void }) {
  const gltf = useLoader(GLTFLoader, url);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;

  // Stand the model on the grid, scale it to SIDE, aim the camera, and remember that view for Reset.
  useEffect(() => {
    const root = gltf.scene;
    root.scale.setScalar(1);
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const k = SIDE / Math.max(size.x, size.y, size.z);
    const c = box.getCenter(new THREE.Vector3());
    root.scale.setScalar(k);
    root.position.set(-c.x * k, -box.min.y * k, -c.z * k);

    let tris = 0;
    root.traverse((o) => {
      const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
      if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    onStats({ url, w: size.x, d: size.z, h: size.y, tris });

    // Back the camera off until the whole model fits the narrower of the two fields of view (phones are tall).
    const h = size.y * k;
    const cam = camera as THREE.PerspectiveCamera;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
    const radius = size.clone().multiplyScalar(k / 2).length();
    const dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1; // a margin for the readout and tools
    cam.position.copy(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist)).add(new THREE.Vector3(0, h / 2, 0));
    if (controls) { controls.target.set(0, h / 2, 0); controls.update(); controls.saveState(); }
  }, [gltf, url, camera, controls, onStats]);

  useEffect(() => {
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { (x as THREE.MeshStandardMaterial).wireframe = wireframe; });
    });
  }, [gltf, wireframe]);

  return <primitive object={gltf.scene} />;
}

class LoadGuard extends Component<{ children: ReactNode; onError: (e: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { this.props.onError(e); }
  render() { return this.state.failed ? null : this.props.children; }
}

function Axo() {
  return (
    <svg className="axo" viewBox="0 0 120 120" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path d="M60 14 L104 38 L104 86 L60 110 L16 86 L16 38 Z" />
      <path d="M16 38 L60 62 L104 38 M60 62 L60 110" />
      <path className="hidden-edge" d="M60 14 L60 62" opacity="0.5" />
      <line x1="10" y1="94" x2="54" y2="118" strokeWidth="0.8" />
      <line x1="66" y1="118" x2="110" y2="94" strokeWidth="0.8" />
    </svg>
  );
}

/** "chair.jpg" -> "chair.glb"; a 500-character prompt -> its first 40 safe characters. */
const fileName = (label: string) =>
  `${label.replace(/\.(jpe?g|png|webp|glb)$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'model'}.glb`;

export interface ViewerProps {
  url: string | null;
  name: string;
  bytes?: number;
  reference?: string;
  busy: boolean;
  onOpenSample: () => void;
  onError: (message: string) => void;
}

export default function ModelViewer({ url, name, bytes, reference, busy, onOpenSample, onError }: ViewerProps) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [wire, setWire] = useState(false);
  const [spin, setSpin] = useState(false);
  const dark = useDark();
  const shown = stats && stats.url === url ? stats : null;
  const f = (n: number) => (n / Math.max(shown!.w, shown!.d, shown!.h)).toFixed(2); // proportions: generated models have no real-world scale

  return (
    <section className="view" aria-label="3D view">
      {url && (
        <Canvas dpr={[1, 2]} camera={{ fov: 40, position: [3.3, 2.9, 3.3] }}
          onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; }}>
          <Studio />
          <directionalLight position={[3, 5, 2]} intensity={0.8} />
          <Grid infiniteGrid cellSize={0.25} sectionSize={1} cellThickness={0.6} sectionThickness={1}
            cellColor={dark ? '#2f302b' : '#c9c2b2'} sectionColor={dark ? '#4a4a42' : '#a49c89'}
            fadeDistance={14} fadeStrength={1.5} position={[0, -0.002, 0]} />
          <LoadGuard key={url} onError={() => onError('That file could not be opened as a 3D model.')}>
            <Suspense fallback={null}>
              <Model url={url} wireframe={wire} onStats={setStats} />
              <ContactShadows position={[0, 0, 0]} scale={5} blur={2.4} far={2.5} opacity={dark ? 0.6 : 0.4} resolution={256} />
            </Suspense>
          </LoadGuard>
          <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08}
            minDistance={1.2} maxDistance={14} autoRotate={spin} autoRotateSpeed={1.2} />
        </Canvas>
      )}

      <span className="crop tl" /><span className="crop tr" /><span className="crop bl" /><span className="crop br" />
      <p className="tag mono"><b>02</b> View · perspective</p>
      {busy && url && <p className="busy-tag mono">Drawing a new model…</p>}

      {!url && (
        <div className={`empty ${busy ? 'drawing' : ''}`}>
          <Axo />
          {busy ? (
            <>
              <h2>On the drawing board</h2>
              <p>The model appears here when the GPU sends it back.</p>
            </>
          ) : (
            <>
              <h2>Nothing on the sheet yet</h2>
              <p>Add a photo or describe an object, then press Generate.</p>
              <button type="button" className="linkish" onClick={onOpenSample}>Or open the sample mug, made earlier</button>
            </>
          )}
        </div>
      )}

      {url && !shown && <p className="reading mono">Reading model…</p>}

      {reference && url && (
        <figure className="ref">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
          <img src={reference} alt="The source photo" />
          <figcaption className="mono">Source</figcaption>
        </figure>
      )}

      {url && shown && (
        <>
          <div className="readout num">
            <span className="dims"><span>W</span>{f(shown.w)} <span>D</span>{f(shown.d)} <span>H</span>{f(shown.h)} <span>relative</span></span>
            <span>{Math.round(shown.tris).toLocaleString('en-US')} triangles{bytes ? ` · ${(bytes / 1024 / 1024).toFixed(1)} MB` : ''}</span>
          </div>
          <div className="tools">
            <button type="button" onClick={() => controls.current?.reset()}>Reset view</button>
            <button type="button" aria-pressed={spin} onClick={() => setSpin(!spin)}>Turntable</button>
            <button type="button" className="wide" aria-pressed={wire} onClick={() => setWire(!wire)}>Wireframe</button>
            <a href={url} download={fileName(name)}>Download .glb</a>
          </div>
        </>
      )}
    </section>
  );
}
