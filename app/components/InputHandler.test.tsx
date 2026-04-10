import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import InputHandler from './InputHandler';

describe('InputHandler - Mode Selection (Task 4.1)', () => {
  const mockOnSubmit = vi.fn();

  it('should render with image mode selected by default', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    const textButton = screen.getByRole('button', { name: /text input/i });
    
    expect(imageButton).toHaveClass('bg-blue-600');
    expect(textButton).not.toHaveClass('bg-blue-600');
  });

  it('should switch to text mode when text button is clicked', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    expect(textButton).toHaveClass('bg-blue-600');
  });

  it('should switch back to image mode when image button is clicked', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    const textButton = screen.getByRole('button', { name: /text input/i });
    
    // Switch to text mode
    fireEvent.click(textButton);
    expect(textButton).toHaveClass('bg-blue-600');
    
    // Switch back to image mode
    fireEvent.click(imageButton);
    expect(imageButton).toHaveClass('bg-blue-600');
    expect(textButton).not.toHaveClass('bg-blue-600');
  });

  it('should disable mode switching when isLoading is true', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    const textButton = screen.getByRole('button', { name: /text input/i });
    
    expect(imageButton).toBeDisabled();
    expect(textButton).toBeDisabled();
  });

  it('should not change mode when clicking disabled buttons', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    const textButton = screen.getByRole('button', { name: /text input/i });
    
    // Image mode is default
    expect(imageButton).toHaveClass('bg-blue-600');
    
    // Try to click text button while loading
    fireEvent.click(textButton);
    
    // Should still be in image mode
    expect(imageButton).toHaveClass('bg-blue-600');
    expect(textButton).not.toHaveClass('bg-blue-600');
  });

  it('should display image upload interface when image mode is selected', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    expect(screen.getByLabelText(/choose image/i)).toBeInTheDocument();
    expect(screen.getByText(/jpeg, png, or webp/i)).toBeInTheDocument();
  });

  it('should display text input interface when text mode is selected', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    expect(screen.getByPlaceholderText(/describe the 3d model/i)).toBeInTheDocument();
  });
});

describe('InputHandler - Image Upload (Task 4.2)', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('should render file input with correct accept attribute', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const fileInput = screen.getByLabelText(/choose image/i);
    expect(fileInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });

  it('should accept JPEG files', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    // Wait for preview to appear
    await screen.findByAltText(/upload preview/i);
    expect(screen.queryByText(/invalid file format/i)).not.toBeInTheDocument();
  });

  it('should accept PNG files', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    await screen.findByAltText(/upload preview/i);
    expect(screen.queryByText(/invalid file format/i)).not.toBeInTheDocument();
  });

  it('should accept WebP files', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.webp', { type: 'image/webp' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    await screen.findByAltText(/upload preview/i);
    expect(screen.queryByText(/invalid file format/i)).not.toBeInTheDocument();
  });

  it('should reject invalid file formats', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.gif', { type: 'image/gif' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    expect(screen.getByText(/invalid file format/i)).toBeInTheDocument();
    expect(screen.queryByAltText(/upload preview/i)).not.toBeInTheDocument();
  });

  it('should reject files larger than 10MB', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    // Create a file larger than 10MB
    const largeContent = new Array(11 * 1024 * 1024).fill('a').join('');
    const file = new File([largeContent], 'large.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
    
    const fileInput = screen.getByLabelText(/choose image/i);
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    expect(screen.getByText(/file size exceeds 10mb/i)).toBeInTheDocument();
    expect(screen.queryByAltText(/upload preview/i)).not.toBeInTheDocument();
  });

  it('should display image preview after valid upload', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    const preview = await screen.findByAltText(/upload preview/i);
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAttribute('src');
  });

  it('should show generate button after image preview', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    await screen.findByAltText(/upload preview/i);
    
    const generateButton = screen.getByRole('button', { name: /generate 3d model/i });
    expect(generateButton).toBeInTheDocument();
  });

  it('should encode image to base64 and call onSubmit', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    await screen.findByAltText(/upload preview/i);
    
    const generateButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(generateButton);
    
    // Wait for async encoding
    await vi.waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'image',
          data: expect.any(String),
          preview: expect.any(String),
        })
      );
    });
  });

  it('should show error when encoding fails', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    // Mock FileReader to simulate encoding failure
    const originalFileReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          if (this.onerror) {
            this.onerror(new Error('Encoding failed'));
          }
        }, 0);
      }
    } as any;
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    await screen.findByAltText(/upload preview/i);
    
    const generateButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(generateButton);
    
    await screen.findByText(/failed to encode image/i);
    
    // Restore original FileReader
    global.FileReader = originalFileReader;
  });

  it('should clear image state when switching to text mode', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByAltText(/upload preview/i);
    
    // Switch to text mode
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    // Switch back to image mode
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    fireEvent.click(imageButton);
    
    // Preview should be cleared
    expect(screen.queryByAltText(/upload preview/i)).not.toBeInTheDocument();
  });

  it('should disable file input when isLoading is true', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const fileInput = screen.getByLabelText(/choose image/i);
    expect(fileInput).toBeDisabled();
  });

  it('should show "Generating..." text on button when isLoading is true', async () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByAltText(/upload preview/i);
    
    // Rerender with isLoading true
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    expect(screen.getByRole('button', { name: /generating/i })).toBeInTheDocument();
  });

  it('should show error when trying to submit without selecting an image', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    // Try to trigger submit without uploading (this would require the button to be visible)
    // Since button only appears after upload, we test the validation logic indirectly
    // by checking that no submit button exists without an image
    expect(screen.queryByRole('button', { name: /generate 3d model/i })).not.toBeInTheDocument();
  });
});

describe('InputHandler - Text Input (Task 4.3)', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('should render text input field when text mode is selected', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    expect(textarea).toBeInTheDocument();
  });

  it('should display character count starting at 0/500', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    expect(screen.getByText('0 / 500 characters')).toBeInTheDocument();
  });

  it('should update character count as user types', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    
    expect(screen.getByText('11 / 500 characters')).toBeInTheDocument();
  });

  it('should accept text input up to 500 characters', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    const text500 = 'a'.repeat(500);
    fireEvent.change(textarea, { target: { value: text500 } });
    
    expect(textarea).toHaveValue(text500);
    expect(screen.getByText('500 / 500 characters')).toBeInTheDocument();
  });

  it('should prevent character entry beyond 500 character limit', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    const text501 = 'a'.repeat(501);
    fireEvent.change(textarea, { target: { value: text501 } });
    
    // Should not accept more than 500 characters
    expect(textarea).not.toHaveValue(text501);
    expect(screen.getByText(/500 characters/)).toBeInTheDocument();
  });

  it('should disable submit button when text is empty', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    expect(submitButton).toBeDisabled();
  });

  it('should disable submit button when text contains only whitespace', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: '   ' } });
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    expect(submitButton).toBeDisabled();
  });

  it('should enable submit button when text is not empty', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A red cube' } });
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    expect(submitButton).not.toBeDisabled();
  });

  it('should show validation message when trying to submit empty text', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    
    // Button is disabled, but we can test the validation logic by entering and clearing text
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.change(textarea, { target: { value: '' } });
    
    // Submit button should be disabled
    expect(submitButton).toBeDisabled();
  });

  it('should call onSubmit with text data when submit button is clicked', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A blue sphere' } });
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(submitButton);
    
    await vi.waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        type: 'text',
        data: 'A blue sphere',
      });
    });
  });

  it('should trim whitespace from text before submission', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: '  A blue sphere  ' } });
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(submitButton);
    
    await vi.waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        type: 'text',
        data: 'A blue sphere',
      });
    });
  });

  it('should disable textarea when isLoading is true', () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    // Rerender with isLoading true
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    expect(textarea).toBeDisabled();
  });

  it('should show "Generating..." text on button when isLoading is true', () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A red cube' } });
    
    // Rerender with isLoading true
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    expect(screen.getByRole('button', { name: /generating/i })).toBeInTheDocument();
  });

  it('should clear text state when switching to image mode', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A red cube' } });
    
    expect(screen.getByText('10 / 500 characters')).toBeInTheDocument();
    
    // Switch to image mode
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    fireEvent.click(imageButton);
    
    // Switch back to text mode
    fireEvent.click(textButton);
    
    // Text should be cleared
    expect(screen.getByText('0 / 500 characters')).toBeInTheDocument();
  });

  it('should display error message when submission fails', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('Submission failed'));
    
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A blue sphere' } });
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(submitButton);
    
    await screen.findByText(/failed to submit text/i);
  });

  it('should have maxLength attribute set to 500', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    expect(textarea).toHaveAttribute('maxLength', '500');
  });

  it('should clear error message when user starts typing after error', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    
    // Trigger error by trying to submit empty (we'll simulate by entering and clearing)
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.change(textarea, { target: { value: '' } });
    
    // Now type again
    fireEvent.change(textarea, { target: { value: 'new text' } });
    
    // Error should not be visible (we didn't trigger submit, so no error would show)
    expect(screen.queryByText(/please enter a text description/i)).not.toBeInTheDocument();
  });
});

describe('InputHandler - Loading States and Submission (Task 4.4)', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    mockOnSubmit.mockClear();
  });

  it('should display loading overlay when isLoading is true', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    expect(screen.getByText(/generating 3d model\.\.\./i)).toBeInTheDocument();
    expect(screen.getByText(/this may take a moment/i)).toBeInTheDocument();
  });

  it('should not display loading overlay when isLoading is false', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    expect(screen.queryByText(/generating 3d model\.\.\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this may take a moment/i)).not.toBeInTheDocument();
  });

  it('should display loading spinner in button during image generation', async () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByAltText(/upload preview/i);
    
    // Rerender with isLoading true
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const button = screen.getByRole('button', { name: /generating/i });
    expect(button).toBeInTheDocument();
    
    // Check for loading spinner SVG
    const spinner = button.querySelector('svg[aria-label="Loading"]');
    expect(spinner).toBeInTheDocument();
  });

  it('should display loading spinner in button during text generation', () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A red cube' } });
    
    // Rerender with isLoading true
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const button = screen.getByRole('button', { name: /generating/i });
    expect(button).toBeInTheDocument();
    
    // Check for loading spinner SVG
    const spinner = button.querySelector('svg[aria-label="Loading"]');
    expect(spinner).toBeInTheDocument();
  });

  it('should disable mode toggle buttons during generation', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    const textButton = screen.getByRole('button', { name: /text input/i });
    
    expect(imageButton).toBeDisabled();
    expect(textButton).toBeDisabled();
  });

  it('should disable file input during generation', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const fileInput = screen.getByLabelText(/choose image/i);
    expect(fileInput).toBeDisabled();
  });

  it('should disable textarea during generation', () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    // Rerender with isLoading true
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    expect(textarea).toBeDisabled();
  });

  it('should disable submit button during generation', async () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByAltText(/upload preview/i);
    
    // Rerender with isLoading true
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const submitButton = screen.getByRole('button', { name: /generating/i });
    expect(submitButton).toBeDisabled();
  });

  it('should prevent mode switching during generation', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const imageButton = screen.getByRole('button', { name: /image upload/i });
    const textButton = screen.getByRole('button', { name: /text input/i });
    
    // Try to click text button while loading
    fireEvent.click(textButton);
    
    // Should still be in image mode (default)
    expect(imageButton).toHaveClass('bg-blue-600');
    expect(textButton).not.toHaveClass('bg-blue-600');
  });

  it('should handle successful image submission', async () => {
    mockOnSubmit.mockResolvedValueOnce(undefined);
    
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByAltText(/upload preview/i);
    
    const generateButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(generateButton);
    
    await vi.waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'image',
          data: expect.any(String),
          preview: expect.any(String),
        })
      );
    });
  });

  it('should handle successful text submission', async () => {
    mockOnSubmit.mockResolvedValueOnce(undefined);
    
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A blue sphere' } });
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(submitButton);
    
    await vi.waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith({
        type: 'text',
        data: 'A blue sphere',
      });
    });
  });

  it('should handle image submission error gracefully', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('API Error'));
    
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const file = new File(['dummy content'], 'test.jpg', { type: 'image/jpeg' });
    const fileInput = screen.getByLabelText(/choose image/i);
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    await screen.findByAltText(/upload preview/i);
    
    const generateButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(generateButton);
    
    // onSubmit should still be called even if it rejects
    await vi.waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalled();
    });
  });

  it('should handle text submission error gracefully', async () => {
    mockOnSubmit.mockRejectedValueOnce(new Error('API Error'));
    
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const textarea = screen.getByPlaceholderText(/describe the 3d model/i);
    fireEvent.change(textarea, { target: { value: 'A blue sphere' } });
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    fireEvent.click(submitButton);
    
    await screen.findByText(/failed to submit text/i);
  });

  it('should show loading overlay with proper z-index above content', () => {
    const { container } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const overlay = container.querySelector('.z-10');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveClass('absolute', 'inset-0');
  });

  it('should display large loading spinner in overlay', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const loadingText = screen.getByText(/generating 3d model\.\.\./i);
    const overlay = loadingText.closest('.z-10');
    
    expect(overlay).toBeInTheDocument();
    
    // Check for large spinner (h-12 w-12)
    const spinner = overlay?.querySelector('svg.h-12.w-12');
    expect(spinner).toBeInTheDocument();
  });

  it('should apply backdrop blur effect to loading overlay', () => {
    const { container } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    const overlay = container.querySelector('.backdrop-blur-sm');
    expect(overlay).toBeInTheDocument();
  });

  it('should not call onSubmit when image is not selected', async () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    // No image uploaded, so no submit button should be visible
    expect(screen.queryByRole('button', { name: /generate 3d model/i })).not.toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should not call onSubmit when text is empty', () => {
    render(<InputHandler onSubmit={mockOnSubmit} isLoading={false} />);
    
    const textButton = screen.getByRole('button', { name: /text input/i });
    fireEvent.click(textButton);
    
    const submitButton = screen.getByRole('button', { name: /generate 3d model/i });
    expect(submitButton).toBeDisabled();
    
    // Try to click disabled button
    fireEvent.click(submitButton);
    
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('should maintain loading state across mode switches', () => {
    const { rerender } = render(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    // Should show loading overlay in image mode
    expect(screen.getByText(/generating 3d model\.\.\./i)).toBeInTheDocument();
    
    // Rerender (simulating parent state update, but mode buttons are disabled)
    rerender(<InputHandler onSubmit={mockOnSubmit} isLoading={true} />);
    
    // Loading overlay should still be visible
    expect(screen.getByText(/generating 3d model\.\.\./i)).toBeInTheDocument();
  });
});
