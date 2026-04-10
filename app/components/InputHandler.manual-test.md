# Manual Test Plan for InputHandler Mode Selection (Task 4.1)

## Test Cases

### TC1: Default Mode Selection
**Steps:**
1. Start the development server: `npm run dev`
2. Open the application in a browser
3. Observe the InputHandler component

**Expected Result:**
- Image Upload button should be highlighted (blue background)
- Text Input button should have gray background
- Image upload interface placeholder should be visible

### TC2: Switch to Text Mode
**Steps:**
1. Click on the "Text Input" button

**Expected Result:**
- Text Input button should become highlighted (blue background)
- Image Upload button should change to gray background
- Text input interface placeholder should be visible
- Image upload interface should be hidden

### TC3: Switch Back to Image Mode
**Steps:**
1. From text mode, click on the "Image Upload" button

**Expected Result:**
- Image Upload button should become highlighted (blue background)
- Text Input button should change to gray background
- Image upload interface placeholder should be visible
- Text input interface should be hidden

### TC4: Mode Switching During Loading
**Steps:**
1. Modify the page.tsx to set `isGenerating` to `true` temporarily
2. Try clicking on either mode button

**Expected Result:**
- Both buttons should appear disabled (reduced opacity)
- Clicking buttons should not change the mode
- Cursor should show "not-allowed" when hovering over buttons

### TC5: Responsive Design
**Steps:**
1. Resize browser window to mobile size (< 640px)
2. Observe the mode selection buttons

**Expected Result:**
- Buttons should remain side-by-side
- Buttons should be responsive and maintain proper spacing
- Text should remain readable

## Requirements Validation

This implementation satisfies the following requirements from Task 4.1:

✓ **Requirement 1.1**: Provides an interface for selecting between image upload and text input modes
✓ **Requirement 1.2**: Displays image upload interface when image mode is selected
✓ **Requirement 1.3**: Displays text input interface when text mode is selected
✓ **Requirement 1.4**: Allows mode switching before submission (disabled during loading)

## Notes

- The actual image upload and text input interfaces are placeholders and will be implemented in tasks 4.2 and 4.3
- The component properly handles the `isLoading` prop to prevent mode switching during generation
- The component uses Tailwind CSS for styling with dark mode support
