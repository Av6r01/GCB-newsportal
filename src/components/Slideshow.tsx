import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';

interface SlideshowProps {
  items: Array<{
    id: string;
    mediaAsset: {
      originalUrl: string;
      caption?: string;
      credit?: string;
      altText?: string;
    };
  }>;
}

export const Slideshow: React.FC<SlideshowProps> = ({ items }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!items || items.length === 0) return null;

  const next = () => setCurrentIndex((prev) => (prev + 1) % items.length);
  const prev = () => setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') next();
    if (e.key === 'ArrowLeft') prev();
  };

  const currentItem = items[currentIndex];

  return (
    <div 
      className="space-y-4 my-8" 
      role="region" 
      aria-roledescription="carousel" 
      aria-label="Photo Gallery"
      onKeyDown={handleKeyDown}
    >
      <div className="relative aspect-video bg-stone-900 rounded-xl overflow-hidden group">
        <img
          src={currentItem.mediaAsset.originalUrl}
          alt={currentItem.mediaAsset.altText || `Gallery image ${currentIndex + 1}`}
          className="w-full h-full object-contain"
          loading={currentIndex === 0 ? 'eager' : 'lazy'}
        />
        
        {items.length > 1 && (
          <>
            <button
              onClick={prev}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={next}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
              aria-label="Next image"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}

        <div className="absolute bottom-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-xs font-mono" aria-live="polite">
          {currentIndex + 1} / {items.length}
        </div>
      </div>

      <div className="space-y-1 px-2">
        {currentItem.mediaAsset.caption && (
          <p className="text-stone-700 font-serif italic text-sm">{currentItem.mediaAsset.caption}</p>
        )}
        {currentItem.mediaAsset.credit && (
          <p className="text-stone-500 font-mono text-[10px] uppercase">Photo: {currentItem.mediaAsset.credit}</p>
        )}
      </div>

      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {items.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setCurrentIndex(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              aria-current={currentIndex === idx}
              className={`w-20 aspect-video shrink-0 rounded-md overflow-hidden border-2 transition-all focus:ring-2 focus:ring-red-700 focus:outline-none ${
                currentIndex === idx ? 'border-red-700 opacity-100' : 'border-transparent opacity-50'
              }`}
            >
              <img 
                src={item.mediaAsset.originalUrl} 
                alt="" 
                className="w-full h-full object-cover" 
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
