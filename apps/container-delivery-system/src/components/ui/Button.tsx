import React from 'react';

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-cds-orange text-[#170d00] shadow-[0_8px_20px_-8px_rgba(255,122,0,0.35)] hover:brightness-110',
  ghost: 'bg-ink-2 text-text-1 border border-[rgba(255,255,255,0.12)] hover:bg-ink-3 hover:text-text-0',
  danger: 'bg-cds-red text-[#2b0000] hover:brightness-110',
  success: 'bg-cds-teal/15 text-cds-teal border border-cds-teal/30',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 text-[11px] px-2.5 rounded-lg gap-1',
  md: 'h-9 text-[12.5px] px-3.5 rounded-[10px] gap-1.5',
};

export function Button({ variant = 'primary', size = 'md', icon, children, className = '', disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`font-display font-semibold inline-flex items-center justify-center cursor-pointer border-0 transition-all duration-100 whitespace-nowrap active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ className = '', children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-[34px] h-[34px] rounded-[9px] border-none bg-transparent text-text-1 cursor-pointer flex items-center justify-center transition-colors hover:bg-ink-3 hover:text-text-0 flex-none relative ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
