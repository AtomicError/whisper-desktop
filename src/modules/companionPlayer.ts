// Companion Player & Media Console Controller for Whisper Desktop
import { t, firstStrongDirection } from '../i18n/index';
import { formatMsToTimestamp, parseTimestampStringToMs, getTranscriptLines } from './transcriptViewer';

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

const getTauriInvoke = (): any => {
  const win = getGlobal();
  const tauri = win.__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return win.invoke || null;
};

export interface CompanionMediaInfo {
  filePath: string;
  fileName: string;
  streamUrl: string;
  durationSec: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  isVideo: boolean;
}

let activeMediaInfo: CompanionMediaInfo | null = null;
let activeStreamUrl: string | null = null;
let activeLoadSequence = 0;
let isSeeking = false;
let isVideoSeeking = false;
let seekWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
let currentHighlightedLineId: number | null = null;
let pendingSeekTargetSec: number | null = null;
let hasMetadataSeekListener = false;
let companionSubtitleCanvas: HTMLCanvasElement | null = null;
let companionCanvasCtx: CanvasRenderingContext2D | null = null;
let companionResizeObserver: ResizeObserver | null = null;
let lastRenderedSubtitleText = '';
let explicitTargetLineId: number | null = null;

function armSeekWatchdog(): void {
  if (seekWatchdogTimer) clearTimeout(seekWatchdogTimer);
  seekWatchdogTimer = setTimeout(() => {
    seekWatchdogTimer = null;
    isSeeking = false;
    isVideoSeeking = false;
  }, 1000);
}

export function formatTimecodeDisplay(seconds: number): string {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) seconds = 0;
  const totalMs = Math.floor(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hours = Math.floor(totalMin / 60);

  const hStr = hours > 0 ? `${hours.toString().padStart(2, '0')}:` : '';
  const mStr = min.toString().padStart(2, '0');
  const sStr = sec.toString().padStart(2, '0');
  const msStr = ms.toString().padStart(3, '0');
  return `${hStr}${mStr}:${sStr}.${msStr}`;
}

export function formatTimecodeHTML(seconds: number): string {
  const formatted = formatTimecodeDisplay(seconds);
  const dotIdx = formatted.lastIndexOf('.');
  if (dotIdx === -1) return formatted;
  const main = formatted.substring(0, dotIdx);
  const ms = formatted.substring(dotIdx);
  return `${main}<span class="timecode-ms">${ms}</span>`;
}

export function updateCompanionTimeDisplay(el: HTMLElement | null, seconds: number): void {
  if (!el) return;
  const formatted = formatTimecodeDisplay(seconds);
  const dotIdx = formatted.lastIndexOf('.');
  if (dotIdx !== -1) {
    const main = formatted.substring(0, dotIdx);
    const ms = formatted.substring(dotIdx);
    el.innerHTML = `${main}<span class="timecode-ms">${ms}</span>`;
  } else {
    el.textContent = formatted;
  }
}

export function updateSliderTrackProgress(slider: HTMLInputElement | null, pct: number, varName: string): void {
  if (!slider) return;
  const clamped = Math.max(0, Math.min(100, isNaN(pct) ? 0 : pct));
  const val = `${clamped}%`;
  if (slider.style) {
    if (typeof slider.style.setProperty === 'function') {
      slider.style.setProperty(varName, val);
    } else {
      (slider.style as any)[varName] = val;
    }
    slider.style.background = `linear-gradient(to right, var(--color-royal-blue, #3b82f6) 0%, var(--color-royal-blue, #3b82f6) ${val}, rgba(255, 255, 255, 0.14) ${val}, rgba(255, 255, 255, 0.14) 100%)`;
  }
}

export const COMPANION_SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];
let currentCompanionSpeed = 1.0;

export function formatSpeedLabel(rate: number): string {
  if (rate === 1 || rate === 2) {
    return `${rate.toFixed(1)}x`;
  }
  return `${rate}x`;
}

export function cycleCompanionPlaybackRate(reverse = false): void {
  const idx = COMPANION_SPEEDS.indexOf(currentCompanionSpeed);
  let nextIdx: number;
  if (idx === -1) {
    nextIdx = 1;
  } else if (reverse) {
    nextIdx = (idx - 1 + COMPANION_SPEEDS.length) % COMPANION_SPEEDS.length;
  } else {
    nextIdx = (idx + 1) % COMPANION_SPEEDS.length;
  }
  currentCompanionSpeed = COMPANION_SPEEDS[nextIdx];
  changeCompanionPlaybackRate(String(currentCompanionSpeed));
}

export function getActiveMediaInfo(): CompanionMediaInfo | null {
  return activeMediaInfo;
}

export function showTranscribeSetupDeck(): void {
  if (typeof document === 'undefined') return;
  pauseCompanionPlayer();
  const setupDeck = document.getElementById('transcribe-unified-deck');
  const mediaDeck = document.getElementById('transcribe-media-deck');
  const tabSetup = document.getElementById('btn-tab-to-setup');
  const tabPlayer = document.getElementById('btn-tab-to-player');
  const setupTabSetup = document.getElementById('btn-setup-tab-setup');
  const setupTabPlayer = document.getElementById('btn-setup-tab-player');
  const setupDeckTabs = document.getElementById('setup-deck-mode-tabs');
  const manageSettingsBtn = document.getElementById('btn-transcribe-manage-settings');

  if (setupDeck) setupDeck.style.display = 'flex';
  if (mediaDeck) mediaDeck.style.display = 'none';
  if (tabSetup) tabSetup.classList.add('active');
  if (tabPlayer) tabPlayer.classList.remove('active');
  if (setupTabSetup) setupTabSetup.classList.add('active');
  if (setupTabPlayer) setupTabPlayer.classList.remove('active');
  if (setupDeckTabs) {
    setupDeckTabs.style.display = activeMediaInfo ? 'inline-flex' : 'none';
  }
  if (manageSettingsBtn) {
    manageSettingsBtn.style.display = activeMediaInfo ? 'none' : 'inline-flex';
  }
}

export function showTranscribeMediaDeck(): void {
  if (typeof document === 'undefined') return;
  const setupDeck = document.getElementById('transcribe-unified-deck');
  const mediaDeck = document.getElementById('transcribe-media-deck');
  const tabSetup = document.getElementById('btn-tab-to-setup');
  const tabPlayer = document.getElementById('btn-tab-to-player');
  const setupTabSetup = document.getElementById('btn-setup-tab-setup');
  const setupTabPlayer = document.getElementById('btn-setup-tab-player');
  const setupDeckTabs = document.getElementById('setup-deck-mode-tabs');

  if (setupDeck) setupDeck.style.display = 'none';
  if (mediaDeck) mediaDeck.style.display = 'flex';
  if (tabSetup) tabSetup.classList.remove('active');
  if (tabPlayer) tabPlayer.classList.add('active');
  if (setupTabSetup) setupTabSetup.classList.remove('active');
  if (setupTabPlayer) setupTabPlayer.classList.add('active');
  if (setupDeckTabs) {
    setupDeckTabs.style.display = 'none';
  }
  setTimeout(() => {
    updateCompanionSubtitleBounds(true);
  }, 30);
}

export async function loadMediaIntoCompanionPlayer(filePath: string, autoSwitchDeck = true): Promise<boolean> {
  if (typeof document === 'undefined' || !filePath) return false;
  const invoke = getTauriInvoke();
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return false;

  // If already loaded for the same media file, preserve current playback and avoid redundant re-probing
  if (activeMediaInfo && activeMediaInfo.filePath === filePath && videoEl.src) {
    if (autoSwitchDeck) {
      showTranscribeMediaDeck();
    } else {
      const setupDeckTabs = document.getElementById('setup-deck-mode-tabs');
      if (setupDeckTabs) setupDeckTabs.style.display = 'inline-flex';
      const manageSettingsBtn = document.getElementById('btn-transcribe-manage-settings');
      if (manageSettingsBtn) manageSettingsBtn.style.display = 'none';
    }
    return true;
  }

  const currentSeq = ++activeLoadSequence;

  // Clean up any previously registered streaming URL
  if (activeStreamUrl && invoke) {
    try {
      await invoke('revoke_media_stream', { streamUrl: activeStreamUrl });
    } catch (_) {}
    activeStreamUrl = null;
  }

  let streamUrl = '';
  if (invoke) {
    try {
      streamUrl = await invoke('stream_media_file', { filePath });
      if (currentSeq !== activeLoadSequence) {
        if (streamUrl) {
          invoke('revoke_media_stream', { streamUrl }).catch(() => {});
        }
        return false;
      }
      activeStreamUrl = streamUrl;
    } catch (err) {
      console.warn('Failed to stream media file via local server, falling back to direct path:', err);
      streamUrl = filePath;
    }
  } else {
    streamUrl = filePath;
  }

  if (currentSeq !== activeLoadSequence) return false;

  // Detect extension and type
  const lowerPath = filePath.toLowerCase();
  const isAudioOnly = [
    '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus',
    '.wma', '.amr', '.3ga', '.aiff', '.aif', '.caf', '.ape',
    '.alac', '.ac3', '.dts', '.oga'
  ].some(ext => lowerPath.endsWith(ext));
  const fileName = filePath.split(/[/\\]/).pop() || 'Media file';

  const audioFallback = document.getElementById('companion-audio-fallback');
  const audioNameEl = document.getElementById('companion-audio-name');
  const videoContainer = document.getElementById('companion-video-container');

  if (isAudioOnly) {
    videoEl.style.display = 'none';
    if (audioFallback) audioFallback.style.display = 'flex';
    if (audioNameEl) audioNameEl.textContent = fileName;
    if (videoContainer) videoContainer.classList.remove('aspect-vertical');
  } else {
    videoEl.style.display = 'block';
    if (audioFallback) audioFallback.style.display = 'none';
  }

  // Probe media metadata
  let durationSec = 0;
  let width = 0;
  let height = 0;
  let aspectStr: string | undefined = isAudioOnly ? undefined : '16:9';

  if (invoke) {
    try {
      const meta = await invoke('probe_media_file', { filePath });
      if (meta && meta.durationSec) {
        durationSec = meta.durationSec;
      }
    } catch (_) {}

    if (!isAudioOnly) {
      try {
        const sourceInfo = await invoke('probe_hardsub_source', { sourcePath: filePath });
        if (sourceInfo) {
          width = sourceInfo.width || sourceInfo.displayWidth || 0;
          height = sourceInfo.height || sourceInfo.displayHeight || 0;
          if (sourceInfo.durationSec) durationSec = sourceInfo.durationSec;
        }
      } catch (_) {}
    }
  }

  if (currentSeq !== activeLoadSequence) {
    if (streamUrl && invoke) {
      invoke('revoke_media_stream', { streamUrl }).catch(() => {});
    }
    if (activeStreamUrl === streamUrl) {
      activeStreamUrl = null;
    }
    return false;
  }

  if (width > 0 && height > 0) {
    const ratio = width / height;
    if (ratio < 0.8) {
      aspectStr = '9:16';
      if (videoContainer) videoContainer.classList.add('aspect-vertical');
    } else if (ratio >= 0.8 && ratio <= 1.2) {
      aspectStr = '1:1';
      if (videoContainer) videoContainer.classList.remove('aspect-vertical');
    } else if (ratio > 1.2 && ratio < 1.5) {
      aspectStr = '4:3';
      if (videoContainer) videoContainer.classList.remove('aspect-vertical');
    } else {
      aspectStr = '16:9';
      if (videoContainer) videoContainer.classList.remove('aspect-vertical');
    }
  }

  activeMediaInfo = {
    filePath,
    fileName,
    streamUrl,
    durationSec,
    width,
    height,
    aspectRatio: aspectStr,
    isVideo: !isAudioOnly,
  };

  // Update UI Metadata Card
  updateCompanionMetadataUI(activeMediaInfo);

  // Update Fullscreen button availability based on audio vs video
  const fullscreenBtn = document.getElementById('btn-companion-fullscreen') as HTMLButtonElement | null;
  if (fullscreenBtn) {
    fullscreenBtn.disabled = isAudioOnly;
    fullscreenBtn.style.opacity = isAudioOnly ? '0.35' : '1';
    fullscreenBtn.style.cursor = isAudioOnly ? 'not-allowed' : 'pointer';
  }

  // Set video source and wire events
  videoEl.src = streamUrl;
  videoEl.load();

  const seekSlider = document.getElementById('companion-seek-slider') as HTMLInputElement | null;
  if (seekSlider) {
    seekSlider.value = '0';
    updateSliderTrackProgress(seekSlider, 0, '--seek-pct');
  }
  const timeCurrent = document.getElementById('companion-time-current');
  if (timeCurrent) updateCompanionTimeDisplay(timeCurrent, 0);

  // Synchronize user-chosen playback rate and volume on the newly loaded media
  changeCompanionPlaybackRate(String(currentCompanionSpeed));
  const volSlider = document.getElementById('companion-volume-slider') as HTMLInputElement | null;
  if (volSlider) {
    const vol = parseFloat(volSlider.value);
    if (!isNaN(vol)) {
      videoEl.volume = Math.max(0, Math.min(1, vol));
      videoEl.muted = vol === 0;
      updateVolumeIcons(videoEl.muted || videoEl.volume === 0);
      updateSliderTrackProgress(volSlider, videoEl.muted ? 0 : videoEl.volume * 100, '--vol-pct');
    }
  }

  if (autoSwitchDeck) {
    showTranscribeMediaDeck();
  } else {
    const setupDeckTabs = document.getElementById('setup-deck-mode-tabs');
    if (setupDeckTabs) setupDeckTabs.style.display = 'inline-flex';
    const manageSettingsBtn = document.getElementById('btn-transcribe-manage-settings');
    if (manageSettingsBtn) manageSettingsBtn.style.display = 'none';
  }
  return true;
}

export function updateCompanionMetadataUI(info: CompanionMediaInfo): void {
  if (typeof document === 'undefined') return;
  const fileNameEl = document.getElementById('companion-meta-filename');
  const durationEl = document.getElementById('companion-meta-duration');
  const resEl = document.getElementById('companion-meta-resolution');
  const aspectEl = document.getElementById('companion-meta-aspect');
  const formatEl = document.getElementById('companion-meta-format');
  const timeTotalEl = document.getElementById('companion-time-total');
  const typeIcon = document.getElementById('companion-meta-type-icon');

  if (fileNameEl) {
    fileNameEl.textContent = info.fileName;
    if (info.filePath) {
      fileNameEl.title = info.filePath;
    }
  }
  if (durationEl) updateCompanionTimeDisplay(durationEl, info.durationSec);
  if (timeTotalEl) updateCompanionTimeDisplay(timeTotalEl, info.durationSec);

  if (typeIcon) {
    if (info.isVideo) {
      typeIcon.innerHTML = `<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`;
    } else {
      typeIcon.innerHTML = `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`;
    }
  }

  if (resEl) {
    resEl.textContent = (info.width && info.height)
      ? `${info.width}×${info.height}`
      : (info.isVideo ? '—' : (t('transcribe.companionMetaAudioOnly') || 'Audio Only'));
  }
  if (aspectEl) {
    aspectEl.textContent = info.isVideo
      ? (info.aspectRatio || '16:9')
      : (t('transcribe.companionMetaAudioChannel') || 'Stereo');
  }
  if (formatEl) {
    formatEl.textContent = info.isVideo
      ? (t('transcribe.companionMetaVideo') || 'Video')
      : (t('transcribe.companionMetaAudio') || 'Audio');
  }
}

export function toggleCompanionPlayback(): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  if (videoEl.paused) {
    if (videoEl.ended) {
      videoEl.currentTime = 0;
    }
    videoEl.play().catch(e => console.warn('Video play error:', e));
  } else {
    videoEl.pause();
  }
}

export function jumpCompanionPlayback(seconds: number): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
  const targetTime = Math.max(0, Math.min(dur || 999999, videoEl.currentTime + seconds));
  isSeeking = true;
  isVideoSeeking = true;
  videoEl.currentTime = targetTime;
  const seekSlider = document.getElementById('companion-seek-slider') as HTMLInputElement | null;
  if (dur > 0 && seekSlider) {
    const pct = (targetTime / dur) * 100;
    seekSlider.value = String(pct);
    updateSliderTrackProgress(seekSlider, pct, '--seek-pct');
  }
  const timeCurrent = document.getElementById('companion-time-current');
  if (timeCurrent) updateCompanionTimeDisplay(timeCurrent, targetTime);
  armSeekWatchdog();
}

export function seekCompanionPlayer(targetMs: number, autoPlay?: boolean, targetLineId?: number): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const targetSec = Math.max(0, targetMs / 1000);
  const shouldPlay = typeof autoPlay === 'boolean' ? autoPlay : !videoEl.paused;
  const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
  const seekSlider = document.getElementById('companion-seek-slider') as HTMLInputElement | null;
  if (dur > 0 && seekSlider) {
    const pct = (targetSec / dur) * 100;
    seekSlider.value = String(pct);
    updateSliderTrackProgress(seekSlider, pct, '--seek-pct');
  }
  const timeCurrent = document.getElementById('companion-time-current');
  if (timeCurrent) updateCompanionTimeDisplay(timeCurrent, targetSec);

  if (typeof targetLineId === 'number') {
    explicitTargetLineId = targetLineId;
    highlightActiveTranscriptSegment(targetSec, targetLineId);
  } else {
    explicitTargetLineId = null;
  }

  isSeeking = true;
  isVideoSeeking = true;
  armSeekWatchdog();

  if (videoEl.readyState >= 1) {
    videoEl.currentTime = targetSec;
    if (shouldPlay && videoEl.paused) {
      videoEl.play().catch(e => console.warn('Autoplay error:', e));
    } else if (!shouldPlay && !videoEl.paused) {
      videoEl.pause();
    }
  } else {
    pendingSeekTargetSec = targetSec;
    if (!hasMetadataSeekListener) {
      hasMetadataSeekListener = true;
      videoEl.addEventListener('loadedmetadata', () => {
        hasMetadataSeekListener = false;
        if (pendingSeekTargetSec !== null) {
          videoEl.currentTime = pendingSeekTargetSec;
          pendingSeekTargetSec = null;
        }
        if (shouldPlay && videoEl.paused) {
          videoEl.play().catch(e => console.warn('Autoplay error:', e));
        } else if (!shouldPlay && !videoEl.paused) {
          videoEl.pause();
        }
      }, { once: true });
    }
  }
  if (activeMediaInfo) {
    showTranscribeMediaDeck();
  }
}

export function pauseCompanionPlayer(): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (videoEl && !videoEl.paused) {
    videoEl.pause();
  }
}

export function unloadCompanionPlayer(): void {
  activeLoadSequence++;
  activeMediaInfo = null;
  pauseCompanionPlayer();
  if (seekWatchdogTimer) {
    clearTimeout(seekWatchdogTimer);
    seekWatchdogTimer = null;
  }
  isSeeking = false;
  isVideoSeeking = false;
  pendingSeekTargetSec = null;
  hasMetadataSeekListener = false;
  currentHighlightedLineId = null;
  explicitTargetLineId = null;
  lastRenderedSubtitleText = '';
  if (companionSubtitleCanvas) {
    if (companionCanvasCtx) {
      companionCanvasCtx.clearRect(0, 0, companionSubtitleCanvas.width, companionSubtitleCanvas.height);
    }
    companionSubtitleCanvas.style.display = 'none';
  }
  companionSubtitleCanvas = null;
  companionCanvasCtx = null;
  if (companionResizeObserver) {
    companionResizeObserver.disconnect();
    companionResizeObserver = null;
  }
  if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('.transcript-card.active-playback').forEach(el => {
      el.classList.remove('active-playback');
    });
  }
  const seekSlider = document.getElementById('companion-seek-slider') as HTMLInputElement | null;
  if (seekSlider) {
    seekSlider.value = '0';
    updateSliderTrackProgress(seekSlider, 0, '--seek-pct');
  }
  const timeCurrent = document.getElementById('companion-time-current');
  if (timeCurrent) updateCompanionTimeDisplay(timeCurrent, 0);
  const timeTotal = document.getElementById('companion-time-total');
  if (timeTotal) updateCompanionTimeDisplay(timeTotal, 0);

  // Reset companion metadata strip elements
  const fileNameEl = document.getElementById('companion-meta-filename');
  const resEl = document.getElementById('companion-meta-resolution');
  const aspectEl = document.getElementById('companion-meta-aspect');
  const formatEl = document.getElementById('companion-meta-format');
  const durationEl = document.getElementById('companion-meta-duration');
  const typeIcon = document.getElementById('companion-meta-type-icon');

  if (fileNameEl) {
    fileNameEl.textContent = '—';
    fileNameEl.title = t('transcribe.noMediaOrTranscribe') || 'No media file selected or transcribed yet.';
  }
  if (resEl) resEl.textContent = '—';
  if (aspectEl) aspectEl.textContent = '—';
  if (formatEl) formatEl.textContent = '—';
  if (durationEl) updateCompanionTimeDisplay(durationEl, 0);
  if (typeIcon) {
    typeIcon.innerHTML = `<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`;
  }

  const invoke = getTauriInvoke();
  if (activeStreamUrl && invoke) {
    invoke('revoke_media_stream', { streamUrl: activeStreamUrl }).catch(() => {});
    activeStreamUrl = null;
  }
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (videoEl) {
    videoEl.removeAttribute('src');
    videoEl.style.display = 'block';
    videoEl.load();
  }
  const audioFallback = document.getElementById('companion-audio-fallback');
  if (audioFallback) audioFallback.style.display = 'none';
  const fullscreenBtn = document.getElementById('btn-companion-fullscreen') as HTMLButtonElement | null;
  if (fullscreenBtn) {
    fullscreenBtn.disabled = false;
    fullscreenBtn.style.opacity = '1';
    fullscreenBtn.style.cursor = 'pointer';
  }
  showTranscribeSetupDeck();
  const setupDeckTabs = document.getElementById('setup-deck-mode-tabs');
  if (setupDeckTabs) setupDeckTabs.style.display = 'none';
  const manageSettingsBtn = document.getElementById('btn-transcribe-manage-settings');
  if (manageSettingsBtn) manageSettingsBtn.style.display = 'inline-flex';
}

export function changeCompanionPlaybackRate(rateStr: string): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  const rate = parseFloat(rateStr) || 1.0;
  currentCompanionSpeed = rate;
  if (videoEl) {
    videoEl.playbackRate = rate;
  }
  const formattedSpeed = formatSpeedLabel(rate);
  const speedLabel = document.getElementById('companion-speed-label');
  if (speedLabel) {
    speedLabel.textContent = formattedSpeed;
  }
  const speedBtn = document.getElementById('btn-companion-speed') as HTMLButtonElement | null;
  if (speedBtn) {
    const speedAria = t('transcribe.companionSpeedAria') || 'Playback speed';
    const cycleHint = t('transcribe.companionSpeedCycleHint') || 'Left-click: next, Right-click: prev';
    speedBtn.title = `${speedAria}: ${formattedSpeed} (${cycleHint})`;
    speedBtn.setAttribute('aria-label', `${speedAria}: ${formattedSpeed}`);
  }
}

let lastNonZeroVolume = 1.0;

export function changeCompanionVolume(volStr: string): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const parsed = parseFloat(volStr);
  const vol = Math.max(0, Math.min(1, isNaN(parsed) ? 1.0 : Math.round(parsed * 100) / 100));
  videoEl.volume = vol;
  videoEl.muted = vol === 0;
  if (vol > 0) {
    lastNonZeroVolume = vol;
  }
  updateVolumeIcons(videoEl.muted || vol === 0);
  const volSlider = document.getElementById('companion-volume-slider') as HTMLInputElement | null;
  if (volSlider && volSlider.value !== String(vol)) {
    volSlider.value = String(vol);
  }
  updateSliderTrackProgress(volSlider, videoEl.muted ? 0 : vol * 100, '--vol-pct');
}

export function adjustCompanionVolume(delta: number): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const currentVol = videoEl.muted ? 0 : videoEl.volume;
  const newVol = Math.max(0, Math.min(1, Math.round((currentVol + delta) * 100) / 100));
  changeCompanionVolume(String(newVol));
}

export function toggleCompanionMute(): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const volSlider = document.getElementById('companion-volume-slider') as HTMLInputElement | null;
  videoEl.muted = !videoEl.muted;
  if (videoEl.muted) {
    if (volSlider) volSlider.value = '0';
  } else {
    if (videoEl.volume === 0) {
      videoEl.volume = lastNonZeroVolume > 0 ? lastNonZeroVolume : 1.0;
    }
    if (volSlider) volSlider.value = String(videoEl.volume);
  }
  updateVolumeIcons(videoEl.muted || videoEl.volume === 0);
  updateSliderTrackProgress(volSlider, videoEl.muted ? 0 : videoEl.volume * 100, '--vol-pct');
}

function updateVolumeIcons(isMuted: boolean): void {
  const highIcon = document.getElementById('icon-vol-high');
  const muteIcon = document.getElementById('icon-vol-muted');
  if (highIcon) highIcon.style.display = isMuted ? 'none' : 'block';
  if (muteIcon) muteIcon.style.display = isMuted ? 'block' : 'none';
  const muteBtn = document.getElementById('btn-companion-mute');
  if (muteBtn) {
    muteBtn.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
  }
}

export async function toggleCompanionPiP(): Promise<void> {
  const videoEl = document.getElementById('companion-media-element') as any;
  if (!videoEl) return;
  try {
    if (document.pictureInPictureElement) {
      await (document as any).exitPictureInPicture();
    } else if (videoEl.requestPictureInPicture) {
      await videoEl.requestPictureInPicture();
    }
  } catch (err) {
    console.warn('PiP error:', err);
  }
}

export function updateFullscreenUI(): void {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btn-companion-fullscreen') as HTMLButtonElement | null;
  if (!btn) return;
  const isFullscreen = Boolean(document.fullscreenElement);
  const title = isFullscreen
    ? (t('transcribe.companionExitFullscreen') || 'Exit Fullscreen')
    : (t('transcribe.companionFullscreen') || 'Fullscreen');
  btn.title = title;
  btn.setAttribute('aria-label', title);
  if (isFullscreen) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`;
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;
  }
}

export async function toggleCompanionFullscreen(): Promise<void> {
  const consoleEl = document.getElementById('companion-player-console');
  const stage = document.getElementById('companion-player-stage');
  const targetEl = consoleEl || stage;
  if (!targetEl) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (targetEl.requestFullscreen) {
      await targetEl.requestFullscreen();
    } else if (stage && stage.requestFullscreen) {
      await stage.requestFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen error:', err);
  } finally {
    updateFullscreenUI();
  }
}

export function hasArabicOrPersianScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

export function cleanSubtitleDisplayText(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/\\n/gi, '\n')
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

export function protectRtlPunctuation(text: string, isRtl: boolean): string {
  if (!isRtl || !text) return text;
  let res = text;
  if (/[\p{P}\p{S}]$/u.test(res)) {
    res = res + '\u200F';
  }
  if (/^[\p{P}\p{S}]/u.test(res)) {
    res = '\u200F' + res;
  }
  return res;
}

export function updateCompanionSubtitleBounds(forceRedraw = true): void {
  if (typeof document === 'undefined') return;
  const canvas = (document.getElementById('companion-subtitle-canvas') as HTMLCanvasElement | null) || companionSubtitleCanvas;
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  const container = document.getElementById('companion-video-container') as HTMLElement | null;
  if (!canvas || !videoEl || !container) return;

  companionSubtitleCanvas = canvas;
  companionCanvasCtx = canvas.getContext('2d');

  if (!companionResizeObserver && typeof ResizeObserver !== 'undefined') {
    companionResizeObserver = new ResizeObserver(() => {
      updateCompanionSubtitleBounds(false);
    });
    companionResizeObserver.observe(container);
  }

  if (activeMediaInfo && !activeMediaInfo.isVideo) {
    canvas.style.display = 'none';
    return;
  }

  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const videoW = videoEl.videoWidth || activeMediaInfo?.width || 0;
  const videoH = videoEl.videoHeight || activeMediaInfo?.height || 0;
  const videoElW = videoEl.clientWidth;
  const videoElH = videoEl.clientHeight;

  if (!videoW || !videoH || containerW === 0 || containerH === 0 || videoElW === 0 || videoElH === 0) {
    canvas.style.display = 'none';
    return;
  }

  const videoElAspect = videoElW / videoElH;
  const videoAspect = videoW / videoH;

  let displayWidth: number;
  let displayHeight: number;

  if (videoAspect > videoElAspect) {
    displayWidth = videoElW;
    displayHeight = videoElW / videoAspect;
  } else {
    displayHeight = videoElH;
    displayWidth = videoElH * videoAspect;
  }

  const left = videoEl.offsetLeft + (videoElW - displayWidth) / 2;
  const top = videoEl.offsetTop + (videoElH - displayHeight) / 2;

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const roundedW = Math.max(1, Math.round(displayWidth));
  const roundedH = Math.max(1, Math.round(displayHeight));

  canvas.style.width = `${roundedW}px`;
  canvas.style.height = `${roundedH}px`;
  canvas.style.left = `${Math.round(left)}px`;
  canvas.style.top = `${Math.round(top)}px`;
  canvas.style.display = 'block';

  const bufferW = Math.round(roundedW * dpr);
  const bufferH = Math.round(roundedH * dpr);

  const dimsChanged = canvas.width !== bufferW || canvas.height !== bufferH;
  if (dimsChanged) {
    canvas.width = bufferW;
    canvas.height = bufferH;
    lastRenderedSubtitleText = '';
  }

  if (forceRedraw || dimsChanged) {
    renderCompanionSubtitle(true);
  }
}

export function renderCompanionSubtitle(force = false): void {
  if (typeof document === 'undefined') return;
  const canvas = (document.getElementById('companion-subtitle-canvas') as HTMLCanvasElement | null) || companionSubtitleCanvas;
  if (!canvas) return;
  const ctx = companionCanvasCtx || canvas.getContext('2d');
  if (!ctx) return;

  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl || (activeMediaInfo && !activeMediaInfo.isVideo)) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const curMs = Math.round((videoEl.currentTime || 0) * 1000);
  const lines = getTranscriptLines();
  let activeText = '';

  if (lines && lines.length > 0) {
    const targetId = explicitTargetLineId !== null ? explicitTargetLineId : currentHighlightedLineId;
    if (targetId !== null) {
      const targetLine = lines.find(l => l.id === targetId);
      if (targetLine) {
        activeText = targetLine.text.trim();
      }
    }

    if (!activeText) {
      const candidates = lines.filter(l => {
        const s = l.startMs ?? 0;
        const e = l.endMs ?? (s + 3000);
        return curMs >= s && curMs <= e;
      });

      if (candidates.length === 1) {
        activeText = candidates[0].text.trim();
      } else if (candidates.length > 1) {
        const startingAtNow = candidates.find(l => (l.startMs ?? 0) === curMs);
        if (startingAtNow) {
          activeText = startingAtNow.text.trim();
        } else {
          candidates.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
          activeText = candidates[0].text.trim();
        }
      }
    }
  }

  if (!force && activeText === lastRenderedSubtitleText) {
    return;
  }
  lastRenderedSubtitleText = activeText;

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const canvasW = canvas.width / dpr;
  const canvasH = canvas.height / dpr;
  if (!(canvasW > 0 && canvasH > 0)) return;

  if (typeof ctx.save === 'function') {
    ctx.save();
  }
  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ctx.clearRect(0, 0, canvasW, canvasH);

  const cleanedText = cleanSubtitleDisplayText(activeText);
  if (!cleanedText) {
    if (typeof ctx.restore === 'function') {
      ctx.restore();
    }
    return;
  }

  const strongDir = firstStrongDirection(cleanedText);
  const isRtl = strongDir ? strongDir === 'rtl' : hasArabicOrPersianScript(cleanedText);
  ctx.direction = isRtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  const aspect = canvasW / canvasH;
  const baseSize = aspect >= 1.0
    ? canvasH * 0.055
    : Math.min(canvasH * 0.055, canvasW * 0.058);
  const fontSize = Math.max(12, Math.min(32, Math.round(baseSize)));

  const fontFamily = isRtl
    ? "'Vazirmatn', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    : "'Inter', 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.font = `600 ${fontSize}px ${fontFamily}`;

  const maxLineWidth = canvasW * 0.88;
  const rawLines = cleanedText.split('\n');
  const wrappedLines: string[] = [];

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (ctx.measureText(trimmed).width <= maxLineWidth) {
      wrappedLines.push(trimmed);
      continue;
    }
    const words = trimmed.split(/\s+/);
    let currentLine = '';
    for (const w of words) {
      const candidate = currentLine ? `${currentLine} ${w}` : w;
      if (ctx.measureText(candidate).width > maxLineWidth && currentLine) {
        wrappedLines.push(currentLine);
        currentLine = w;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine) {
      wrappedLines.push(currentLine);
    }
  }

  if (wrappedLines.length === 0) {
    if (typeof ctx.restore === 'function') {
      ctx.restore();
    }
    return;
  }

  const lineHeight = Math.round(fontSize * 1.35);
  const bottomMargin = aspect >= 1.0
    ? Math.max(12, Math.round(canvasH * 0.075))
    : Math.max(10, Math.round(canvasH * 0.045));
  const startBottomY = canvasH - bottomMargin;
  const strokeWidth = Math.max(2.2, Math.round(fontSize * 0.16));

  wrappedLines.forEach((textLine, idx) => {
    const lineY = startBottomY - (wrappedLines.length - 1 - idx) * lineHeight;
    const formattedLine = protectRtlPunctuation(textLine, isRtl);

    if (typeof ctx.save === 'function') {
      ctx.save();
    }
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = Math.max(3, Math.round(fontSize * 0.2));
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.lineWidth = strokeWidth;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(formattedLine, canvasW / 2, lineY);
    if (typeof ctx.restore === 'function') {
      ctx.restore();
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillText(formattedLine, canvasW / 2, lineY);
  });

  if (typeof ctx.restore === 'function') {
    ctx.restore();
  }
}

export function highlightActiveTranscriptSegment(currentSec: number, forcedLineId?: number): void {
  if (typeof document === 'undefined') return;
  const currentMs = Math.round(currentSec * 1000);
  const lines = getTranscriptLines();
  if (!lines || lines.length === 0) {
    renderCompanionSubtitle();
    return;
  }

  // Ensure timestamps are parsed and cached on line objects
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startMs === undefined || l.endMs === undefined) {
      const match = l.timeRange.match(/\[([\d:.,]+)\s*(?:-->|→)\s*([\d:.,]+)\]/);
      if (match) {
        l.startMs = parseTimestampStringToMs(match[1]) ?? 0;
        l.endMs = parseTimestampStringToMs(match[2]) ?? (l.startMs + 3000);
      } else {
        l.startMs = i * 2000;
        l.endMs = l.startMs + 2000;
      }
    }
  }

  let matchingLineId: number | null = null;

  if (typeof forcedLineId === 'number') {
    const forcedExists = lines.some(l => l.id === forcedLineId);
    if (forcedExists) {
      matchingLineId = forcedLineId;
    }
  }

  if (matchingLineId === null) {
    const candidates = lines.filter(l => {
      const s = l.startMs ?? 0;
      const e = l.endMs ?? (s + 3000);
      return currentMs >= s && currentMs <= e;
    });

    if (candidates.length === 1) {
      matchingLineId = candidates[0].id;
    } else if (candidates.length > 1) {
      const startingAtNow = candidates.find(l => (l.startMs ?? 0) === currentMs);
      if (startingAtNow) {
        matchingLineId = startingAtNow.id;
      } else {
        candidates.sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0));
        matchingLineId = candidates[0].id;
      }
    }
  }

  const currentActiveEl = document.querySelector('.transcript-card.active-playback') as HTMLElement | null;
  const isAlreadyActiveOnDOM = currentActiveEl && currentActiveEl.dataset.id === String(matchingLineId);

  const isAlreadyIdle = matchingLineId === null && currentHighlightedLineId === null && !currentActiveEl;
  if ((matchingLineId === currentHighlightedLineId && isAlreadyActiveOnDOM) || isAlreadyIdle) {
    renderCompanionSubtitle();
    return;
  }
  currentHighlightedLineId = matchingLineId;

  document.querySelectorAll('.transcript-card.active-playback').forEach(el => {
    el.classList.remove('active-playback');
  });

  if (matchingLineId !== null) {
    const cardEl = document.querySelector(`.transcript-card[data-id="${matchingLineId}"]`) as HTMLElement | null;
    if (cardEl) {
      cardEl.classList.add('active-playback');
      // Gentle auto-scroll into view if not actively typing or searching and card is visible
      const isUserEditing = document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT';
      if (cardEl.style.display !== 'none' && !isUserEditing) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  renderCompanionSubtitle();
}

export function initCompanionPlayerDOM(): void {
  if (typeof document === 'undefined') return;

  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl || (videoEl as any)._hasCompanionListeners) return;
  (videoEl as any)._hasCompanionListeners = true;

  const playIcon = document.getElementById('icon-companion-play');
  const pauseIcon = document.getElementById('icon-companion-pause');
  const timeCurrentEl = document.getElementById('companion-time-current');
  const timeTotalEl = document.getElementById('companion-time-total');
  const seekSlider = document.getElementById('companion-seek-slider') as HTMLInputElement | null;

  videoEl.addEventListener('play', () => {
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'block';
  });

  videoEl.addEventListener('pause', () => {
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
  });

  videoEl.addEventListener('seeking', () => {
    isVideoSeeking = true;
    renderCompanionSubtitle();
  });

  videoEl.addEventListener('seeked', () => {
    if (seekWatchdogTimer) {
      clearTimeout(seekWatchdogTimer);
      seekWatchdogTimer = null;
    }
    isSeeking = false;
    isVideoSeeking = false;
    const cur = videoEl.currentTime || 0;
    const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
    if (dur > 0 && seekSlider) {
      const pct = (cur / dur) * 100;
      seekSlider.value = String(pct);
      updateSliderTrackProgress(seekSlider, pct, '--seek-pct');
    }
    if (timeCurrentEl) updateCompanionTimeDisplay(timeCurrentEl, cur);
    const forcedId = explicitTargetLineId !== null ? explicitTargetLineId : undefined;
    explicitTargetLineId = null;
    highlightActiveTranscriptSegment(cur, forcedId);
    updateCompanionSubtitleBounds(false);
  });

  videoEl.addEventListener('timeupdate', () => {
    if (isSeeking || isVideoSeeking || videoEl.seeking) return;
    const cur = videoEl.currentTime || 0;
    const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
    if (timeCurrentEl) updateCompanionTimeDisplay(timeCurrentEl, cur);
    if (dur > 0 && seekSlider) {
      const pct = (cur / dur) * 100;
      seekSlider.value = String(pct);
      updateSliderTrackProgress(seekSlider, pct, '--seek-pct');
    }
    highlightActiveTranscriptSegment(cur);
  });

  videoEl.addEventListener('loadedmetadata', () => {
    const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
    if (timeTotalEl) updateCompanionTimeDisplay(timeTotalEl, dur);
    if (activeMediaInfo) {
      if (dur > 0) activeMediaInfo.durationSec = dur;
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        activeMediaInfo.width = videoEl.videoWidth;
        activeMediaInfo.height = videoEl.videoHeight;
        const ratio = videoEl.videoWidth / videoEl.videoHeight;
        activeMediaInfo.aspectRatio = ratio < 0.8
          ? '9:16'
          : (ratio >= 0.8 && ratio <= 1.2 ? '1:1' : (ratio > 1.2 && ratio < 1.5 ? '4:3' : '16:9'));
        const videoContainer = document.getElementById('companion-video-container');
        if (videoContainer) {
          if (ratio < 0.8) {
            videoContainer.classList.add('aspect-vertical');
          } else {
            videoContainer.classList.remove('aspect-vertical');
          }
        }
      }
      updateCompanionMetadataUI(activeMediaInfo);
      updateCompanionSubtitleBounds(true);
    }
  });

  videoEl.addEventListener('ended', () => {
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
  });

  videoEl.addEventListener('error', () => {
    const err = videoEl.error;
    console.warn('Companion media decoding error encountered:', err);
    videoEl.style.display = 'none';
    const audioFallback = document.getElementById('companion-audio-fallback');
    const audioNameEl = document.getElementById('companion-audio-name');
    if (audioFallback && audioNameEl && activeMediaInfo) {
      audioFallback.style.display = 'flex';
      audioNameEl.textContent = `${activeMediaInfo.fileName} (${t('transcribe.companionPlaybackError') || 'Playback error'})`;
    }
  });

  if (seekSlider) {
    seekSlider.addEventListener('pointerdown', () => {
      isSeeking = true;
    });

    seekSlider.addEventListener('input', () => {
      isSeeking = true;
      const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
      const pct = parseFloat(seekSlider.value) || 0;
      updateSliderTrackProgress(seekSlider, pct, '--seek-pct');
      const targetSec = (pct / 100) * dur;
      if (timeCurrentEl) updateCompanionTimeDisplay(timeCurrentEl, targetSec);
    });

    const commitSeek = () => {
      if (!isSeeking) return;
      isSeeking = false;
      const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
      const pct = parseFloat(seekSlider.value) || 0;
      updateSliderTrackProgress(seekSlider, pct, '--seek-pct');
      const targetSec = (pct / 100) * dur;
      if (timeCurrentEl) updateCompanionTimeDisplay(timeCurrentEl, targetSec);
      isVideoSeeking = true;
      videoEl.currentTime = targetSec;
      armSeekWatchdog();
    };

    seekSlider.addEventListener('change', commitSeek);
    seekSlider.addEventListener('pointerup', commitSeek);
    seekSlider.addEventListener('pointercancel', () => {
      isSeeking = false;
    });
  }

  const volSlider = document.getElementById('companion-volume-slider') as HTMLInputElement | null;
  if (volSlider) {
    const initVol = parseFloat(volSlider.value);
    const volVal = isNaN(initVol) ? 1.0 : initVol;
    updateSliderTrackProgress(volSlider, volVal * 100, '--vol-pct');
  }

  const speedBtn = document.getElementById('btn-companion-speed');
  if (speedBtn && !(speedBtn as any)._hasSpeedListeners) {
    (speedBtn as any)._hasSpeedListeners = true;
    speedBtn.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      cycleCompanionPlaybackRate(false);
    });
    speedBtn.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      cycleCompanionPlaybackRate(true);
    });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('fullscreenchange', updateFullscreenUI);
  }

  // Keyboard shortcut listener for spacebar play/pause
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing = (typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) ||
                        (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) ||
                        (typeof HTMLSelectElement !== 'undefined' && target instanceof HTMLSelectElement) ||
                        target?.isContentEditable;
      if (isEditing) return;

      // Do not intercept keyboard shortcuts if an application modal dialog is currently open
      const modalOverlay = document.getElementById('app-modal-overlay');
      if (modalOverlay && modalOverlay.style.display !== 'none') return;
      const shortcutsOverlay = document.getElementById('shortcuts-modal-overlay');
      if (shortcutsOverlay && (shortcutsOverlay.classList.contains('show') || shortcutsOverlay.style.display !== 'none')) return;

      const transcribePanel = document.getElementById('panel-transcribe');
      if (!transcribePanel || !transcribePanel.classList.contains('active')) return;

      // Do not intercept hotkeys if modifier keys (Ctrl, Alt, Meta, Shift) are held
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

      if (e.code === 'Space') {
        // If a non-play button is focused, allow native button activation via Space
        if (target?.tagName === 'BUTTON' && target.id !== 'btn-companion-play-toggle') {
          return;
        }
        const mediaDeck = document.getElementById('transcribe-media-deck');
        if (mediaDeck && mediaDeck.style.display !== 'none') {
          e.preventDefault();
          toggleCompanionPlayback();
        }
      } else if (e.code === 'ArrowLeft' || e.key === 'ArrowLeft') {
        const mediaDeck = document.getElementById('transcribe-media-deck');
        if (mediaDeck && mediaDeck.style.display !== 'none') {
          e.preventDefault();
          jumpCompanionPlayback(-5);
        }
      } else if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
        const mediaDeck = document.getElementById('transcribe-media-deck');
        if (mediaDeck && mediaDeck.style.display !== 'none') {
          e.preventDefault();
          jumpCompanionPlayback(5);
        }
      } else if (e.code === 'ArrowUp' || e.key === 'ArrowUp') {
        const mediaDeck = document.getElementById('transcribe-media-deck');
        if (mediaDeck && mediaDeck.style.display !== 'none') {
          e.preventDefault();
          adjustCompanionVolume(0.05);
        }
      } else if (e.code === 'ArrowDown' || e.key === 'ArrowDown') {
        const mediaDeck = document.getElementById('transcribe-media-deck');
        if (mediaDeck && mediaDeck.style.display !== 'none') {
          e.preventDefault();
          adjustCompanionVolume(-0.05);
        }
      }
    });

    window.addEventListener('whisper:languageChanged', () => {
      if (activeMediaInfo) {
        updateCompanionMetadataUI(activeMediaInfo);
      }
      updateFullscreenUI();
      changeCompanionPlaybackRate(String(currentCompanionSpeed));
    });

    const videoContainer = document.getElementById('companion-video-container');
    if (videoContainer && typeof ResizeObserver !== 'undefined' && !companionResizeObserver) {
      companionResizeObserver = new ResizeObserver(() => {
        updateCompanionSubtitleBounds(false);
      });
      companionResizeObserver.observe(videoContainer);
    }

    window.addEventListener('resize', () => {
      updateCompanionSubtitleBounds(false);
    });

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('fullscreenchange', () => {
        setTimeout(() => {
          updateCompanionSubtitleBounds(true);
        }, 60);
      });
    }
  }
}

// Bind to window for HTML event handlers
const win = getGlobal();
win.loadMediaIntoCompanionPlayer = loadMediaIntoCompanionPlayer;
win.showTranscribeSetupDeck = showTranscribeSetupDeck;
win.showTranscribeMediaDeck = showTranscribeMediaDeck;
win.toggleCompanionPlayback = toggleCompanionPlayback;
win.jumpCompanionPlayback = jumpCompanionPlayback;
win.seekCompanionPlayer = seekCompanionPlayer;
win.pauseCompanionPlayer = pauseCompanionPlayer;
win.unloadCompanionPlayer = unloadCompanionPlayer;
win.changeCompanionPlaybackRate = changeCompanionPlaybackRate;
win.cycleCompanionPlaybackRate = cycleCompanionPlaybackRate;
win.updateSliderTrackProgress = updateSliderTrackProgress;
win.COMPANION_SPEEDS = COMPANION_SPEEDS;
win.changeCompanionVolume = changeCompanionVolume;
win.adjustCompanionVolume = adjustCompanionVolume;
win.toggleCompanionMute = toggleCompanionMute;
win.toggleCompanionPiP = toggleCompanionPiP;
win.toggleCompanionFullscreen = toggleCompanionFullscreen;
win.updateFullscreenUI = updateFullscreenUI;
win.initCompanionPlayerDOM = initCompanionPlayerDOM;
win.formatTimecodeDisplay = formatTimecodeDisplay;
win.formatTimecodeHTML = formatTimecodeHTML;
win.updateCompanionTimeDisplay = updateCompanionTimeDisplay;
win.updateCompanionSubtitleBounds = updateCompanionSubtitleBounds;
win.renderCompanionSubtitle = renderCompanionSubtitle;
win.highlightActiveTranscriptSegment = highlightActiveTranscriptSegment;
