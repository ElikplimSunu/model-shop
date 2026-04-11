'use client';

import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ModelViewerProps } from '@/types/3d-model';
import { Suspense, useEffect, useRef, useState, Component, ReactNode } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Performance Monitor Hook
 * 
 * Monitors frame rate during interactions and provides performance warnings.
 * Tracks FPS over a rolling window to detect performance issues.
 */
function usePerformanceMonitor() {
  const [fps, setFps] = useState<number>(60);
  const [showWarning, setShowWarning] = useState(false);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const measureFPS = () => {
      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      // Add frame time to rolling window (keep last 60 frames)
      frameTimesRef.current.push(delta);
      if (frameTimesRef.current.length > 60) {
        frameTimesRef.current.shift();
      }

      // Calculate average FPS from frame times
      if (frameTimesRef.current.length >= 10) {
        const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
        const currentFps = 1000 / avgFrameTime;
        setFps(Math.round(currentFps));

        // Show warning if FPS drops below 30
        setShowWarning(currentFps < 30);
      }

      animationFrameRef.current = requestAnimationFrame(measureFPS);
    };

    animationFrameRef.current = requestAnimationFrame(measureFPS);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return { fps, showWarning };
}

/**
 * Error Boundary for Three.js Canvas content
 * 
 * Catches errors thrown by useLoader/Suspense inside the R3F Canvas
 * and reports them to the parent via onError callback.
 */
class CanvasErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: Error) => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError?: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('CanvasErrorBoundary caught:', error);
    if (this.props.onError) {
      this.props.onError(error);
    }
  }

  render() {
    if (this.state.hasError) {
      return null; // Render nothing inside the canvas on error
    }
    return this.props.children;
  }
}

/**
 * Model Component
 * 
 * Loads and renders a GLB model using useLoader with GLTFLoader directly.
 * In drei v10, useGLTF's 4th arg is extendLoader (NOT an error callback),
 * so we use useLoader directly for proper Suspense-based error handling.
 * Automatically fits the model within viewport boundaries.
 */
function Model({ 
  url, 
  onLoadSuccess 
}: { 
  url: string; 
  onLoadSuccess?: () => void; 
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  
  // Load GLB model using useLoader with GLTFLoader directly.
  const gltf = useLoader(GLTFLoader, url);

  // Center the model at the origin and auto-fit the camera
  useEffect(() => {
    if (gltf && gltf.scene && groupRef.current) {
      try {
        // Reset transforms before computing bounding box
        groupRef.current.scale.setScalar(1);
        groupRef.current.position.set(0, 0, 0);

        const box = new THREE.Box3().setFromObject(groupRef.current);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        // Center the model at the origin (no scaling needed — we move the camera instead)
        groupRef.current.position.set(-center.x, -center.y, -center.z);

        // Auto-fit camera to the model's bounding sphere
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
        // Distance so the model fills ~80% of the viewport
        const cameraDistance = (maxDim / 2) / Math.tan(fov / 2) * 1.25;
        
        // Position camera at an isometric-ish angle
        const d = cameraDistance / Math.sqrt(3);
        camera.position.set(d, d, d);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        
        console.log('Model fitted. Size:', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2), 'Camera distance:', cameraDistance.toFixed(2));
        
        if (onLoadSuccess) {
          onLoadSuccess();
        }
      } catch (error) {
        console.warn('Failed to fit model in viewport:', error);
        if (onLoadSuccess) {
          onLoadSuccess();
        }
      }
    }
  }, [gltf, onLoadSuccess, camera]);

  if (!gltf || !gltf.scene) {
    return null;
  }

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
    </group>
  );
}

/**
 * Loading Fallback Component (rendered inside Canvas during Suspense)
 */
function LoadingIndicator() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#666" wireframe />
    </mesh>
  );
}

/**
 * ModelViewer Component
 * 
 * Renders 3D models using React Three Fiber with interactive controls.
 * Provides lighting, camera configuration, and model display capabilities.
 * Includes performance monitoring to ensure smooth interactions (minimum 30 FPS).
 */
export default function ModelViewer({ 
  modelData, 
  onLoadError, 
  onLoadSuccess 
}: ModelViewerProps) {
  const controlsRef = useRef<any>(null);
  const [isResetting, setIsResetting] = useState(false);
  const { fps, showWarning } = usePerformanceMonitor();

  // Default camera position and target
  const defaultCameraPosition = new THREE.Vector3(3, 3, 3);
  const defaultTarget = new THREE.Vector3(0, 0, 0);

  /**
   * Reset camera to default position with smooth transition
   */
  const handleResetView = () => {
    if (!controlsRef.current) return;

    setIsResetting(true);

    const controls = controlsRef.current;
    const camera = controls.object;

    // Store initial positions
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();

    // Animation parameters
    const duration = 1000; // 1 second
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for smooth deceleration
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      // Interpolate camera position
      camera.position.lerpVectors(startPosition, defaultCameraPosition, easeProgress);

      // Interpolate target position
      controls.target.lerpVectors(startTarget, defaultTarget, easeProgress);

      controls.update();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsResetting(false);
      }
    };

    animate();
  };

  return (
    <div className="w-full h-[400px] sm:h-[500px] bg-gray-900 rounded-lg overflow-hidden relative">
      {/* Performance warning banner */}
      {showWarning && (
        <div className="absolute top-4 left-4 z-10 bg-yellow-600 text-white px-4 py-2 rounded-md shadow-lg flex items-center gap-2">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm">Performance: {fps} FPS (below 30 FPS)</span>
        </div>
      )}

      {/* FPS counter (always visible during development) */}
      <div className="absolute bottom-4 left-4 z-10 bg-gray-800 bg-opacity-75 text-white px-3 py-1 rounded-md text-xs font-mono">
        {fps} FPS
      </div>

      {/* Reset button */}
      <button
        onClick={handleResetView}
        disabled={isResetting}
        className="absolute top-4 right-4 z-10 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-md shadow-lg transition-colors duration-200 flex items-center gap-2"
        aria-label="Reset camera view to default position"
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
        Reset View
      </button>

      <Canvas
        style={{ width: '100%', height: '100%' }}
        camera={{
          position: [3, 3, 3],
          fov: 45,
        }}
        dpr={[1, 2]} // Adaptive pixel ratio for performance
        performance={{ min: 0.5 }} // Allow quality reduction if needed
      >
        {/* Hemisphere light for natural sky/ground ambient */}
        <hemisphereLight
          args={['#b1e1ff', '#b97a20', 0.6]}
        />
        
        {/* Ambient light for baseline illumination */}
        <ambientLight intensity={0.8} />
        
        {/* Key light - main directional light from upper-right */}
        <directionalLight 
          intensity={1.5} 
          position={[5, 8, 5]} 
        />
        
        {/* Fill light - softer light from opposite side to reduce harsh shadows */}
        <directionalLight 
          intensity={0.6} 
          position={[-5, 3, -3]} 
        />
        
        {/* Rim light - back light for edge definition */}
        <directionalLight 
          intensity={0.4} 
          position={[0, -2, -5]} 
        />
        
        {/* Interactive controls for rotation, zoom, and pan */}
        <OrbitControls
          ref={controlsRef}
          enableDamping={true}
          dampingFactor={0.05}
          minDistance={0.5}
          maxDistance={30}
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
          touches={{
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
        />
        
        {/* Render GLB model with Suspense fallback and error boundary */}
        {modelData && (
          <CanvasErrorBoundary onError={onLoadError}>
            <Suspense fallback={<LoadingIndicator />}>
              <Model 
                url={modelData} 
                onLoadSuccess={onLoadSuccess}
              />
            </Suspense>
          </CanvasErrorBoundary>
        )}
      </Canvas>
    </div>
  );
}
