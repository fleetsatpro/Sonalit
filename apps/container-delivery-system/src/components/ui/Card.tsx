import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hover?: boolean;
}

export function Card({ children, className = '', onClick, hover = false }: CardProps) {
  return (
    <div
      className={`bg-gradient-to-b from-[rgba(255,255,255,0.025)] to-[rgba(255,255,255,0.008)] border border-[rgba(255,255,255,0.07)] rounded-[14px] ${hover ? 'cursor-pointer transition-colors hover:border-[rgba(255,255,255,0.12)]' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
