import React from 'react';
import { useLocation } from 'wouter';

export const Logo = ({ className }: { className?: string }) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 2C8.26801 2 2 8.26801 2 16C2 23.732 8.26801 30 16 30C23.732 30 30 23.732 30 16" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
        <path d="M9 16L14 21L24 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 24V14" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
        <path d="M26 24V18" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
      </svg>
      <span className="font-semibold text-xl tracking-tight">CertEfficiency</span>
    </div>
  );
};
