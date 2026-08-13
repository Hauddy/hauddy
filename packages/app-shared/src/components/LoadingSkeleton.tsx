import { HTMLAttributes } from 'react';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
}

export function SkeletonText({
  width = '100%',
  height = '14px',
  borderRadius = '4px',
  className = '',
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={`skeleton-box skeleton-text ${className}`.trim()}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonRow({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton-row ${className}`.trim()} aria-hidden="true">
      <div className="skeleton-row-left">
        <div className="skeleton-dot" />
        <SkeletonText width="140px" height="16px" />
        <SkeletonText width="180px" height="13px" />
      </div>
      <div className="skeleton-row-right">
        <SkeletonText width="60px" height="20px" borderRadius="12px" />
      </div>
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`card skeleton-card ${className}`.trim()} aria-hidden="true">
      <div className="skeleton-card-head">
        <SkeletonText width="120px" height="18px" />
        <SkeletonText width="80px" height="28px" borderRadius="6px" />
      </div>
      <div className="skeleton-card-body">
        <SkeletonText width="60%" height="14px" />
        <SkeletonText width="40%" height="14px" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`skeleton-list ${className}`.trim()} aria-label="Loading content" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

export default function LoadingSkeleton({
  type = 'list',
  count = 3,
  className = '',
}: {
  type?: 'list' | 'card' | 'row' | 'text';
  count?: number;
  className?: string;
}) {
  if (type === 'card') {
    return (
      <div className={`skeleton-grid ${className}`.trim()} aria-label="Loading cards" aria-busy="true">
        {Array.from({ length: count }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (type === 'row') return <SkeletonRow className={className} />;
  if (type === 'text') return <SkeletonText className={className} />;

  return <SkeletonList count={count} className={className} />;
}
