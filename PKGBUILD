# Maintainer: TheMrAhmad
pkgname=whisper-desktop
pkgver=1.0.0
pkgrel=1
pkgdesc="A gorgeous, premium Rust & Tauri GUI to manage and execute whisper.cpp transcriber tasks."
arch=('x86_64')
url="https://github.com/ggml-org/whisper.cpp"
license=('MIT')
depends=('gtk3' 'webkit2gtk-4.1' 'ffmpeg')
makedepends=('cargo' 'nodejs' 'npm')

build() {
  # Build directly from the local source folder where makepkg is run
  cd "$startdir"
  npm install
  npm run tauri build -- --no-bundle
}

package() {
  cd "$startdir"
  # Install the compiled binary
  install -Dm755 "src-tauri/target/release/whisper-desktop" "$pkgdir/usr/bin/whisper-desktop"
  
  # Install the desktop menu shortcut
  install -Dm644 "WhisperManager.desktop" "$pkgdir/usr/share/applications/whisper-desktop.desktop"

  # Install high-resolution custom cyber-neon app icons
  install -Dm644 "src-tauri/icons/32x32.png" "$pkgdir/usr/share/icons/hicolor/32x32/apps/whisper-desktop.png"
  install -Dm644 "src-tauri/icons/128x128.png" "$pkgdir/usr/share/icons/hicolor/128x128/apps/whisper-desktop.png"
  install -Dm644 "src-tauri/icons/128x128@2x.png" "$pkgdir/usr/share/icons/hicolor/256x256/apps/whisper-desktop.png"
  install -Dm644 "src-tauri/icons/icon.png" "$pkgdir/usr/share/icons/hicolor/512x512/apps/whisper-desktop.png"
}
