'use client';

import { useState } from 'react';
import InputHandler from './components/InputHandler';
import ModelViewer from './components/ModelViewer';
import type { GenerationInput } from '@/types/3d-model';

export default function Home() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [modelData, setModelData] = useState<string | null>(null);

  const handleSubmit = async (input: GenerationInput) => {
    setIsGenerating(true);
    try {
      // Call the API to generate the model
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
        // Convert the model data to a data URL for useGLTF
        const dataUrl = `data:model/gltf-binary;base64,${result.model.data}`;
        setModelData(dataUrl);
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-zinc-900 dark:to-black py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            3D Model Generator
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Generate 3D models from images or text descriptions
          </p>
        </header>

        <InputHandler onSubmit={handleSubmit} isLoading={isGenerating} />

        {/* 3D Model Viewer - Only show when model is loaded */}
        {modelData && (
          <div className="mt-8">
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
