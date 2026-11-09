/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type CommentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Comment {
  id: string;
  articleId: string;
  authorName: string;
  authorEmail: string;
  content: string;
  status: CommentStatus;
  createdAt: string;
  article?: {
    title: string;
    slug: string;
  };
}
