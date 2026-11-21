import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

// Simple pub/sub for toasts
type Listener = (toast: ToastItem) => void;
let listeners: Listener[] = [];

export const toast = {
  show: (type: ToastType, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast = { id, type, message };
    listeners.forEach(l => l(newToast));
  },
  success: (message: string) => toast.show('success', message),
  error: (message: string) => toast.show('error', message),
  info: (message: string) => toast.show('info', message)
};

export const ToastProvider: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handleToast = (newToast: ToastItem) => {
      setToasts(prev => [...prev, newToast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== newToast.id));
      }, 3000);
    };
    
    listeners.push(handleToast);
    return () => {
      listeners = listeners.filter(l => l !== handleToast);
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div 
          key={t.id} 
          className={`px-4 py-3 rounded-lg shadow-lg flex items-center justify-between min-w-[200px] animate-in slide-in-from-top-2 fade-in duration-200 cursor-pointer
            ${t.type === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800' : ''}
            ${t.type === 'error' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800' : ''}
            ${t.type === 'info' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800' : ''}
          `}
          onClick={() => removeToast(t.id)}
        >
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body
  );
};

export default ToastProvider;
