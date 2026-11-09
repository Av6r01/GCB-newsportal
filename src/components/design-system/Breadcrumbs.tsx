import React from 'react';
import { Home, ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
  active?: boolean;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
  return (
    <nav className="flex items-center gap-2 text-xs text-[#666055] dark:text-[#A09A8F] py-2 font-sans-en">
      <button
        onClick={items[0]?.onClick}
        className="hover:text-[#990000] transition-colors flex items-center gap-1 font-semibold"
      >
        <Home className="w-3.5 h-3.5 text-[#990000]" />
        <span>Front Page</span>
      </button>

      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          <span className="text-[#A09A8F] dark:text-[#555555]">/</span>
          {item.active ? (
            <span className="font-bold text-[#1A1A1A] dark:text-[#E5E5E5] truncate max-w-[200px] sm:max-w-md">
              {item.label}
            </span>
          ) : (
            <button
              onClick={item.onClick}
              className="hover:text-[#990000] transition-colors font-medium truncate max-w-[150px]"
            >
              {item.label}
            </button>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};
