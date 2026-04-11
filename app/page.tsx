'use client';

import { useState, useEffect, useCallback } from 'react';
import InputHandler from './components/InputHandler';
import ModelViewer from './components/ModelViewer';
import type { GenerationInput } from '@/types/3d-model';

/**
 * Creates a test GLB model in-browser using Three.js.
 * This allows testing the viewer without hitting the NVIDIA API.
 */
async function createTestModelBlob(): Promise<Blob> {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

  const scene = new THREE.Scene();

  // Main body - a chair seat
  const seatGeometry = new THREE.BoxGeometry(1, 0.15, 1);
  const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x2196f3, roughness: 0.4 });
  const seat = new THREE.Mesh(seatGeometry, seatMaterial);
  seat.position.set(0, 0.5, 0);
  scene.add(seat);

  // Chair back
  const backGeometry = new THREE.BoxGeometry(1, 0.8, 0.1);
  const backMaterial = new THREE.MeshStandardMaterial({ color: 0x1976d2, roughness: 0.4 });
  const back = new THREE.Mesh(backGeometry, backMaterial);
  back.position.set(0, 0.95, -0.45);
  scene.add(back);

  // Four legs
  const legGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.5);
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.6 });
  const legPositions: [number, number, number][] = [
    [-0.4, 0.25, -0.4],
    [0.4, 0.25, -0.4],
    [-0.4, 0.25, 0.4],
    [0.4, 0.25, 0.4],
  ];
  for (const [x, y, z] of legPositions) {
    const leg = new THREE.Mesh(legGeometry, legMaterial);
    leg.position.set(x, y, z);
    scene.add(leg);
  }

  // A sphere on the seat for visual interest
  const sphereGeometry = new THREE.SphereGeometry(0.15, 32, 32);
  const sphereMaterial = new THREE.MeshStandardMaterial({ color: 0xff9800, roughness: 0.3, metalness: 0.2 });
  const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
  sphere.position.set(0.2, 0.72, 0.1);
  scene.add(sphere);

  // Export as GLB
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(new Blob([result], { type: 'model/gltf-binary' }));
        } else {
          resolve(new Blob([JSON.stringify(result)], { type: 'application/json' }));
        }
      },
      (error) => reject(error),
      { binary: true }
    );
  });
}

export default function Home() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelData, setModelData] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);

  // Clean up object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (modelUrl) {
        URL.revokeObjectURL(modelUrl);
      }
    };
  }, [modelUrl]);

  // Helper to set a new model URL (revokes old one)
  const setNewModelUrl = useCallback((url: string) => {
    if (modelUrl) {
      URL.revokeObjectURL(modelUrl);
    }
    setModelUrl(url);
    setModelData(url);
  }, [modelUrl]);

  // Load a test model without hitting the API
  const handleLoadTestModel = async () => {
    setIsGenerating(true);
    try {
      const blob = await createTestModelBlob();
      const url = URL.createObjectURL(blob);
      setNewModelUrl(url);
      console.log('Test model loaded successfully');
    } catch (error) {
      console.error('Failed to create test model:', error);
      alert('Failed to create test model.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (input: GenerationInput) => {
    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate-model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: input.type,
          data: input.data,
        }),
      });

      const result = await response.json();

      if (result.success && result.model) {
        try {
          const binaryString = atob(result.model.data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          const blob = new Blob([bytes], { type: 'model/gltf-binary' });
          const url = URL.createObjectURL(blob);
          setNewModelUrl(url);
        } catch (parseError) {
          console.error('Failed to parse model data:', parseError);
          alert('Failed to process the generated model. Please try again.');
        }
      } else {
        const errorMessage = result.error?.message || 'Unknown error';
        const errorCode = result.error?.code || 'UNKNOWN';
        console.error('Generation failed:', result.error);
        alert(`Failed to generate model (${errorCode}): ${errorMessage}`);
      }
    } catch (error) {
      console.error('Error generating model:', error);
      alert('Failed to generate model. Please check the console for details.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-zinc-900 dark:to-black py-4 px-4 sm:py-8 sm:px-6">
      <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            3D Model Generator
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Generate 3D models from images or text descriptions
          </p>
        </header>

        <InputHandler onSubmit={handleSubmit} isLoading={isGenerating} />

        {/* Test Model Button - for viewer development without API calls */}
        <div className="mt-4 text-center">
          <button
            onClick={handleLoadTestModel}
            disabled={isGenerating}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-gray-300 rounded-md transition-colors"
          >
            🧪 Load Test Model (no API call)
          </button>
        </div>

        {/* 3D Model Viewer - Only show when model is loaded */}
        {modelData && (
          <div className="mt-8 mb-12">
            <ModelViewer 
              modelData={modelData}
              onLoadError={(error) => {
                console.error('Model load error:', error);
                alert('Failed to load 3D model. Please try again.');
                setModelData(null);
              }}
              onLoadSuccess={() => console.log('Model loaded successfully')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
