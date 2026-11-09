/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbSegment {
  label: string;
  onClick?: () => void;
  active?: boolean;
}

interface AdminBreadcrumbsProps {
  segments: BreadcrumbSegment[];
}

export const AdminBreadcrumbs: React.FC<AdminBreadcrumbsProps> = ({ segments }) => {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center space-x-2 text-xs text-stone-500 py-1">
      <button
        onClick={segments[0]?.onClick}
        className="flex items-center space-x-1 hover:text-stone-900 transition-colors"
      >
        <Home className="w-3.5 h-3.5" />
        <span className="font-medium">CMS</span>
      </button>

      {segments.map((segment, index) => (
        <React.Fragment key={index}>
          <ChevronRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          {segment.active || !segment.onClick ? (
            <span className="font-semibold text-stone-800 tracking-tight">{segment.label}</span>
          ) : (
            <button
              onClick={segment.onClick}
              className="hover:text-stone-900 transition-colors font-medium truncate max-w-xs"
            >
              {segment.label}
            </button>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};
