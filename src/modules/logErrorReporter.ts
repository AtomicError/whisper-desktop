// Global Frontend Error & Unhandled Rejection Reporter for Activity Logs
export interface FrontendErrorEntry {
  category: string;
  message: string;
  timestamp: string;
}

export interface FrontendErrorReporterDeps {
  formatTimestamp: () => string;
  onRecord: (entry: FrontendErrorEntry) => void;
}

const TOAST_THROTTLE_MS = 3000;

export function createFrontendErrorReporter(deps: FrontendErrorReporterDeps) {
  let lastGlobalErrorToastAt = -TOAST_THROTTLE_MS - 1;

  function resetThrottle(): void {
    lastGlobalErrorToastAt = -TOAST_THROTTLE_MS - 1;
  }

  function recordFrontendError(msgText: string, locationSuffix: string): void {
    const entry: FrontendErrorEntry = {
      category: 'System',
      message: `Frontend error: ${msgText}${locationSuffix}`,
      timestamp: deps.formatTimestamp()
    };

    try {
      deps.onRecord(entry);
    } catch (_) {
      // Ignore secondary logging errors
    }

    const nowMs = Date.now();
    if (nowMs - lastGlobalErrorToastAt > TOAST_THROTTLE_MS) {
      lastGlobalErrorToastAt = nowMs;
      try {
        const showNotification = typeof window !== 'undefined' ? (window as any).showNotification : null;
        if (typeof showNotification === 'function') {
          showNotification(msgText, 'error');
        }
      } catch (_) {
        // Ignore secondary notification errors
      }
    }
  }

  function reportGlobalFrontendError(
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error
  ): boolean {
    const msgText = typeof message === 'string'
      ? message
      : (error?.message || 'Unexpected frontend error');

    if (msgText.includes('ResizeObserver loop')) {
      return false;
    }

    const locationParts = [source, lineno, colno].filter(v => v !== undefined && v !== null && v !== '');
    const locationSuffix = locationParts.length > 0 ? ` (${locationParts.join(':')})` : '';
    recordFrontendError(msgText, locationSuffix);

    return false;
  }

  function reportUnhandledRejection(event: { reason?: unknown } | PromiseRejectionEvent): void {
    const reason = event?.reason;
    let msgText = 'Unhandled promise rejection';
    if (typeof reason === 'string') {
      if (reason.trim()) {
        msgText = reason;
      }
    } else if (reason && typeof reason === 'object' && 'message' in reason && typeof (reason as any).message === 'string') {
      if ((reason as any).message.trim()) {
        msgText = (reason as any).message;
      }
    } else if (reason !== undefined && reason !== null) {
      try {
        const converted = String(reason);
        if (converted.trim()) {
          msgText = converted;
        }
      } catch (_) {
        // Fallback for null-prototype or non-coercible rejection objects
      }
    }

    if (msgText.includes('ResizeObserver loop')) {
      return;
    }
    recordFrontendError(msgText, '');
  }

  return {
    reportGlobalFrontendError,
    reportUnhandledRejection,
    resetThrottle
  };
}
