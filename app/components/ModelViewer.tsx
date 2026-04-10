'use client';

import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls } from '@react-three/drei';
import { ModelViewerProps } from '@/types/3d-model';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

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
  const animationFrameRef = useRef<number>();

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
 * Model Component
 * 
 * Loads and renders a GLB model using the useGLTF hook.
 * Automatically fits the model within viewport boundaries.
 */
function Model({ 
  url, 
  onLoadError, 
  onLoadSuccess 
}: { 
  url: string; 
  onLoadError?: (error: Error) => void; 
  onLoadSuccess?: () => void; 
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hasError, setHasError] = useState(false);
  
  // Load GLB model using useGLTF hook with error handling
  const gltf = useGLTF(url, undefined, undefined, (error) => {
    console.error('Error loading GLB model:', error);
    setHasError(true);
    if (onLoadError) {
      onLoadError(error instanceof Error ? error : new Error('Failed to load model'));
    }
  });

  // Fit model within viewport boundaries and call success callback
  useEffect(() => {
    if (gltf && gltf.scene && groupRef.current && !hasError) {
      try {
        const box = new THREE.Box3().setFromObject(groupRef.current);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        // Calculate scale to fit model in viewport
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = maxDim > 0 ? 2 / maxDim : 1;
        
        // Apply scale and center the model
        groupRef.current.scale.setScalar(scale);
        groupRef.current.position.sub(center.multiplyScalar(scale));
        
        // Call success callback
        if (onLoadSuccess) {
          onLoadSuccess();
        }
      } catch (error) {
        // If fitting fails, still call success but log the error
        console.warn('Failed to fit model in viewport:', error);
        if (onLoadSuccess) {
          onLoadSuccess();
        }
      }
    }
  }, [gltf, onLoadSuccess, hasError]);

  // Don't render if there was an error
  if (hasError || !gltf || !gltf.scene) {
    return null;
  }

  return (
    <group ref={groupRef}>
      <primitive object={gltf.scene} />
    </group>
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
  const defaultCameraPosition = new THREE.Vector3(5, 5, 5);
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
    <div className="w-full h-full min-h-[400px] bg-gray-900 rounded-lg overflow-hidden relative">
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
        camera={{
          position: [5, 5, 5],
          fov: 50,
        }}
        dpr={[1, 2]} // Adaptive pixel ratio for performance
        performance={{ min: 0.5 }} // Allow quality reduction if needed
      >
        {/* Ambient light for overall scene illumination */}
        <ambientLight intensity={0.5} />
        
        {/* Directional light for shadows and depth */}
        <directionalLight 
          intensity={1} 
          position={[10, 10, 5]} 
        />
        
        {/* Interactive controls for rotation, zoom, and pan */}
        <OrbitControls
          ref={controlsRef}
          enableDamping={true}
          dampingFactor={0.05}
          minDistance={2}
          maxDistance={20}
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
        
        {/* Render GLB model when data is available */}
        {modelData && (
          <Model 
            url={modelData} 
            onLoadError={onLoadError}
            onLoadSuccess={onLoadSuccess}
          />
        )}
      </Canvas>
    </div>
  );
}
