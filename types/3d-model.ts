// Type definitions for 3D Model Generator

// Input types
export type GenerationInput = 
  // fromText: the picture was made from a description (the words are in name)
  | { type: 'image'; data: string; preview?: string; name?: string; fromText?: boolean }
  | { type: 'text'; data: string };

// API Request/Response types
/** Image-to-3D models the app can switch between. Each runs on its own Modal GPU. */
export const ENGINES = {
  trellis2: { name: 'TRELLIS.2', reads: 'Meta DINOv3', env: 'MODAL_TRELLIS_URL' },
  trellis1: { name: 'TRELLIS v1', reads: 'DINOv2', env: 'MODAL_TRELLIS1_URL' },
  hunyuan: { name: 'Hunyuan3D-2.1', reads: 'Tencent', env: 'MODAL_HUNYUAN_URL' },
} as const;
export type Engine = keyof typeof ENGINES;

/** Picture makers for descriptions. The person checks the picture before any 3D GPU time. */
export const PICTURE_ENGINES = {
  zimage: { name: 'Z-Image Turbo', where: 'Alibaba, on Modal', wait: 'seconds when warm, a few minutes from cold', env: 'MODAL_ZIMAGE_URL' },
  flux: { name: 'FLUX.1 [dev]', where: 'Black Forest Labs, on NVIDIA', wait: 'usually under 30 s', env: 'NVIDIA_API_KEY' },
} as const;
export type PictureEngine = keyof typeof PICTURE_ENGINES;

export interface GenerateModelRequest {
  type: 'image' | 'text';
  data: string; // base64 image or text prompt
  quality?: 'draft' | 'high'; // TRELLIS.2 photos on Modal only
  engine?: Engine; // photos only; default trellis2
}

export interface GenerateModelResponse {
  success: boolean;
  model?: {
    data: string; // 3D model data (GLB format)
    format: 'glb';
  };
  error?: {
    message: string;
    code: string;
  };
}

// NVIDIA Trellis API types
export interface TrellisGenerationRequest {
  // Input (one of these required)
  image?: string; // base64 encoded image
  text?: string; // text prompt
  
  // Fixed parameters
  slat_cfg_scale: 3;
  ss_cfg_scale: 7.5;
  slat_sampling_steps: 25;
  ss_sampling_steps: 25;
  seed: 0;
}

export interface TrellisAPIResponse {
  // Success response
  model?: {
    data: string; // Base64 encoded GLB file
    format: 'glb';
  };
  
  // Error response
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// Model data types
export interface ModelData {
  data: string; // GLB format model data
  metadata?: {
    generatedAt: string;
    inputType: 'image' | 'text';
  };
}

// History types
export interface HistoryItem {
  id: string;
  timestamp: number;
  inputType: 'image' | 'text';
  inputData: string; // original input
  modelData: string; // GLB data
  thumbnail?: string; // base64 image thumbnail
}

export interface StoredHistory {
  version: 1;
  items: HistoryItem[];
  lastUpdated: number;
}

// Component prop types
export interface InputHandlerProps {
  onSubmit: (input: GenerationInput) => Promise<void>;
  isLoading: boolean;
}

export interface ModelViewerProps {
  modelData: string | null; // GLB data URL
  onLoadError?: (error: Error) => void;
  onLoadSuccess?: () => void;
}

// Application state
export interface AppState {
  currentModel: string | null;
  isGenerating: boolean;
  error: string | null;
  retryCount: number;
  lastInput: GenerationInput | null;
  selectedHistoryId: string | null;
}

// 3D Scene configuration
export interface SceneConfig {
  camera: {
    position: [number, number, number];
    fov: number;
  };
  lights: {
    ambient: { intensity: number };
    directional: { 
      intensity: number;
      position: [number, number, number];
    };
  };
  controls: {
    enableDamping: boolean;
    dampingFactor: number;
    minDistance: number;
    maxDistance: number;
  };
}
