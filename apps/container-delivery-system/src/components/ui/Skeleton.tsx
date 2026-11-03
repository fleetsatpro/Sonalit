import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div className={`skeleton ${className}`} style={style} />
  );
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="glass rounded-card overflow-hidden">
      <div className="flex gap-4 px-3.5 py-3 border-b border-hair">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" style={{ maxWidth: i === 0 ? '120px' : '80px' }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex gap-4 px-3.5 py-3.5 border-b border-hair last:border-b-0">
          {Array.from({ length: cols }).map((_, ci) => (
            <Skeleton key={ci} className="h-3 flex-1" style={{ maxWidth: ci === 0 ? '140px' : '100px' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function KPISkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-4 gap-3.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass rounded-card p-4 space-y-3">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}
