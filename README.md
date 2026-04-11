# 3D Model Generator

A cutting-edge web application built with **Next.js 15** and **React Three Fiber** that leverages NVIDIA's **Trellis NIM** to generate high-fidelity 3D models (GLB) from simple images or text descriptions.

![Model Viewer Preview](public/images/layout_after.png) *Note: Add your own screenshot here*

## 🚀 Features

- **Text-to-3D**: Generate complex 3D assets from descriptive prompts using optimized material and geometry descriptors.
- **Image-to-3D**: Transform single 2D images into full 3D models (currently supports high-quality example library).
- **Advanced 3D Viewer**: 
  - Interactive Orbit controls (rotate, zoom, pan).
  - Real-time **FPS monitoring** and performance optimization.
  - Automatic focus and camera-fitting logic.
  - Smooth camera reset transitions.
- **Modern UI**: A sleek, dark-themed responsive interface built with Tailwind CSS.

## 🛠️ Tech Stack

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **3D Rendering**: [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction) & [Three.js](https://threejs.org/)
- **Styling**: Tailwind CSS
- **API Integration**: NVIDIA NIM (Trellis)
- **Language**: TypeScript

## 📋 Prerequisites

- **Node.js**: v18.17.0 or higher
- **NVIDIA API Key**: Required for 3D model generation.

## ⚙️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd trellis-test
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env.local` file in the root directory and add your NVIDIA API key:
   ```env
   NVIDIA_API_KEY=your_nv_api_key_here
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the application.

## 🔑 How to get an NVIDIA API Key

This project requires an API key from NVIDIA Build to function.

1. Go to the [NVIDIA Trellis NIM page](https://build.nvidia.com/nvidia/trellis).
2. Sign in or create a free NVIDIA Developer account.
3. Click the **"Get API Key"** button.
4. Copy the key and paste it into your `.env.local` file as shown in the Setup section above.

## 💡 Prompting Tips for Text-to-3D

To get the highest quality models, use descriptive adjectives and material indicators:
- **Good**: "A chair"
- **Better**: "A **modern minimalist lounge chair** with **curved wooden armrests** and **brushed aluminum legs**, finished in **charcoal velvet**."

Check out the Architecture prompts for testing complex structures!

## 🧪 Testing

The project includes a comprehensive test suite using Vitest.
```bash
npm run test
```

---

*Built with ❤️ using Antigravity.*
