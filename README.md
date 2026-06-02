<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Whisper Desktop Logo" width="128" height="128">
</p>

<h1 align="center">Whisper Desktop</h1>

<p align="center">
  <strong>A premium, state-of-the-art, and gorgeous native Rust & Tauri GUI designed for whisper.cpp.</strong><br>
  Run high-performance local speech-to-text models with ease, beauty, and complete privacy.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License MIT">
  <img src="https://img.shields.io/badge/Platform-Linux-orange.svg" alt="Platform Linux">
  <img src="https://img.shields.io/badge/Built%20With-Rust%20%26%20Tauri-red.svg" alt="Built With Rust & Tauri">
</p>

---

## 📸 Screenshots & Visual Walkthrough

Here is a preview of the premium cyber-neon glassmorphic interface:

| 🎛️ Dashboard Home | 🏗️ Build Screen |
| :---: | :---: |
| ![Dashboard Home](assets/screenshots/dashboard.png) | ![Build Screen](assets/screenshots/build.png) |

| 🛠️ Configuration Step | 🎙️ Transcription Screen |
| :---: | :---: |
| ![Configuration Step](assets/screenshots/configuration.png) | ![Transcription Screen](assets/screenshots/transcription.png) |

---

## ✨ Features at a Glance

Whisper Desktop is designed to feel like a next-generation utility, combining the blistering performance of Rust/C++ with a highly aesthetic, responsive, and modern glassmorphic web dashboard.

*   **⚡ Multiple Acceleration Backends:** Choose between **CPU**, **Vulkan**, **OpenVINO**, or **CUDA** directly from the UI to match your hardware capabilities.
*   **📂 Batch Processing Queue:** Import multiple files, view their duration, remove individual files, clear the queue, and transcribe them sequentially.
*   **🎤 Live Audio Recording:** Record audio directly from your microphone with real-time waveform animation and transcribe it instantly.
*   **🎞️ Integrated Media Converter:** Automatically extract audio from video files using integrated utilities.
*   **🎨 Cyber-Neon Glassmorphic Design:** A premium dark-mode interface with elegant micro-animations, harmonized gradient glowing borders, and intuitive layout transitions.
*   **📦 Easy Drag & Drop HUD:** Drag audio or video files anywhere into the application to instantly load them into your queue.
*   **⚙️ Full Transcription Settings:** Adjust transcription parameters such as GGML model selection, thread count, target language, translation to English, and output formats (TXT, SRT, VTT).

---

## 🛠️ Interactive Architecture

Whisper Desktop orchestrates native `whisper.cpp` binaries using Tauri’s lightning-fast Rust IPC bridge. 

```mermaid
graph TD
    A[Glassmorphic UI - HTML/CSS/JS] -->|Tauri IPC Command| B(Tauri Core - Rust)
    B -->|Launch Process| C[whisper.cpp Core C++ Engine]
    C -->|Thread Allocation| D[CPU Execution]
    C -->|GPU Acceleration| E[Vulkan / CUDA / OpenVINO]
    F[(Local GGML Models)] -.->|Loads Model| C
    G[ffmpeg Engine] -.->|Extracts Audio| B
```

---

## 🚀 Installation & Packaging

### 🐧 Debian / Ubuntu (`.deb`)
Download the latest `.deb` file from the [GitHub Releases](https://github.com/AtomicError/whisper-desktop/releases) page and install it:
```bash
sudo dpkg -i whisper-desktop_*_amd64.deb
sudo apt-get install -f # Install dependencies if missing
```

### 🎩 RedHat / Fedora (`.rpm`)
Download the `.rpm` package and install via `dnf`:
```bash
sudo dnf install whisper-desktop-*.rpm
```

### 🐳 AppImage
For any other Linux distribution, simply download the portable `AppImage`, make it executable, and run it:
```bash
chmod +x whisper-desktop-*.AppImage
./whisper-desktop-*.AppImage
```

---

## 💻 Development & Building from Source

To build Whisper Desktop locally, ensure you have the following prerequisites installed on your system:
*   **Node.js** (v18 or higher) & **npm**
*   **Rust** toolchain (Cargo, rustc)
*   **System Libraries:** `gtk3`, `webkit2gtk-4.1`, `ffmpeg`

### 1. Clone the Repository
```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp/manager/desktop
```

### 2. Install Frontend Dependencies
```bash
npm install
```

### 3. Run in Development Mode
Start the live-reloading hot development server:
```bash
npm run tauri dev
```

### 4. Build Production Packages
Compile and bundle the production release for your system:
```bash
npm run tauri build
```
Production packages will be generated inside `src-tauri/target/release/bundle/`.

---

## 📦 Project Structure

```
whisper-desktop/
├── src/                      # Glassmorphic Frontend Core
│   ├── assets/               # Neon SVGs, custom icons, and visual elements
│   ├── index.html            # Main dashboard layout (6 premium feature panels)
│   ├── index.css             # Glassmorphism, animations, and color design system
│   └── main.js               # IPC binding, queue state, and audio recorders
├── src-tauri/                # Tauri backend (Rust)
│   ├── src/                  # Tauri Rust entry point and command routers
│   ├── icons/                # Beautiful high-resolution custom cyber-neon app icons
│   ├── permissions/          # Tauri v2 security policies and capability schemas
│   ├── Cargo.toml            # Rust manifest
│   └── tauri.conf.json       # Build target configs (deb, rpm, appimage)
├── PKGBUILD                  # Arch Linux packaging script
└── README.md                 # Project documentation
```

---

## 🔒 Privacy & Local Processing

All audio transcription, processing, and recording are executed **100% locally** on your computer. Your audio files, recordings, and transcriptions are never sent to external servers or cloud APIs, ensuring absolute confidentiality and privacy.

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
