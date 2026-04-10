import '@testing-library/jest-dom';

// Mock URL.createObjectURL for file preview tests
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();
