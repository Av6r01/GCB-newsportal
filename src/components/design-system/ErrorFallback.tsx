import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export interface ErrorFallbackProps {
  error?: Error | string | null;
  resetErrorBoundary?: () => void;
  onReturnHome?: () => void;
}

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({
  error,
  resetErrorBoundary,
  onReturnHome,
}) => {
  return (
    <div className="my-12 max-w-2xl mx-auto p-8 bg-[#FAF8F5] dark:bg-[#181818] border-2 border-[#990000] text-center font-sans-en">
      <AlertTriangle className="w-12 h-12 text-[#990000] mx-auto mb-3" />
      <h2 className="text-xl font-bold font-display-en text-[#1A1A1A] dark:text-[#E5E5E5] mb-2">
        EDITORIAL DISPATCH ERROR
      </h2>
      <p className="text-sm text-[#666055] dark:text-[#A09A8F] mb-6 font-body-en">
        {typeof error === 'string'
          ? error
          : error?.message || 'An unexpected issue occurred while loading this dispatch archive.'}
      </p>

      <div className="flex items-center justify-center gap-4">
        {resetErrorBoundary && (
          <button
            onClick={resetErrorBoundary}
            className="flex items-center gap-2 bg-[#990000] text-white px-4 py-2 rounded text-xs font-bold hover:bg-red-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Retry Dispatch</span>
          </button>
        )}

        {onReturnHome && (
          <button
            onClick={onReturnHome}
            className="flex items-center gap-2 bg-[#1B365D] text-white px-4 py-2 rounded text-xs font-bold hover:bg-blue-900 transition-colors"
          >
            <Home className="w-4 h-4" />
            <span>Return to Front Page</span>
          </button>
        )}
      </div>
    </div>
  );
};
