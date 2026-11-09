/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type RoleType =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MANAGING_EDITOR'
  | 'SECTION_EDITOR'
  | 'COPY_EDITOR'
  | 'REPORTER'
  | 'PHOTOGRAPHER'
  | 'VIDEO_EDITOR'
  | 'ADVERTISING_MANAGER'
  | 'ANALYST'
  | 'READER';

export type Permission =
  | 'article:create'
  | 'article:edit_own'
  | 'article:edit_any'
  | 'article:submit_review'
  | 'article:request_changes'
  | 'article:publish'
  | 'article:delete'
  // Phase 7: permanent (hard) deletion is a separate, stricter capability from
  // archive/delete — only site owners hold it by default.
  | 'article:purge'
  | 'media:upload'
  | 'media:manage'
  | 'ad:manage'
  | 'analytics:view'
  | 'users:view'
  | 'users:manage'
  | 'roles:assign'
  | 'settings:manage'
  | 'categories:manage'
  | 'tags:manage'
  | 'authors:manage'
  | 'mfa:enforce';

export const ROLE_PERMISSIONS: Record<RoleType, Permission[]> = {
  SUPER_ADMIN: [
    'article:create',
    'article:edit_own',
    'article:edit_any',
    'article:submit_review',
    'article:request_changes',
    'article:publish',
    'article:delete',
    'article:purge',
    'media:upload',
    'media:manage',
    'ad:manage',
    'analytics:view',
    'users:view',
    'users:manage',
    'roles:assign',
    'settings:manage',
    'categories:manage',
    'tags:manage',
    'authors:manage',
    'mfa:enforce',
  ],
  ADMIN: [
    'article:create',
    'article:edit_own',
    'article:edit_any',
    'article:submit_review',
    'article:request_changes',
    'article:publish',
    'article:delete',
    'article:purge',
    'media:upload',
    'media:manage',
    'ad:manage',
    'analytics:view',
    'users:view',
    'users:manage',
    'roles:assign',
    'settings:manage',
    'categories:manage',
    'tags:manage',
    'authors:manage',
    'mfa:enforce',
  ],
  MANAGING_EDITOR: [
    'article:create',
    'article:edit_own',
    'article:edit_any',
    'article:submit_review',
    'article:request_changes',
    'article:publish',
    'article:delete',
    'media:upload',
    'media:manage',
    'categories:manage',
    'tags:manage',
    'authors:manage',
    'analytics:view',
    'users:view',
    'mfa:enforce',
  ],
  SECTION_EDITOR: [
    'article:create',
    'article:edit_own',
    'article:edit_any',
    'article:submit_review',
    'article:request_changes',
    'article:publish',
    'media:upload',
    'media:manage',
    'categories:manage',
    'tags:manage',
    'analytics:view',
    'mfa:enforce',
  ],
  COPY_EDITOR: [
    'article:edit_any',
    'article:submit_review',
    'article:request_changes',
    'media:upload',
  ],
  REPORTER: [
    'article:create',
    'article:edit_own',
    'article:submit_review',
    'media:upload',
  ],
  PHOTOGRAPHER: [
    'media:upload',
    'media:manage',
  ],
  VIDEO_EDITOR: [
    'media:upload',
    'media:manage',
  ],
  ADVERTISING_MANAGER: [
    'ad:manage',
    'analytics:view',
  ],
  ANALYST: [
    'analytics:view',
  ],
  READER: [],
};

export function hasPermission(role: RoleType, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

export function isPrivilegedRole(role: RoleType): boolean {
  return ['SUPER_ADMIN', 'ADMIN', 'MANAGING_EDITOR', 'SECTION_EDITOR'].includes(role);
}
