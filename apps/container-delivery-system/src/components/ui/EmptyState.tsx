import type { ReactNode } from 'react';
import { Button } from './Button.js';

interface EmptyStateProps {
  icon?: ReactNode | undefined;
  title: string;
  description?: string | undefined;
  action?: { label: string; onClick: () => void } | undefined;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in">
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-ink-3 flex items-center justify-center text-text-2 mb-4">
          {icon}
        </div>
      )}
      <div className="font-display font-semibold text-sm text-text-0 mb-1">{title}</div>
      {description && <div className="text-xs text-text-2 max-w-[320px]">{description}</div>}
      {action && (
        <Button className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      }
      title="Something went wrong"
      description={message ?? 'Failed to load data. Check your connection and try again.'}
      action={onRetry ? { label: 'Retry', onClick: onRetry } : undefined}
    />
  );
}
