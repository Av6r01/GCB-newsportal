/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ArticleStatus = 'DRAFT' | 'REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';
export type ArticlePriority = 'NORMAL' | 'BREAKING' | 'FEATURED';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  createdAt: string;
  _count?: {
    articles: number;
  };
}

export interface Author {
  name: string;
  avatar?: string;
}

export interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage?: string;
  categoryId: string;
  authorId: string;
  status: ArticleStatus;
  priority: ArticlePriority;
  views: number;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  category?: Category;
  author?: Author;
  _count?: {
    comments: number;
  };
}
