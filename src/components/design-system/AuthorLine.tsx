import React from 'react';
import { ShieldCheck, User } from 'lucide-react';

export interface AuthorLineProps {
  authorName: string;
  authorTitle?: string;
  avatarUrl?: string | null;
  publishedAt?: string;
  location?: string;
}

export const AuthorLine: React.FC<AuthorLineProps> = ({
  authorName,
  authorTitle = 'Senior Bureau Correspondent',
  avatarUrl,
  publishedAt,
  location = 'Dhaka Bureau',
}) => {
  const formattedDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div className="flex items-center gap-3 py-3 border-y border-[#E2DDD5] dark:border-[#2A2A2A] text-xs font-sans-en">
      {/* Avatar Container */}
      <div className="w-9 h-9 rounded-full overflow-hidden bg-[#EBE6DF] dark:bg-[#222222] border border-[#D6CEBE] dark:border-[#333333] shrink-0 flex items-center justify-center">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={authorName}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <User className="w-5 h-5 text-[#666055]" />
        )}
      </div>

      {/* Details */}
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5 font-bold text-[#1A1A1A] dark:text-[#E5E5E5]">
          <span>{authorName}</span>
          <ShieldCheck className="w-3.5 h-3.5 text-[#1B365D] dark:text-amber-300" />
        </div>
        <div className="text-[11px] text-[#666055] dark:text-[#A09A8F] flex items-center gap-2">
          <span>{authorTitle}</span>
          <span>·</span>
          <span>{location}</span>
          {formattedDate && (
            <>
              <span>·</span>
              <span>{formattedDate}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
