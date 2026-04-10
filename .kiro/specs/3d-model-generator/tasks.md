# Implementation Plan: 3D Model Generator

## Overview

This implementation plan breaks down the 3D Model Generator feature into discrete coding tasks. The feature integrates NVIDIA's Trellis API to generate 3D models from images or text, displays them using React Three Fiber, and maintains generation history in browser storage.

The implementation follows a layered approach: first establishing the API integration layer, then building the UI components, and finally adding interactive 3D visualization and history management.

## Tasks

- [x] 1. Set up project dependencies and environment configuration
  - Install required packages: @react-three/fiber, @react-three/drei, three
  - Create .env.local file with NVIDIA_API_KEY placeholder
  - Add TypeScript type definitions for 3D model data structures
  - _Requirements: 4.1, 4.2_

- [ ] 2. Implement API route for NVIDIA Trellis integration
  - [x] 2.1 Create API route handler at /api/generate-model
    - Implement POST endpoint with request validation
    - Add Bearer token authentication using NVIDIA_API_KEY
    - Handle both image and text input types
    - _Requirements: 4.1, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4_
  
  - [x] 2.2 Implement NVIDIA API client logic
    - Create fetch request to Trellis API endpoint
    - Set fixed generation parameters (slat_cfg_scale: 3, ss_cfg_scale: 7.5, etc.)
    - Parse and return GLB model data from response
    - _Requirements: 5.1, 5.4, 6.1_
  
  - [x] 2.3 Add comprehensive error handling
    - Handle authentication errors (missing/invalid API key)
    - Handle network errors and timeouts (60s timeout)
    - Handle API error responses with descriptive messages
    - Add server-side error logging
    - _Requirements: 4.2, 6.2, 6.3, 6.4, 6.5_
  
- [ ] 3. Checkpoint - Verify API integration
  - Ask the user if questions arise.

- [ ] 4. Create Input Handler component
  - [x] 4.1 Implement mode selection UI
    - Create toggle between image upload and text input modes
    - Display appropriate input interface based on selected mode
    - Allow mode switching before submission
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [x] 4.2 Implement image upload functionality
    - Accept JPEG, PNG, WebP formats
    - Encode uploaded images to base64
    - Display image preview before submission
    - Validate file size (max 10MB)
    - Show error messages for invalid files or encoding failures
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  
  - [x] 4.3 Implement text input functionality
    - Create text input field with 500 character limit
    - Display real-time character count
    - Prevent submission when text is empty
    - Prevent character entry beyond limit
    - Show validation messages
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [x] 4.4 Add loading states and submission handling
    - Display loading indicator during generation
    - Disable input controls while generating
    - Handle submission with proper error boundaries
    - _Requirements: 5.5_

- [ ] 5. Implement 3D Model Viewer component
  - [x] 5.1 Set up React Three Fiber scene
    - Configure Canvas with camera and scene settings
    - Add ambient and directional lighting
    - Set up camera position and field of view
    - _Requirements: 7.2, 7.3_
  
  - [x] 5.2 Implement GLB model loading and rendering
    - Use useGLTF hook to load GLB data
    - Render loaded model in the scene
    - Handle model loading errors with error messages
    - Fit model within viewport boundaries
    - _Requirements: 7.1, 7.3, 7.4_
  
  - [x] 5.3 Add interactive controls
    - Implement OrbitControls for rotation (mouse drag)
    - Enable zoom controls (scroll/pinch gestures)
    - Enable pan controls (right-click or two-finger drag)
    - Configure damping for smooth interactions
    - Set min/max zoom distance limits
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [x] 5.4 Add view reset functionality
    - Create reset button to return to default camera position
    - Implement smooth camera transition on reset
    - _Requirements: 8.4_
  
  - [x] 5.5 Optimize rendering performance
    - Monitor frame rate during interactions
    - Ensure minimum 30 FPS performance
    - Add performance hints if needed
    - _Requirements: 8.5_

- [ ] 6. Checkpoint - Verify 3D rendering
  - Ask the user if questions arise.

- [ ] 7. Implement History Manager
  - [~] 7.1 Create LocalStorage interface
    - Implement addGeneration function to store new models
    - Implement getHistory function to retrieve stored models
    - Implement selectGeneration function to load specific model
    - Implement clearHistory function for cleanup
    - _Requirements: 9.1, 9.2, 9.4_
  
  - [~] 7.2 Add history storage logic
    - Store generation items with id, timestamp, input data, and model data
    - Implement LRU eviction to maintain 10-item limit
    - Handle storage quota exceeded errors gracefully
    - Add data compression for large models (>5MB)
    - _Requirements: 9.1, 9.2, 9.5_
  
  - [~] 7.3 Create history UI component
    - Display list of previous generations with thumbnails
    - Show timestamp and input type for each item
    - Handle selection to load previous models
    - _Requirements: 9.3, 9.4_

- [ ] 8. Implement error recovery and retry logic
  - [~] 8.1 Add retry functionality to main page
    - Display retry button when generation fails
    - Preserve original input data for retry
    - Resubmit generation request on retry
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [~] 8.2 Implement retry limits
    - Track retry count per generation request
    - Limit retries to 3 attempts maximum
    - Display exhaustion message after max retries
    - Suggest trying different input after exhaustion
    - _Requirements: 10.4, 10.5_

- [ ] 9. Integrate all components in main page
  - [~] 9.1 Create main page component structure
    - Set up application state management
    - Wire Input Handler to API route
    - Connect API response to Model Viewer
    - Integrate History Manager with Model Viewer
    - _Requirements: All_
  
  - [~] 9.2 Implement state management
    - Manage current model state
    - Track generation loading state
    - Handle error states and messages
    - Track retry count and last input
    - Manage selected history item
    - _Requirements: 5.5, 6.2, 6.3, 6.4, 10.1, 10.3_
  
  - [~] 9.3 Add error boundaries and fallbacks
    - Wrap components in error boundaries
    - Display user-friendly error messages
    - Provide fallback UI for component failures
    - _Requirements: 6.2, 6.3, 6.4, 7.4_

- [ ] 10. Final checkpoint and polish
  - [~] 10.1 Verify all requirements are met
    - Test all input modes and validation
    - Test API integration with both input types
    - Test 3D viewer interactions
    - Test history management
    - Test error recovery
    - _Requirements: All_
  
  - [~] 10.2 Add UI polish and accessibility
    - Ensure proper ARIA labels for interactive elements
    - Add keyboard navigation support
    - Improve loading states and transitions
    - Add helpful tooltips and instructions
    - _Requirements: All_

## Notes

- Each task references specific requirements for traceability
- The design document uses TypeScript, so all implementation will be in TypeScript
- React Three Fiber and drei libraries handle most 3D rendering complexity
- LocalStorage provides simple persistence without backend requirements
- API key security is maintained by using Next.js API routes (server-side only)
- The NVIDIA Trellis API returns GLB format models which are directly compatible with Three.js
