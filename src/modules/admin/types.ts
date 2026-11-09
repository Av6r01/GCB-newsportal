/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoleType } from '../auth/permissions.ts';

export interface DashboardMetrics {
  totalPublishedStories: number;
  draftsAwaitingReview: number;
  pendingApprovals: number;
  scheduledStories: number;
  totalViews: number;
  pendingComments: number;
  failedJobsCount: number;
}

export interface RecentArticleItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  coverImage?: string;
  views: number;
  priority: string;
  publishedAt?: string;
  category?: {
    name: string;
    slug: string;
    color?: string;
  };
  author?: {
    name: string;
    avatar?: string;
  };
}

export interface EditorialActivityItem {
  id: string;
  action: string;
  details: string;
  timestamp: string;
  actorId?: string;
}

export interface PublicationJobItem {
  id: string;
  name: string;
  status: 'HEALTHY' | 'WARNING' | 'FAILED';
  lastRun: string;
  description: string;
}

export interface DashboardDataContract {
  metrics: DashboardMetrics;
  recentlyPublishedStories: RecentArticleItem[];
  recentEditorialActivity: EditorialActivityItem[];
  publicationJobs: PublicationJobItem[];
  systemStatus: {
    database: string;
    authGuard: string;
    userRole: RoleType;
    nodeEnv: string;
  };
}

export interface AdminNavItem {
  id: string;
  label: string;
  iconName: string;
  requiredPermission?: string;
  badgeCount?: number;
}
