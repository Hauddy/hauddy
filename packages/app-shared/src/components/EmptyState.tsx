import { ReactNode } from 'react';

export interface EmptyStateProps {
  title?: string;
  description: ReactNode;
  icon?: 'agent' | 'message' | 'contact' | 'connector' | 'search' | ReactNode;
  action?: ReactNode;
  className?: string;
}

function renderIcon(icon: EmptyStateProps['icon']) {
  if (!icon) return null;
  if (typeof icon !== 'string') return <div className="empty-state-icon">{icon}</div>;

  switch (icon) {
    case 'agent':
      return (
        <svg className="empty-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" strokeWidth="2.5" />
          <line x1="16" y1="16" x2="16" y2="16" strokeWidth="2.5" />
        </svg>
      );
    case 'message':
      return (
        <svg className="empty-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'contact':
      return (
        <svg className="empty-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'connector':
      return (
        <svg className="empty-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'search':
      return (
        <svg className="empty-state-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    default:
      return null;
  }
}

export default function EmptyState({ title, description, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`.trim()} role="region" aria-label={title || 'Empty'}>
      {renderIcon(icon)}
      {title && <h3 className="empty-state-title">{title}</h3>}
      <div className="empty-state-desc">{description}</div>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
