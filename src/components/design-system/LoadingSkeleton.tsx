import React from 'react';

export interface LoadingSkeletonProps {
  type?: 'lead' | 'grid' | 'wire';
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ type = 'grid' }) => {
  if (type === 'lead') {
    return (
      <div className="bg-[#FAF8F5] dark:bg-[#151515] border border-[#E2DDD5] dark:border-[#2A2A2A] p-6 mb-6 animate-pulse">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-4">
            <div className="h-4 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-32 rounded" />
            <div className="h-8 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-full rounded" />
            <div className="aspect-[16/9] bg-[#E2DDD5] dark:bg-[#2A2A2A] w-full rounded" />
            <div className="h-4 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-3/4 rounded" />
          </div>
          <div className="lg:col-span-4 space-y-4">
            <div className="h-4 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-40 rounded" />
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2 py-2">
                <div className="h-3 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-20 rounded" />
                <div className="h-4 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-full rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="p-4 border border-[#E2DDD5] dark:border-[#2A2A2A] bg-[#FAF8F5] dark:bg-[#181818] space-y-3">
          <div className="aspect-[16/9] bg-[#E2DDD5] dark:bg-[#2A2A2A] w-full rounded" />
          <div className="h-3 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-24 rounded" />
          <div className="h-5 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-full rounded" />
          <div className="h-3 bg-[#E2DDD5] dark:bg-[#2A2A2A] w-4/5 rounded" />
        </div>
      ))}
    </div>
  );
};
