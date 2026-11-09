/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 9: public 404 view for unknown client routes (the server renders its
 * own 404 for deep links; this covers in-app navigation to dead paths).
 */
import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface NotFoundPageProps {
  onHome: () => void;
}

export const NotFoundPage: React.FC<NotFoundPageProps> = ({ onHome }) => {
  React.useEffect(() => { document.title = 'Page not found | Global Chronicle'; }, []);
  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-24 text-center" data-not-found="true">
      <p className="text-6xl font-serif font-bold text-[#990000] mb-4">404</p>
      <h1 className="font-serif font-bold text-3xl md:text-4xl text-stone-900 mb-4">
        This page could not be found
      </h1>
      <p className="text-stone-600 mb-8">
        The story may have been moved, renamed, or unpublished. The archive and
        section pages list everything currently available.
      </p>
      <button
        onClick={onHome}
        className="inline-flex items-center space-x-2 bg-stone-900 text-white px-5 py-3 rounded font-medium text-sm hover:bg-stone-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to the front page</span>
      </button>
    </div>
  );
};
