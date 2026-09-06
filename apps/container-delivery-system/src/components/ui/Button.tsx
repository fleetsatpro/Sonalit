import React from 'react';

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success' | 'outline';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-cds-orange text-[#170d00] shadow-glow hover:brightness-110',
  ghost: 'bg-ink-2 text-text-1 border border-glass-border hover:bg-ink-3 hover:text-text-0 hover:border-glass-border-hover',
  danger: 'bg-cds-red text-[#2b0000] hover:brightness-110',
  success: 'bg-cds-teal/15 text-cds-teal border border-cds-teal/30 hover:bg-cds-teal/20',
  outline: 'bg-transparent text-text-1 border border-glass-border-strong hover:bg-ink-2 hover:text-text-0',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 text-[11px] px-2.5 rounded-lg gap-1',
  md: 'h-9 text-xs-tight px-3.5 rounded-control gap-1.5',
};

export function Button({ variant = 'primary', size = 'md', icon, loading, children, className = '', disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`font-display font-semibold inline-flex items-center justify-center cursor-pointer border-0 transition-all duration-100 whitespace-nowrap active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : icon}
      {children}
    </button>
  );
}

export function IconButton({ className = '', children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-[34px] h-[34px] rounded-control border-none bg-transparent text-text-1 cursor-pointer flex items-center justify-center transition-colors hover:bg-ink-3 hover:text-text-0 flex-none relative ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
