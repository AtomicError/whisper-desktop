/**
 * Whisper Desktop - Transcription Studio Layout Resizer
 *
 * Implements a tactile, high-performance split-pane resizer between
 * the Left Deck (Setup / Media Companion Player) and Right Deck (Live Transcript Viewer).
 *
 * Features:
 *  - Drag-to-resize via Pointer Events with setPointerCapture.
 *  - Bidirectional RTL/LTR support (direction-aware delta calculation).
 *  - Strict minimum width boundary (cannot shrink below default width ~400px).
 *  - Maximum width boundary (guarantees transcript viewer maintains minimum reading width).
 *  - Magnetic snapping to factory default (420px) within snap threshold zone.
 *  - Instant reset to factory default via double-click with smooth animation.
 *  - Keyboard accessibility (ArrowLeft, ArrowRight, Home/Enter to reset).
 *  - LocalStorage state persistence across views and app restarts.
 *  - Defensive cleanup and window resize clamping.
 */

export const DEFAULT_LEFT_PANEL_WIDTH = 420;
export const MIN_LEFT_PANEL_WIDTH = 420;
export const MIN_RIGHT_PANEL_WIDTH = 420;
export const RESIZER_COLUMN_WIDTH = 12;
export const RESIZER_GAP = 8;
export const SNAP_THRESHOLD = 20; // ±20px magnetic pull around DEFAULT_LEFT_PANEL_WIDTH
export const STORAGE_KEY = 'whisper_transcribe_left_panel_width';

let isDragging = false;
let startX = 0;
let initialWidth = DEFAULT_LEFT_PANEL_WIDTH;
let currentWidth = DEFAULT_LEFT_PANEL_WIDTH;
let activePointerId: number | null = null;
let initialized = false;

function getStoredWidth(): number {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_LEFT_PANEL_WIDTH;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LEFT_PANEL_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= MIN_LEFT_PANEL_WIDTH) {
      return parsed;
    }
  } catch (_) {
    // Defensive fallback on storage errors
  }
  return DEFAULT_LEFT_PANEL_WIDTH;
}

export function isRtlLayout(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.getAttribute('dir') === 'rtl' ||
    document.documentElement.classList.contains('rtl-layout')
  );
}

export function calculateMaxLeftWidth(containerWidth: number): number {
  const minRequired = MIN_RIGHT_PANEL_WIDTH + RESIZER_COLUMN_WIDTH + RESIZER_GAP;
  const available = containerWidth - minRequired;
  return Math.max(MIN_LEFT_PANEL_WIDTH, available);
}

export function getTranscribeLeftPanelWidth(): number {
  return currentWidth;
}

export function updateTranscriptViewerResponsive(cardWidth?: number): void {
  if (typeof document === 'undefined') return;
  const viewerCard = document.getElementById('transcribe-viewer-card');
  if (!viewerCard) return;

  const width = cardWidth !== undefined
    ? cardWidth
    : (viewerCard.getBoundingClientRect ? viewerCard.getBoundingClientRect().width : 0);

  if (width <= 0) return;

  viewerCard.classList.toggle('is-compact', width < 860);
  viewerCard.classList.toggle('is-ultra-compact', width < 640);
}

export function setTranscribeLeftPanelWidth(
  targetWidth: number,
  saveToStorage: boolean = true,
  enableSnapping: boolean = true
): number {
  if (typeof document === 'undefined') return targetWidth;
  const layoutEl = document.getElementById('transcribe-layout');
  const resizerEl = document.getElementById('transcribe-layout-resizer');

  const rectWidth = layoutEl ? layoutEl.getBoundingClientRect().width : 0;
  // If the layout element exists but has zero/negative width (e.g. inside a hidden tab with display: none),
  // do NOT clamp down against 0 width, which would erroneously wipe out the custom width!
  if (layoutEl && rectWidth <= 0) {
    return currentWidth;
  }

  const containerWidth = rectWidth > 0
    ? rectWidth
    : (typeof window !== 'undefined' ? window.innerWidth : 1200);

  const maxLeft = calculateMaxLeftWidth(containerWidth);

  let clamped = Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(maxLeft, targetWidth));

  // Magnetic snapping: when pulling back towards default width within the threshold zone [DEFAULT, DEFAULT + SNAP]
  const isNearDefault = clamped >= DEFAULT_LEFT_PANEL_WIDTH && clamped <= DEFAULT_LEFT_PANEL_WIDTH + SNAP_THRESHOLD;
  if (enableSnapping && isNearDefault) {
    clamped = DEFAULT_LEFT_PANEL_WIDTH;
  }

  currentWidth = Math.round(clamped);

  if (layoutEl) {
    layoutEl.style.setProperty('--transcribe-left-panel-width', `${currentWidth}px`);
  }

  if (resizerEl) {
    resizerEl.setAttribute('aria-valuenow', currentWidth.toString());
    resizerEl.setAttribute('aria-valuemin', MIN_LEFT_PANEL_WIDTH.toString());
    resizerEl.setAttribute('aria-valuemax', maxLeft.toString());
    const isAtDefault = Math.abs(currentWidth - DEFAULT_LEFT_PANEL_WIDTH) <= 2;
    resizerEl.classList.toggle('is-snapped', isAtDefault);
  }

  // Update responsive classes on transcript viewer card
  const estimatedRightWidth = Math.max(0, containerWidth - currentWidth - RESIZER_COLUMN_WIDTH - RESIZER_GAP);
  updateTranscriptViewerResponsive(estimatedRightWidth);

  if (saveToStorage) {
    try {
      if (typeof localStorage !== 'undefined') {
        if (Math.abs(currentWidth - DEFAULT_LEFT_PANEL_WIDTH) <= 2) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          localStorage.setItem(STORAGE_KEY, currentWidth.toString());
        }
      }
    } catch (_) {
      // Storage access blocked or restricted
    }
  }

  return currentWidth;
}

export function resetTranscribeLayoutWidth(): void {
  if (typeof document === 'undefined') return;
  const layoutEl = document.getElementById('transcribe-layout');

  if (layoutEl) {
    layoutEl.classList.add('is-animating');
  }

  setTranscribeLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH, true, false);

  if (layoutEl) {
    setTimeout(() => {
      layoutEl.classList.remove('is-animating');
    }, 260);
  }
}

function handlePointerDown(e: PointerEvent): void {
  if (e.button !== 0) return; // Only primary mouse button
  const resizerEl = e.currentTarget as HTMLElement | null;
  if (!resizerEl) return;

  isDragging = true;
  activePointerId = e.pointerId;
  startX = e.clientX;

  const leftPanel = document.getElementById('transcribe-left-panel');
  if (leftPanel) {
    initialWidth = leftPanel.getBoundingClientRect().width || currentWidth;
  } else {
    initialWidth = currentWidth;
  }

  try {
    resizerEl.setPointerCapture(e.pointerId);
  } catch (_) {}

  document.body.classList.add('is-resizing-transcribe');
  e.preventDefault();
}

function handlePointerMove(e: PointerEvent): void {
  if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) {
    return;
  }

  const isRtl = isRtlLayout();
  // In RTL, dragging toward the left expands the right-docked left-panel
  const delta = isRtl ? (startX - e.clientX) : (e.clientX - startX);
  const targetWidth = initialWidth + delta;

  setTranscribeLeftPanelWidth(targetWidth, false, true);
}

function stopDragging(targetEl?: HTMLElement | null): void {
  if (!isDragging) return;

  const resizerEl = targetEl || (typeof document !== 'undefined' ? document.getElementById('transcribe-layout-resizer') : null);
  if (resizerEl && activePointerId !== null) {
    try {
      resizerEl.releasePointerCapture(activePointerId);
    } catch (_) {}
  }

  isDragging = false;
  activePointerId = null;
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.remove('is-resizing-transcribe');
  }

  // Persist final width
  setTranscribeLeftPanelWidth(currentWidth, true, true);
}

function handlePointerUp(e?: PointerEvent | null): void {
  if (!isDragging) return;
  if (e && activePointerId !== null && e.pointerId !== activePointerId) return;

  const targetEl = e?.currentTarget as HTMLElement | null;
  stopDragging(targetEl);
}

function handlePointerCancel(e: PointerEvent): void {
  handlePointerUp(e);
}

function handleDblClick(e: MouseEvent): void {
  e.preventDefault();
  resetTranscribeLayoutWidth();
}

function handleKeyDown(e: KeyboardEvent): void {
  const isRtl = isRtlLayout();
  const step = e.shiftKey ? 48 : 20;

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    const dirStep = isRtl ? -step : step;
    setTranscribeLeftPanelWidth(currentWidth + dirStep, true, false);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const dirStep = isRtl ? step : -step;
    setTranscribeLeftPanelWidth(currentWidth + dirStep, true, false);
  } else if (e.key === 'Home' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    resetTranscribeLayoutWidth();
  }
}

export function initTranscribeLayoutResizer(): void {
  if (typeof document === 'undefined') return;

  const resizerEl = document.getElementById('transcribe-layout-resizer');
  const layoutEl = document.getElementById('transcribe-layout');
  if (!resizerEl || !layoutEl) return;

  // Restore initial or saved width
  const savedWidth = getStoredWidth();
  setTranscribeLeftPanelWidth(savedWidth, false, false);

  if (initialized) return;
  initialized = true;

  resizerEl.addEventListener('pointerdown', handlePointerDown as EventListener);
  resizerEl.addEventListener('pointermove', handlePointerMove as EventListener);
  resizerEl.addEventListener('pointerup', handlePointerUp as EventListener);
  resizerEl.addEventListener('pointercancel', handlePointerCancel as EventListener);
  resizerEl.addEventListener('lostpointercapture', () => stopDragging(resizerEl));
  resizerEl.addEventListener('dblclick', handleDblClick as EventListener);
  resizerEl.addEventListener('keydown', handleKeyDown as EventListener);

  window.addEventListener('resize', () => {
    // Only clamp on desktop viewports where split layout is active (> 1024px)
    if (typeof window !== 'undefined' && window.innerWidth <= 1024) return;
    setTranscribeLeftPanelWidth(currentWidth, false, false);
  });

  window.addEventListener('blur', () => {
    if (isDragging) {
      stopDragging(resizerEl);
    }
  });

  const viewerCard = document.getElementById('transcribe-viewer-card');
  if (viewerCard && typeof ResizeObserver !== 'undefined') {
    try {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          updateTranscriptViewerResponsive(w);
        }
      });
      ro.observe(viewerCard);
    } catch (_) {}
  }
}

/**
 * Resets module internal state for tests.
 */
export function resetModuleStateForTest(): void {
  isDragging = false;
  startX = 0;
  initialWidth = DEFAULT_LEFT_PANEL_WIDTH;
  currentWidth = DEFAULT_LEFT_PANEL_WIDTH;
  activePointerId = null;
  initialized = false;
}
