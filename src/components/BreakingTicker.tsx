/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Flame, ChevronRight } from 'lucide-react';

interface Article {
  id: string;
  title: string;
  slug: string;
}

interface BreakingTickerProps {
  articles: Article[];
  onSelectArticle: (slug: string) => void;
}

export const BreakingTicker: React.FC<BreakingTickerProps> = ({ articles, onSelectArticle }) => {
  const breakingArticles = articles.slice(0, 5);

  if (breakingArticles.length === 0) return null;

  return (
    <div className="bg-red-700 text-white px-4 py-2 flex items-center shadow-inner text-sm overflow-hidden">
      <div className="flex items-center space-x-2 bg-red-900 px-3 py-1 rounded font-bold uppercase tracking-wider text-xs shrink-0 animate-pulse">
        <Flame className="w-4 h-4" />
        <span>Breaking News</span>
      </div>
      <div className="ml-4 flex items-center space-x-8 overflow-x-auto whitespace-nowrap scrollbar-none">
        {breakingArticles.map((article) => (
          <button
            key={article.id}
            onClick={() => onSelectArticle(article.slug)}
            className="flex items-center space-x-1 hover:underline text-left transition-colors font-medium text-red-50"
          >
            <span>{article.title}</span>
            <ChevronRight className="w-3 h-3 opacity-70" />
          </button>
        ))}
      </div>
    </div>
  );
};
