// Scroll, Auto-Scroll Coalescing, and Jump-Pill State for the Activity Log Viewport
const APPEND_SCROLL_COALESCE_MS = 80;
const JUMP_PILL_THRESHOLD_PX = 140;
const SCROLL_UP_DISENGAGE_THRESHOLD_PX = 16;

const attachedScrollViewports = new WeakSet<object>();
const attachedAutoScrollInputs = new WeakSet<object>();

let _lastViewportScrollTop = 0;
let _isProgrammaticBottomScroll = false;
let _programmaticBottomScrollTimer: ReturnType<typeof setTimeout> | null = null;
let _appendScrollDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _scrollRafId: number | null = null;
let _redrawScrollRafId: number | null = null;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function cancelPendingScrollRaf(): void {
  if (typeof cancelAnimationFrame !== 'function') {
    _scrollRafId = null;
    _redrawScrollRafId = null;
    return;
  }
  if (_scrollRafId !== null) {
    cancelAnimationFrame(_scrollRafId);
    _scrollRafId = null;
  }
  if (_redrawScrollRafId !== null) {
    cancelAnimationFrame(_redrawScrollRafId);
    _redrawScrollRafId = null;
  }
}

export function cancelPendingAppendScroll(): void {
  if (_appendScrollDebounceTimer !== null) {
    clearTimeout(_appendScrollDebounceTimer);
    _appendScrollDebounceTimer = null;
  }
}

export function cancelProgrammaticBottomScroll(): void {
  _isProgrammaticBottomScroll = false;
  if (_programmaticBottomScrollTimer !== null) {
    clearTimeout(_programmaticBottomScrollTimer);
    _programmaticBottomScrollTimer = null;
  }
}

export function resetLogScrollState(): void {
  _lastViewportScrollTop = 0;
  cancelPendingAppendScroll();
  cancelPendingScrollRaf();
  cancelProgrammaticBottomScroll();
}

export function syncLastViewportScrollTop(scrollTop: number): void {
  _lastViewportScrollTop = scrollTop;
}

export function armRedrawProgrammaticBottomScroll(): void {
  cancelProgrammaticBottomScroll();
  _isProgrammaticBottomScroll = true;
  _programmaticBottomScrollTimer = setTimeout(() => {
    _isProgrammaticBottomScroll = false;
    _programmaticBottomScrollTimer = null;
  }, 100);
}

export function scheduleRedrawBottomScroll(viewport: HTMLElement): void {
  const commitBottomScroll = () => {
    _redrawScrollRafId = null;
    if (typeof document === 'undefined') {
      cancelProgrammaticBottomScroll();
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
    _lastViewportScrollTop = viewport.scrollTop;
    cancelProgrammaticBottomScroll();
    updateLogJumpPillVisibility();
  };
  if (typeof requestAnimationFrame === 'function') {
    _redrawScrollRafId = requestAnimationFrame(commitBottomScroll);
  } else {
    commitBottomScroll();
  }
}

export function scheduleAppendAutoScroll(viewport: HTMLElement): void {
  // Coalesce rapid bursts without resetting the timer so continuous streams stay pinned to bottom
  if (_appendScrollDebounceTimer !== null) return;
  _appendScrollDebounceTimer = setTimeout(() => {
    _appendScrollDebounceTimer = null;
    if (typeof document === 'undefined') return;
    const liveAutoScroll = (document.getElementById('log-autoscroll') as HTMLInputElement | null)?.checked;
    if (!liveAutoScroll) {
      updateLogJumpPillVisibility();
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
    _lastViewportScrollTop = viewport.scrollTop;
    updateLogJumpPillVisibility();
  }, APPEND_SCROLL_COALESCE_MS);
}

export function updateLogJumpPillVisibility(): void {
  if (typeof document === 'undefined') return;
  const viewport = document.getElementById('log-viewport');
  const pill = document.getElementById('btn-logs-jump-bottom');
  if (!viewport || !pill) return;

  const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  const isScrollable = viewport.scrollHeight > viewport.clientHeight + 60;

  if (isScrollable && distanceFromBottom > JUMP_PILL_THRESHOLD_PX) {
    pill.classList.add('visible');
  } else {
    pill.classList.remove('visible');
  }
}

export function scrollLogsToBottom(smooth = false): void {
  if (typeof document === 'undefined') return;
  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;
  cancelPendingAppendScroll();
  cancelPendingScrollRaf();

  const pill = document.getElementById('btn-logs-jump-bottom');
  if (pill) {
    pill.classList.remove('visible');
  }
  const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  const isScrollable = viewport.scrollHeight > viewport.clientHeight + 2;
  const effectiveSmooth = smooth && isScrollable && distanceFromBottom > 2 && !prefersReducedMotion();

  cancelProgrammaticBottomScroll();
  if (effectiveSmooth) {
    _isProgrammaticBottomScroll = true;
    _programmaticBottomScrollTimer = setTimeout(() => {
      _isProgrammaticBottomScroll = false;
      _programmaticBottomScrollTimer = null;
      updateLogJumpPillVisibility();
    }, 1200);
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  } else {
    viewport.scrollTop = viewport.scrollHeight;
    _lastViewportScrollTop = viewport.scrollTop;
  }

  const autoScroll = document.getElementById('log-autoscroll') as HTMLInputElement | null;
  if (autoScroll && !autoScroll.checked) {
    autoScroll.checked = true;
  }
  if (!effectiveSmooth) {
    updateLogJumpPillVisibility();
  }
}

export function scrollLogsToTop(smooth = false): void {
  if (typeof document === 'undefined') return;
  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;
  cancelPendingAppendScroll();
  cancelPendingScrollRaf();
  cancelProgrammaticBottomScroll();

  const effectiveSmooth = smooth && !prefersReducedMotion();
  if (effectiveSmooth) {
    viewport.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    viewport.scrollTop = 0;
    _lastViewportScrollTop = viewport.scrollTop;
  }
  const autoScroll = document.getElementById('log-autoscroll') as HTMLInputElement | null;
  if (autoScroll) {
    autoScroll.checked = false;
  }
  updateLogJumpPillVisibility();
}

function attachViewportScrollListeners(logViewport: HTMLElement): void {
  attachedScrollViewports.add(logViewport);
  _lastViewportScrollTop = logViewport.scrollTop || 0;

  logViewport.addEventListener('wheel', (e: WheelEvent) => {
    if (e.deltaY < 0 && logViewport.scrollHeight > logViewport.clientHeight) {
      cancelPendingAppendScroll();
      cancelProgrammaticBottomScroll();
      if (typeof document === 'undefined') return;
      const autoScrollEl = document.getElementById('log-autoscroll') as HTMLInputElement | null;
      if (autoScrollEl && autoScrollEl.checked) {
        autoScrollEl.checked = false;
      }
    }
  }, { passive: true });

  logViewport.addEventListener('scroll', () => {
    const immediateDistance = logViewport.scrollHeight - logViewport.scrollTop - logViewport.clientHeight;
    const immediateScrolledUp = logViewport.scrollTop < _lastViewportScrollTop;
    // Cancel pending append scroll only when user actually scrolled up or an explicit scroll-up crossed threshold
    if (
      !_isProgrammaticBottomScroll &&
      immediateScrolledUp &&
      immediateDistance > SCROLL_UP_DISENGAGE_THRESHOLD_PX
    ) {
      cancelPendingAppendScroll();
    }
    if (_scrollRafId !== null || typeof requestAnimationFrame !== 'function') return;
    _scrollRafId = requestAnimationFrame(() => {
      _scrollRafId = null;
      if (typeof document === 'undefined') return;
      const currentScrollTop = logViewport.scrollTop;
      const scrolledDown = currentScrollTop > _lastViewportScrollTop;
      const scrolledUp = currentScrollTop < _lastViewportScrollTop;
      _lastViewportScrollTop = currentScrollTop;

      const autoScrollEl = document.getElementById('log-autoscroll') as HTMLInputElement | null;
      const distanceFromBottom = logViewport.scrollHeight - currentScrollTop - logViewport.clientHeight;
      const isScrollable = logViewport.scrollHeight > logViewport.clientHeight + 2;

      if (_isProgrammaticBottomScroll && distanceFromBottom <= 2) {
        cancelProgrammaticBottomScroll();
      } else if (
        !_isProgrammaticBottomScroll &&
        ((distanceFromBottom > JUMP_PILL_THRESHOLD_PX && _appendScrollDebounceTimer === null) ||
          (scrolledUp && distanceFromBottom > SCROLL_UP_DISENGAGE_THRESHOLD_PX))
      ) {
        if (autoScrollEl && autoScrollEl.checked) {
          autoScrollEl.checked = false;
        }
      } else if (!_isProgrammaticBottomScroll && isScrollable && scrolledDown && distanceFromBottom <= 8) {
        if (autoScrollEl && !autoScrollEl.checked) {
          autoScrollEl.checked = true;
        }
      }

      if (!_isProgrammaticBottomScroll) {
        updateLogJumpPillVisibility();
      }
    });
  }, { passive: true });

  logViewport.addEventListener('scrollend', () => {
    if (_isProgrammaticBottomScroll) {
      _lastViewportScrollTop = logViewport.scrollTop;
      cancelProgrammaticBottomScroll();
      updateLogJumpPillVisibility();
    }
  }, { passive: true });
}

export function setupLogsControls(): void {
  if (typeof document === 'undefined') return;
  const logViewport = document.getElementById('log-viewport');
  if (logViewport && !attachedScrollViewports.has(logViewport)) {
    attachViewportScrollListeners(logViewport);
  }

  const autoScrollEl = document.getElementById('log-autoscroll') as HTMLInputElement | null;
  if (autoScrollEl && !attachedAutoScrollInputs.has(autoScrollEl)) {
    attachedAutoScrollInputs.add(autoScrollEl);
    autoScrollEl.addEventListener('change', () => {
      if (autoScrollEl.checked) {
        scrollLogsToBottom(true);
      } else {
        cancelPendingAppendScroll();
        cancelProgrammaticBottomScroll();
      }
    });
  }
}
