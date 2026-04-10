'use client';

import { useState } from 'react';
import type { GenerationInput } from '@/types/3d-model';

interface InputHandlerProps {
  onSubmit: (input: GenerationInput) => Promise<void>;
  isLoading: boolean;
}

// Loading spinner component
function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-label="Loading"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

type InputMode = 'image' | 'text';

export default function InputHandler({ onSubmit, isLoading }: InputHandlerProps) {
  const [mode, setMode] = useState<InputMode>('image');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState<string>('');
  const [textError, setTextError] = useState<string | null>(null);

  const MAX_TEXT_LENGTH = 500;

  const handleModeChange = (newMode: InputMode) => {
    if (!isLoading) {
      setMode(newMode);
      // Clear errors when switching modes
      setImageError(null);
      setTextError(null);
    }
  };

  const handleExampleSelect = async (id: number) => {
    if (isLoading) return;
    
    // For example images, we use the specific data format the API expects
    const exampleData = `data:image/png;example_id,${id}`;
    
    // We don't have the actual image to preview, so we'll use a placeholder or 
    // just set the state to indicate an example is selected
    setImageFile(null);
    setImagePreview(null);
    
    await onSubmit({
      type: 'image',
      data: exampleData,
      preview: undefined, // No local preview for example IDs
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setImageError(null);

    if (!file) {
      setImageFile(null);
      setImagePreview(null);
      return;
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setImageError('Invalid file format. Please upload a JPEG, PNG, or WebP image.');
      setImageFile(null);
      setImagePreview(null);
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
      setImageError('File size exceeds 10MB limit. Please upload a smaller image.');
      setImageFile(null);
      setImagePreview(null);
      return;
    }

    // Create preview
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
    setImageFile(file);
  };

  const encodeImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix to get pure base64
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => {
        reject(new Error('Failed to encode image'));
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageSubmit = async () => {
    if (!imageFile || !imagePreview) {
      setImageError('Please select an image to upload.');
      return;
    }

    try {
      const base64Data = await encodeImageToBase64(imageFile);
      await onSubmit({
        type: 'image',
        data: base64Data,
        preview: imagePreview,
      });
    } catch (error) {
      setImageError('Failed to encode image. Please try again.');
    }
  };

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = event.target.value;
    
    // Prevent entry beyond character limit
    if (newText.length <= MAX_TEXT_LENGTH) {
      setTextInput(newText);
      setTextError(null);
    }
  };

  const handleTextSubmit = async () => {
    // Validate text is not empty
    if (textInput.trim().length === 0) {
      setTextError('Please enter a text description.');
      return;
    }

    try {
      await onSubmit({
        type: 'text',
        data: textInput.trim(),
      });
    } catch (error) {
      setTextError('Failed to submit text. Please try again.');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white dark:bg-zinc-900 rounded-lg shadow-lg relative">
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm rounded-lg z-10 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12">
              <svg
                className="animate-spin h-12 w-12 text-blue-600"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-label="Loading"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
            <p className="text-lg font-medium text-gray-900 dark:text-white">
              Generating 3D Model...
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This may take a moment
            </p>
          </div>
        </div>
      )}

      {/* Mode Toggle */}
      <div className="flex mb-6 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
        <button
          onClick={() => handleModeChange('image')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
            mode === 'image'
              ? 'bg-white dark:bg-zinc-700 shadow-sm text-blue-600 dark:text-blue-400'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          Image to 3D
        </button>
        <button
          onClick={() => handleModeChange('text')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
            mode === 'text'
              ? 'bg-white dark:bg-zinc-700 shadow-sm text-blue-600 dark:text-blue-400'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          Text to 3D
        </button>
      </div>

      {/* Info banner */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          {mode === 'image' ? (
            <>
              <strong>Preview API Limitation:</strong> Custom image uploads are currently restricted by NVIDIA. 
              Please use the <strong>Example Images</strong> below to test the generation.
            </>
          ) : (
            <>
              <strong>Text to 3D:</strong> Enter a descriptive prompt below to generate a unique 3D model.
            </>
          )}
        </p>
      </div>

      {/* Input Interface - conditionally rendered based on mode */}
      <div className="min-h-[200px]">
        {mode === 'image' ? (
          <div className="space-y-4">
            {/* File Input */}
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
              <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
                  Try Example Images (Supported)
                </h3>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((id) => (
                  <button
                    key={id}
                    onClick={() => handleExampleSelect(id)}
                    disabled={isLoading}
                    className="group relative aspect-square bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden border-2 border-transparent hover:border-blue-500 transition-all flex flex-col items-center justify-center gap-2"
                  >
                    <div className="text-2xl opacity-50 group-hover:scale-110 transition-transform">
                      {['🤖', ' chair', '🪴', '👟'][id] || '🖼️'}
                    </div>
                    <span className="text-xs font-medium text-zinc-500">Example {id}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-zinc-200 dark:border-zinc-800"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white dark:bg-zinc-900 px-2 text-zinc-400">or upload (limited)</span>
              </div>
            </div>

            <div className="border-2 border-dashed border-gray-300 dark:border-zinc-700 rounded-lg p-6 text-center opacity-60">
              <input
                type="file"
                id="image-upload"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageUpload}
                disabled={isLoading}
                className="hidden"
              />
              <label
                htmlFor="image-upload"
                className={`inline-block px-4 py-2 bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-md text-sm font-medium cursor-pointer hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors ${
                  isLoading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                Upload File
              </label>
            </div>

            {/* Error Message */}
            {imageError && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                {imageError}
              </div>
            )}

            {/* Image Preview */}
            {imagePreview && (
              <div className="space-y-4 pt-2">
                <div className="border border-gray-200 dark:border-zinc-700 rounded-lg p-4 bg-zinc-50 dark:bg-zinc-800/30">
                  <img
                    src={imagePreview}
                    alt="Upload preview"
                    className="max-w-full max-h-48 mx-auto rounded shadow-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleImageSubmit}
                  disabled={isLoading}
                  className={`w-full py-3 px-6 bg-blue-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                    isLoading
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-blue-700'
                  }`}
                >
                  {isLoading && <LoadingSpinner />}
                  {isLoading ? 'Generating...' : 'Attempt Custom Generation'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Text Input Area */}
            <div>
              <textarea
                value={textInput}
                onChange={handleTextChange}
                disabled={isLoading}
                placeholder="Describe the 3D model you want to generate..."
                className={`w-full min-h-[200px] p-4 border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-white ${
                  isLoading ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                maxLength={MAX_TEXT_LENGTH}
              />
              
              {/* Character Count */}
              <div className="mt-2 text-sm text-right text-gray-500 dark:text-gray-400">
                {textInput.length} / {MAX_TEXT_LENGTH} characters
              </div>
            </div>

            {/* Error Message */}
            {textError && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
                {textError}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="button"
              onClick={handleTextSubmit}
              disabled={isLoading || textInput.trim().length === 0}
              className={`w-full py-3 px-6 bg-green-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                isLoading || textInput.trim().length === 0
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-green-700'
              }`}
            >
              {isLoading && <LoadingSpinner />}
              {isLoading ? 'Generating...' : 'Generate 3D Model'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
