export interface ErrorStateProps {
  title?: string;
  error?: Error | string | null;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

function parseErrorMessage(err?: Error | string | null): { parsedTitle: string; message: string } {
  const raw = typeof err === 'string' ? err : err?.message ?? '';
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  if (isOffline || /Failed to fetch|NetworkError|unreachable|TypeError/i.test(raw)) {
    return {
      parsedTitle: 'Connection lost',
      message: 'We couldn’t connect to the server. Please check your network connection and try again.',
    };
  }

  if (/HTTP 401|401/i.test(raw)) {
    return {
      parsedTitle: 'Session expired',
      message: 'Your authentication key is no longer valid. Please sign in again.',
    };
  }

  if (/HTTP 5\d\d|500|502|503|504/i.test(raw)) {
    return {
      parsedTitle: 'Server temporary issue',
      message: 'The platform server encountered a temporary error. Please try again.',
    };
  }

  if (/HTTP 403|403/i.test(raw)) {
    return {
      parsedTitle: 'Access denied',
      message: 'You do not have permission to perform this request.',
    };
  }

  return {
    parsedTitle: 'Something went wrong',
    message: raw || 'An unexpected error occurred while fetching data.',
  };
}

export default function ErrorState({
  title,
  error,
  onRetry,
  compact = false,
  className = '',
}: ErrorStateProps) {
  const { parsedTitle, message } = parseErrorMessage(error);
  const displayTitle = title || parsedTitle;

  return (
    <div
      className={`error-state ${compact ? 'error-state-compact' : ''} ${className}`.trim()}
      role="alert"
      aria-live="assertive"
    >
      <div className="error-state-content">
        <div className="error-state-header">
          <svg className="error-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="error-state-title">{displayTitle}</span>
        </div>
        <p className="error-state-desc">{message}</p>
      </div>

      {onRetry && (
        <button
          type="button"
          className="btn btn-ghost btn-sm error-retry-btn"
          onClick={onRetry}
          aria-label={`Retry ${displayTitle}`}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Retry
        </button>
      )}
    </div>
  );
}
