// Companion Player & Media Console Controller for Whisper Desktop
import { t } from '../i18n/index';
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
let currentHighlightedLineId: number | null = null;
let pendingSeekTargetSec: number | null = null;
let hasMetadataSeekListener = false;

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

  // Update PiP and Fullscreen button availability based on audio vs video
  const pipBtn = document.getElementById('btn-companion-pip') as HTMLButtonElement | null;
  const fullscreenBtn = document.getElementById('btn-companion-fullscreen') as HTMLButtonElement | null;
  if (pipBtn) {
    pipBtn.disabled = isAudioOnly;
    pipBtn.style.opacity = isAudioOnly ? '0.35' : '1';
    pipBtn.style.cursor = isAudioOnly ? 'not-allowed' : 'pointer';
  }
  if (fullscreenBtn) {
    fullscreenBtn.disabled = isAudioOnly;
    fullscreenBtn.style.opacity = isAudioOnly ? '0.35' : '1';
    fullscreenBtn.style.cursor = isAudioOnly ? 'not-allowed' : 'pointer';
  }

  // Set video source and wire events
  videoEl.src = streamUrl;
  videoEl.load();

  const seekSlider = document.getElementById('companion-seek-slider') as HTMLInputElement | null;
  if (seekSlider) seekSlider.value = '0';
  const timeCurrent = document.getElementById('companion-time-current');
  if (timeCurrent) timeCurrent.textContent = formatTimecodeDisplay(0);

  // Synchronize user-chosen playback rate and volume on the newly loaded media
  const speedSelect = document.getElementById('companion-speed-select') as HTMLSelectElement | null;
  if (speedSelect) {
    const rate = parseFloat(speedSelect.value) || 1.0;
    videoEl.playbackRate = rate;
  }
  const volSlider = document.getElementById('companion-volume-slider') as HTMLInputElement | null;
  if (volSlider) {
    const vol = parseFloat(volSlider.value);
    if (!isNaN(vol)) {
      videoEl.volume = Math.max(0, Math.min(1, vol));
      videoEl.muted = vol === 0;
      updateVolumeIcons(videoEl.muted || videoEl.volume === 0);
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

  if (fileNameEl) fileNameEl.textContent = info.fileName;
  if (durationEl) durationEl.textContent = formatTimecodeDisplay(info.durationSec);
  if (timeTotalEl) timeTotalEl.textContent = formatTimecodeDisplay(info.durationSec);

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
    videoEl.play().catch(e => console.warn('Video play error:', e));
  } else {
    videoEl.pause();
  }
}

export function jumpCompanionPlayback(seconds: number): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const targetTime = Math.max(0, Math.min(videoEl.duration || 999999, videoEl.currentTime + seconds));
  videoEl.currentTime = targetTime;
}

export function seekCompanionPlayer(targetMs: number, autoPlay?: boolean): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const targetSec = Math.max(0, targetMs / 1000);
  const shouldPlay = typeof autoPlay === 'boolean' ? autoPlay : !videoEl.paused;

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
  pendingSeekTargetSec = null;
  hasMetadataSeekListener = false;
  currentHighlightedLineId = null;
  if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('.transcript-card.active-playback').forEach(el => {
      el.classList.remove('active-playback');
    });
  }
  const seekSlider = document.getElementById('companion-seek-slider') as HTMLInputElement | null;
  if (seekSlider) seekSlider.value = '0';
  const timeCurrent = document.getElementById('companion-time-current');
  if (timeCurrent) timeCurrent.textContent = formatTimecodeDisplay(0);
  const timeTotal = document.getElementById('companion-time-total');
  if (timeTotal) timeTotal.textContent = formatTimecodeDisplay(0);
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
  const pipBtn = document.getElementById('btn-companion-pip') as HTMLButtonElement | null;
  const fullscreenBtn = document.getElementById('btn-companion-fullscreen') as HTMLButtonElement | null;
  if (pipBtn) {
    pipBtn.disabled = false;
    pipBtn.style.opacity = '1';
    pipBtn.style.cursor = 'pointer';
  }
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
  if (!videoEl) return;
  const rate = parseFloat(rateStr) || 1.0;
  videoEl.playbackRate = rate;
}

let lastNonZeroVolume = 1.0;

export function changeCompanionVolume(volStr: string): void {
  const videoEl = document.getElementById('companion-media-element') as HTMLVideoElement | null;
  if (!videoEl) return;
  const parsed = parseFloat(volStr);
  const vol = Math.max(0, Math.min(1, isNaN(parsed) ? 1.0 : parsed));
  videoEl.volume = vol;
  videoEl.muted = vol === 0;
  if (vol > 0) {
    lastNonZeroVolume = vol;
  }
  updateVolumeIcons(videoEl.muted || vol === 0);
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
}

function updateVolumeIcons(isMuted: boolean): void {
  const highIcon = document.getElementById('icon-vol-high');
  const muteIcon = document.getElementById('icon-vol-muted');
  if (highIcon) highIcon.style.display = isMuted ? 'none' : 'block';
  if (muteIcon) muteIcon.style.display = isMuted ? 'block' : 'none';
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

export async function toggleCompanionFullscreen(): Promise<void> {
  const stage = document.getElementById('companion-player-stage');
  if (!stage) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (stage.requestFullscreen) {
      await stage.requestFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen error:', err);
  }
}

export function highlightActiveTranscriptSegment(currentSec: number): void {
  if (typeof document === 'undefined') return;
  const currentMs = currentSec * 1000;
  const lines = getTranscriptLines();
  if (!lines || lines.length === 0) return;

  let matchingLineId: number | null = null;

  // Fast path for continuous forward/current playback: check current or next segment first
  if (currentHighlightedLineId !== null && currentHighlightedLineId >= 0 && currentHighlightedLineId < lines.length) {
    const curLine = lines[currentHighlightedLineId];
    let curStart = curLine.startMs;
    let curEnd = curLine.endMs;
    if (curStart === undefined || curEnd === undefined) {
      const match = curLine.timeRange.match(/\[([\d:.,]+)\s*(?:-->|→)\s*([\d:.,]+)\]/);
      if (match) {
        curStart = parseTimestampStringToMs(match[1]) ?? 0;
        curEnd = parseTimestampStringToMs(match[2]) ?? (curStart + 3000);
      }
      if (curStart !== undefined && curEnd !== undefined) {
        curLine.startMs = curStart;
        curLine.endMs = curEnd;
      }
    }
    if (curStart !== undefined && curEnd !== undefined && currentMs >= curStart && currentMs <= curEnd) {
      matchingLineId = curLine.id;
    } else if (currentHighlightedLineId + 1 < lines.length) {
      const nextLine = lines[currentHighlightedLineId + 1];
      let nextStart = nextLine.startMs;
      let nextEnd = nextLine.endMs;
      if (nextStart === undefined || nextEnd === undefined) {
        const match = nextLine.timeRange.match(/\[([\d:.,]+)\s*(?:-->|→)\s*([\d:.,]+)\]/);
        if (match) {
          nextStart = parseTimestampStringToMs(match[1]) ?? 0;
          nextEnd = parseTimestampStringToMs(match[2]) ?? (nextStart + 3000);
        }
        if (nextStart !== undefined && nextEnd !== undefined) {
          nextLine.startMs = nextStart;
          nextLine.endMs = nextEnd;
        }
      }
      if (nextStart !== undefined && nextEnd !== undefined && currentMs >= nextStart && currentMs <= nextEnd) {
        matchingLineId = nextLine.id;
      }
    }
  }

  // Fallback: binary search if seek jumped or fast path did not match
  if (matchingLineId === null) {
    let low = 0;
    let high = lines.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const midLine = lines[mid];
      let sMs = midLine.startMs;
      let eMs = midLine.endMs;
      if (sMs === undefined || eMs === undefined) {
        const match = midLine.timeRange.match(/\[([\d:.,]+)\s*(?:-->|→)\s*([\d:.,]+)\]/);
        if (match) {
          sMs = parseTimestampStringToMs(match[1]) ?? 0;
          eMs = parseTimestampStringToMs(match[2]) ?? (sMs + 3000);
        } else {
          sMs = mid * 2000;
          eMs = sMs + 2000;
        }
        if (sMs !== undefined && eMs !== undefined) {
          midLine.startMs = sMs;
          midLine.endMs = eMs;
        }
      }
      if (currentMs >= sMs && currentMs <= eMs) {
        matchingLineId = midLine.id;
        break;
      } else if (currentMs < sMs) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
  }

  const currentActiveEl = document.querySelector('.transcript-card.active-playback') as HTMLElement | null;
  const isAlreadyActiveOnDOM = currentActiveEl && currentActiveEl.dataset.id === String(matchingLineId);

  const isAlreadyIdle = matchingLineId === null && currentHighlightedLineId === null && !currentActiveEl;
  if ((matchingLineId === currentHighlightedLineId && isAlreadyActiveOnDOM) || isAlreadyIdle) return;
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

  videoEl.addEventListener('timeupdate', () => {
    const cur = videoEl.currentTime || 0;
    const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
    if (timeCurrentEl) timeCurrentEl.textContent = formatTimecodeDisplay(cur);
    if (!isSeeking && seekSlider && dur > 0) {
      seekSlider.value = String((cur / dur) * 100);
    }
    highlightActiveTranscriptSegment(cur);
  });

  videoEl.addEventListener('loadedmetadata', () => {
    const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
    if (timeTotalEl) timeTotalEl.textContent = formatTimecodeDisplay(dur);
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
    seekSlider.addEventListener('input', () => {
      isSeeking = true;
      const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
      const pct = parseFloat(seekSlider.value) || 0;
      const targetSec = (pct / 100) * dur;
      if (timeCurrentEl) timeCurrentEl.textContent = formatTimecodeDisplay(targetSec);
    });

    seekSlider.addEventListener('change', () => {
      const dur = videoEl.duration || activeMediaInfo?.durationSec || 0;
      const pct = parseFloat(seekSlider.value) || 0;
      videoEl.currentTime = (pct / 100) * dur;
      isSeeking = false;
    });
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
      } else if (e.code === 'ArrowLeft') {
        const mediaDeck = document.getElementById('transcribe-media-deck');
        if (mediaDeck && mediaDeck.style.display !== 'none') {
          e.preventDefault();
          jumpCompanionPlayback(-5);
        }
      } else if (e.code === 'ArrowRight') {
        const mediaDeck = document.getElementById('transcribe-media-deck');
        if (mediaDeck && mediaDeck.style.display !== 'none') {
          e.preventDefault();
          jumpCompanionPlayback(5);
        }
      }
    });

    window.addEventListener('whisper:languageChanged', () => {
      if (activeMediaInfo) {
        updateCompanionMetadataUI(activeMediaInfo);
      }
    });
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
win.changeCompanionVolume = changeCompanionVolume;
win.toggleCompanionMute = toggleCompanionMute;
win.toggleCompanionPiP = toggleCompanionPiP;
win.toggleCompanionFullscreen = toggleCompanionFullscreen;
win.initCompanionPlayerDOM = initCompanionPlayerDOM;
