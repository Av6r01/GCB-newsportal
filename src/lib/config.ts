/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { env } from '../configuration/env.ts';

export interface AppConfig {
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  port: number;
  isProduction: boolean;
  isDevelopment: boolean;
  editorial: {
    defaultLanguage: 'BN' | 'EN';
    supportedLanguages: Array<'BN' | 'EN'>;
    categories: Array<{ name: string; slug: string; color: string }>;
    breakingTickerLimit: number;
    trendingStoriesLimit: number;
  };
  security: {
    jwtSecret: string;
    jwtExpiresIn: string;
    bcryptRounds: number;
  };
  ai: {
    model: string;
    enabled: boolean;
  };
}

export const appConfig: AppConfig = {
  name: 'Global Chronicle News',
  shortName: 'GC News',
  tagline: 'Truth & Verification in Journalism',
  description: 'Professional digital news publishing platform featuring editorial CMS, live breaking news, AI journalist assistant, and reader discussion.',
  port: env.PORT,
  isProduction: env.NODE_ENV === 'production',
  isDevelopment: env.NODE_ENV === 'development',
  editorial: {
    defaultLanguage: 'BN',
    supportedLanguages: ['BN', 'EN'],
    categories: [
      { name: 'World', slug: 'world', color: 'bg-blue-600' },
      { name: 'Politics', slug: 'politics', color: 'bg-red-600' },
      { name: 'Business', slug: 'business', color: 'bg-emerald-600' },
      { name: 'Tech', slug: 'tech', color: 'bg-purple-600' },
      { name: 'Culture', slug: 'culture', color: 'bg-amber-600' },
      { name: 'Opinion', slug: 'opinion', color: 'bg-indigo-600' },
    ],
    breakingTickerLimit: 5,
    trendingStoriesLimit: 5,
  },
  security: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: '7d',
    bcryptRounds: 10,
  },
  ai: {
    model: 'gemini-2.5-flash',
    enabled: Boolean(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY),
  },
};
