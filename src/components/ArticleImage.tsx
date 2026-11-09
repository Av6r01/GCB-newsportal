/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface ArticleImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: height;
  aspectRatio?: number;
  focalX?: number;
  focalY?: number;
  caption?: string;
  credit?: string;
  variants?: Record<string, string> | string; // JSON or object map like {"480w": "...", "800w": "...", "1200w": "..."}
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}

type height = number;

export const ArticleImage: React.FC<ArticleImageProps> = ({
  src,
  alt,
  width = 1200,
  height = 675,
  aspectRatio,
  focalX = 50,
  focalY = 50,
  caption,
  credit,
  variants,
  className = '',
  imgClassName = '',
  priority = false,
}) => {
  // Compute style aspect ratio to enforce layout space reservation and prevent CLS
  const calculatedAspectRatio = aspectRatio || (width && height ? Number((width / height).toFixed(4)) : 1.7778);
  
  // Parse variants if provided as stringified JSON
  let variantMap: Record<string, string> | null = null;
  if (typeof variants === 'string') {
    try {
      variantMap = JSON.parse(variants);
    } catch {
      variantMap = null;
    }
  } else if (variants && typeof variants === 'object') {
    variantMap = variants;
  }

  // Generate responsive srcset if variants exist
  let srcSet: string | undefined = undefined;
  if (variantMap && Object.keys(variantMap).length > 0) {
    srcSet = Object.entries(variantMap)
      .map(([widthKey, url]) => `${url} ${widthKey}`)
      .join(', ');
  }

  return (
    <figure className={`relative group my-4 overflow-hidden rounded-lg bg-stone-100 ${className}`}>
      <div
        className="relative w-full overflow-hidden bg-stone-200"
        style={{
          aspectRatio: `${calculatedAspectRatio}`,
        }}
      >
        <img
          src={src}
          srcSet={srcSet}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 75vw, 1200px"
          alt={alt || 'Newsroom dispatch image'}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          style={{
            objectFit: 'cover',
            objectPosition: `${focalX}% ${focalY}%`,
          }}
          className={`w-full h-full transition-all duration-300 group-hover:scale-[1.01] ${imgClassName}`}
          onError={(e) => {
            // Fallback placeholder image if src breaks
            (e.target as HTMLImageElement).src =
              'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=1200&auto=format&fit=crop&q=80';
          }}
        />
      </div>

      {(caption || credit) && (
        <figcaption className="mt-2 text-xs text-stone-600 dark:text-stone-400 flex flex-wrap items-center justify-between gap-2 px-1">
          {caption && <span className="font-serif italic text-stone-700 dark:text-stone-300">{caption}</span>}
          {credit && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-stone-500 bg-stone-200/60 dark:bg-stone-800/60 px-1.5 py-0.5 rounded">
              Photo: {credit}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
};
