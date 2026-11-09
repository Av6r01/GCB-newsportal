/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RoleType, hasPermission } from '../auth/permissions.ts';

export type ArticleState =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'UNPUBLISHED'
  | 'ARCHIVED';

export interface WorkflowTransitionResult {
  allowed: boolean;
  reason?: string;
  requiresNote?: boolean;
}

/**
 * Editorial State Machine Matrix
 * Maps allowed [fromState][toState] and required permission / role authority.
 */
export const ALLOWED_TRANSITIONS: Record<ArticleState, ArticleState[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['CHANGES_REQUESTED', 'APPROVED', 'DRAFT', 'ARCHIVED'],
  CHANGES_REQUESTED: ['DRAFT', 'IN_REVIEW', 'ARCHIVED'],
  APPROVED: ['SCHEDULED', 'PUBLISHED', 'DRAFT', 'ARCHIVED'],
  SCHEDULED: ['PUBLISHED', 'APPROVED', 'DRAFT', 'ARCHIVED'],
  PUBLISHED: ['UNPUBLISHED', 'ARCHIVED'],
  UNPUBLISHED: ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

/**
 * Validates whether a user with a given role can execute a state transition.
 */
export function validateStateTransition(
  currentState: ArticleState,
  targetState: ArticleState,
  role: RoleType,
  note?: string,
  isAuthor = false
): WorkflowTransitionResult {
  // Check if transition exists in state machine
  const allowedTargets = ALLOWED_TRANSITIONS[currentState] || [];
  if (!allowedTargets.includes(targetState)) {
    return {
      allowed: false,
      reason: `Invalid state transition: Cannot transition dispatch from "${currentState}" directly to "${targetState}".`,
    };
  }

  // Transitions to CHANGES_REQUESTED or UNPUBLISHED require mandatory reviewer notes
  if ((targetState === 'CHANGES_REQUESTED' || targetState === 'UNPUBLISHED') && (!note || note.trim().length === 0)) {
    return {
      allowed: false,
      reason: `Editorial policy requires a detailed note when moving story to "${targetState}".`,
      requiresNote: true,
    };
  }

  // Role authority checks
  switch (targetState) {
    case 'IN_REVIEW':
      // Reporter (author), Copy Editor, Section/Managing Editor, Admin can submit for review
      if (!isAuthor && !['REPORTER', 'COPY_EDITOR', 'SECTION_EDITOR', 'MANAGING_EDITOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
        return { allowed: false, reason: 'Only the story author or authorized editorial staff can submit for review.' };
      }
      break;

    case 'CHANGES_REQUESTED':
    case 'APPROVED':
      // Requires editorial authority (Copy Editor, Section Editor, Managing Editor, Admin)
      if (!['COPY_EDITOR', 'SECTION_EDITOR', 'MANAGING_EDITOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
        return { allowed: false, reason: 'Only accredited editors can approve or request changes on a submission.' };
      }
      break;

    case 'SCHEDULED':
    case 'PUBLISHED':
      // Requires publishing permission (`article:publish`)
      if (!hasPermission(role, 'article:publish')) {
        return { allowed: false, reason: 'Permission denied: Only Section/Managing Editors or Admins have publishing sign-off.' };
      }
      break;

    case 'UNPUBLISHED':
    case 'ARCHIVED':
      // Requires deletion / archive authority (`article:delete` or Managing Editor)
      if (!['MANAGING_EDITOR', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
        return { allowed: false, reason: 'Only Managing Editors or Administrators can unpublish or archive dispatches.' };
      }
      break;

    default:
      break;
  }

  return { allowed: true };
}
