import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { forwardRef } from 'react';
import ModelViewer from './ModelViewer';

// Mock Three.js Box3 and Vector3
vi.mock('three', async () => {
  const actual = await vi.importActual('three');
  
  function MockVector3(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.clone = function() {
      return new MockVector3(this.x, this.y, this.z);
    };
    this.multiplyScalar = function(scalar) {
      this.x *= scalar;
      this.y *= scalar;
      this.z *= scalar;
      return this;
    };
    this.lerpVectors = function(v1, v2, alpha) {
      this.x = v1.x + (v2.x - v1.x) * alpha;
      this.y = v1.y + (v2.y - v1.y) * alpha;
      this.z = v1.z + (v2.z - v1.z) * alpha;
      return this;
    };
  }
  
  function MockBox3() {
    this.setFromObject = function() { return this; };
    this.getSize = function() { return { x: 1, y: 1, z: 1 }; };
    this.getCenter = function() { return { x: 0, y: 0, z: 0 }; };
  }
  
  return {
    ...actual,
    Box3: MockBox3,
    Vector3: MockVector3,
  };
});

// Mock GLTF data
const mockGLTFScene = {
  scene: {
    type: 'Group',
    children: [],
  },
};

// Mock useGLTF hook
const mockUseGLTF = vi.fn();

// Mock React Three Fiber Canvas component
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, camera }: { children: React.ReactNode; camera: { position: number[]; fov: number } }) => (
    <div data-testid="canvas" data-camera-position={JSON.stringify(camera.position)} data-camera-fov={camera.fov}>
      {children}
    </div>
  ),
}));

// Mock @react-three/drei
vi.mock('@react-three/drei', () => ({
  useGLTF: (url: string) => mockUseGLTF(url),
  OrbitControls: forwardRef(({ enableDamping, dampingFactor, minDistance, maxDistance, mouseButtons, touches }: {
    enableDamping: boolean;
    dampingFactor: number;
    minDistance: number;
    maxDistance: number;
    mouseButtons: Record<string, number>;
    touches: Record<string, number>;
  }, ref: any) => {
    // Expose mock controls object through ref
    if (ref) {
      const mockControls = {
        object: {
          position: {
            x: 5,
            y: 5,
            z: 5,
            clone: function() {
              return { x: this.x, y: this.y, z: this.z, clone: this.clone };
            },
            lerpVectors: function(v1: any, v2: any, alpha: number) {
              this.x = v1.x + (v2.x - v1.x) * alpha;
              this.y = v1.y + (v2.y - v1.y) * alpha;
              this.z = v1.z + (v2.z - v1.z) * alpha;
              return this;
            },
          },
        },
        target: {
          x: 0,
          y: 0,
          z: 0,
          clone: function() {
            return { x: this.x, y: this.y, z: this.z, clone: this.clone, lerpVectors: this.lerpVectors };
          },
          lerpVectors: function(v1: any, v2: any, alpha: number) {
            this.x = v1.x + (v2.x - v1.x) * alpha;
            this.y = v1.y + (v2.y - v1.y) * alpha;
            this.z = v1.z + (v2.z - v1.z) * alpha;
            return this;
          },
        },
        update: vi.fn(),
      };
      if (typeof ref === 'function') {
        ref(mockControls);
      } else {
        ref.current = mockControls;
      }
    }
    
    return (
      <div 
        data-testid="orbit-controls"
        data-enable-damping={enableDamping}
        data-damping-factor={dampingFactor}
        data-min-distance={minDistance}
        data-max-distance={maxDistance}
        data-mouse-buttons={JSON.stringify(mouseButtons)}
        data-touches={JSON.stringify(touches)}
      />
    );
  }),
}));

describe('ModelViewer - Scene Setup (Task 5.1)', () => {
  beforeEach(() => {
    mockUseGLTF.mockClear();
  });
  describe('Camera Configuration', () => {
    it('configures camera with correct position [5, 5, 5]', () => {
      render(<ModelViewer modelData={null} />);
      
      const canvas = screen.getByTestId('canvas');
      expect(canvas.getAttribute('data-camera-position')).toBe('[5,5,5]');
    });

    it('configures camera with correct field of view (50 degrees)', () => {
      render(<ModelViewer modelData={null} />);
      
      const canvas = screen.getByTestId('canvas');
      expect(canvas.getAttribute('data-camera-fov')).toBe('50');
    });
  });

  describe('Scene Rendering', () => {
    it('renders canvas element', () => {
      render(<ModelViewer modelData={null} />);
      expect(screen.getByTestId('canvas')).toBeInTheDocument();
    });

    it('renders without model data', () => {
      const { container } = render(<ModelViewer modelData={null} />);
      expect(container.querySelector('[data-testid="canvas"]')).toBeInTheDocument();
    });
  });

  describe('Callback Props', () => {
    it('accepts onLoadError callback without calling it on initial render', () => {
      const onLoadError = vi.fn();
      render(<ModelViewer modelData={null} onLoadError={onLoadError} />);
      expect(onLoadError).not.toHaveBeenCalled();
    });

    it('accepts onLoadSuccess callback without calling it on initial render', () => {
      const onLoadSuccess = vi.fn();
      render(<ModelViewer modelData={null} onLoadSuccess={onLoadSuccess} />);
      expect(onLoadSuccess).not.toHaveBeenCalled();
    });
  });
});


describe('ModelViewer - GLB Loading (Task 5.2)', () => {
  beforeEach(() => {
    mockUseGLTF.mockClear();
  });

  describe('Model Loading', () => {
    it('calls useGLTF with modelData URL when modelData is provided', () => {
      const modelUrl = 'data:model/gltf-binary;base64,mockdata';
      mockUseGLTF.mockReturnValue(mockGLTFScene);
      
      render(<ModelViewer modelData={modelUrl} />);
      
      expect(mockUseGLTF).toHaveBeenCalledWith(modelUrl);
    });

    it('does not call useGLTF when modelData is null', () => {
      render(<ModelViewer modelData={null} />);
      
      expect(mockUseGLTF).not.toHaveBeenCalled();
    });

    it('renders model when GLB data loads successfully', () => {
      mockUseGLTF.mockReturnValue(mockGLTFScene);
      
      const { container } = render(
        <ModelViewer modelData="data:model/gltf-binary;base64,mockdata" />
      );
      
      expect(container.querySelector('[data-testid="canvas"]')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('calls onLoadError when model loading fails', () => {
      const onLoadError = vi.fn();
      const error = new Error('Failed to load GLB');
      mockUseGLTF.mockImplementation(() => {
        throw error;
      });
      
      render(
        <ModelViewer 
          modelData="data:model/gltf-binary;base64,invalid" 
          onLoadError={onLoadError}
        />
      );
      
      // Error callback should be called
      expect(onLoadError).toHaveBeenCalledWith(error);
    });

    it('handles non-Error exceptions during loading', () => {
      const onLoadError = vi.fn();
      mockUseGLTF.mockImplementation(() => {
        throw 'String error';
      });
      
      render(
        <ModelViewer 
          modelData="data:model/gltf-binary;base64,invalid" 
          onLoadError={onLoadError}
        />
      );
      
      expect(onLoadError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Success Callback', () => {
    it('calls onLoadSuccess when model loads successfully', () => {
      const onLoadSuccess = vi.fn();
      mockUseGLTF.mockReturnValue(mockGLTFScene);
      
      render(
        <ModelViewer 
          modelData="data:model/gltf-binary;base64,mockdata" 
          onLoadSuccess={onLoadSuccess}
        />
      );
      
      // Success callback should be called after model is fitted
      expect(onLoadSuccess).toHaveBeenCalled();
    });
  });
});

describe('ModelViewer - Interactive Controls (Task 5.3)', () => {
  beforeEach(() => {
    mockUseGLTF.mockClear();
  });

  describe('OrbitControls Configuration', () => {
    it('renders OrbitControls component', () => {
      render(<ModelViewer modelData={null} />);
      expect(screen.getByTestId('orbit-controls')).toBeInTheDocument();
    });

    it('enables damping for smooth interactions', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      expect(controls.getAttribute('data-enable-damping')).toBe('true');
    });

    it('configures damping factor to 0.05', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      expect(controls.getAttribute('data-damping-factor')).toBe('0.05');
    });

    it('sets minimum zoom distance to 2', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      expect(controls.getAttribute('data-min-distance')).toBe('2');
    });

    it('sets maximum zoom distance to 20', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      expect(controls.getAttribute('data-max-distance')).toBe('20');
    });
  });

  describe('Mouse Controls', () => {
    it('configures left mouse button for rotation', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      const mouseButtons = JSON.parse(controls.getAttribute('data-mouse-buttons') || '{}');
      expect(mouseButtons.LEFT).toBe(0); // THREE.MOUSE.ROTATE = 0
    });

    it('configures middle mouse button for zoom', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      const mouseButtons = JSON.parse(controls.getAttribute('data-mouse-buttons') || '{}');
      expect(mouseButtons.MIDDLE).toBe(1); // THREE.MOUSE.DOLLY = 1
    });

    it('configures right mouse button for pan', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      const mouseButtons = JSON.parse(controls.getAttribute('data-mouse-buttons') || '{}');
      expect(mouseButtons.RIGHT).toBe(2); // THREE.MOUSE.PAN = 2
    });
  });

  describe('Touch Controls', () => {
    it('configures one-finger touch for rotation', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      const touches = JSON.parse(controls.getAttribute('data-touches') || '{}');
      expect(touches.ONE).toBe(0); // THREE.TOUCH.ROTATE = 0
    });

    it('configures two-finger touch for zoom and pan', () => {
      render(<ModelViewer modelData={null} />);
      const controls = screen.getByTestId('orbit-controls');
      const touches = JSON.parse(controls.getAttribute('data-touches') || '{}');
      expect(touches.TWO).toBe(2); // THREE.TOUCH.DOLLY_PAN = 2
    });
  });

  describe('Controls with Model Data', () => {
    it('renders OrbitControls when model is loaded', () => {
      mockUseGLTF.mockReturnValue(mockGLTFScene);
      render(<ModelViewer modelData="data:model/gltf-binary;base64,mockdata" />);
      expect(screen.getByTestId('orbit-controls')).toBeInTheDocument();
    });

    it('maintains control configuration with model present', () => {
      mockUseGLTF.mockReturnValue(mockGLTFScene);
      render(<ModelViewer modelData="data:model/gltf-binary;base64,mockdata" />);
      
      const controls = screen.getByTestId('orbit-controls');
      expect(controls.getAttribute('data-enable-damping')).toBe('true');
      expect(controls.getAttribute('data-min-distance')).toBe('2');
      expect(controls.getAttribute('data-max-distance')).toBe('20');
    });
  });
});

describe('ModelViewer - View Reset (Task 5.4)', () => {
  beforeEach(() => {
    mockUseGLTF.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Reset Button', () => {
    it('renders reset button', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      expect(resetButton).toBeInTheDocument();
    });

    it('reset button displays "Reset View" text', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      expect(resetButton).toHaveTextContent('Reset View');
    });

    it('reset button has proper ARIA label', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      expect(resetButton).toHaveAttribute('aria-label', 'Reset camera view to default position');
    });

    it('reset button is positioned in top-right corner', () => {
      const { container } = render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      expect(resetButton.className).toContain('absolute');
      expect(resetButton.className).toContain('top-4');
      expect(resetButton.className).toContain('right-4');
    });

    it('reset button is enabled by default', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      expect(resetButton).not.toBeDisabled();
    });
  });

  describe('Reset Functionality', () => {
    it('disables button during reset animation', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      
      fireEvent.click(resetButton);
      
      expect(resetButton).toBeDisabled();
    });

    it('re-enables button after reset animation completes', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      
      fireEvent.click(resetButton);
      expect(resetButton).toBeDisabled();
      
      // Fast-forward through animation (1000ms) and animation frames
      act(() => {
        // Advance time in small increments to allow requestAnimationFrame to execute
        const steps = 20;
        const stepTime = 1000 / steps;
        for (let i = 0; i < steps; i++) {
          vi.advanceTimersByTime(stepTime);
        }
        // Advance a bit more to ensure completion
        vi.advanceTimersByTime(100);
      });
      
      expect(resetButton).not.toBeDisabled();
    });

    it('handles reset when controls ref is not available', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      
      // Should not throw error
      fireEvent.click(resetButton);
      expect(resetButton).toBeInTheDocument();
    });
  });

  describe('Reset with Model', () => {
    it('reset button works when model is loaded', () => {
      mockUseGLTF.mockReturnValue(mockGLTFScene);
      render(<ModelViewer modelData="data:model/gltf-binary;base64,mockdata" />);
      
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      fireEvent.click(resetButton);
      
      expect(resetButton).toBeDisabled();
    });

    it('maintains model visibility during reset', () => {
      mockUseGLTF.mockReturnValue(mockGLTFScene);
      render(<ModelViewer modelData="data:model/gltf-binary;base64,mockdata" />);
      
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      fireEvent.click(resetButton);
      
      // Model should still be rendered
      expect(screen.getByTestId('canvas')).toBeInTheDocument();
    });
  });

  describe('Visual Styling', () => {
    it('applies correct styling classes to reset button', () => {
      render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      
      expect(resetButton.className).toContain('bg-gray-800');
      expect(resetButton.className).toContain('hover:bg-gray-700');
      expect(resetButton.className).toContain('text-white');
      expect(resetButton.className).toContain('rounded-md');
      expect(resetButton.className).toContain('shadow-lg');
    });

    it('includes reset icon in button', () => {
      const { container } = render(<ModelViewer modelData={null} />);
      const resetButton = screen.getByRole('button', { name: /reset camera view/i });
      const svg = resetButton.querySelector('svg');
      
      expect(svg).toBeInTheDocument();
    });
  });
});
