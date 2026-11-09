# Global Chronicle News Security Specification

## Data Invariants
1.  Articles must have an authorId that matches the UID of the creator.
2.  Readers cannot publish articles (status transition to PUBLISHED).
3.  Comments are PENDING by default and require approval for visibility.
4.  User roles can only be changed by ADMINs.
5.  All document IDs must be valid alphanumeric strings.

## The Dirty Dozen Payloads

1.  **Identity Spoofing**: Attempt to create an article with another user's UID as authorId.
2.  **Privilege Escalation**: A READER attempting to update their own role to ADMIN.
3.  **State Shortcutting**: Creating an article directly with status 'PUBLISHED' bypassing the review queue.
4.  **Bypassing Moderation**: Updating a comment status from PENDING to APPROVED as a guest.
5.  **ID Poisoning**: Attempting to create a category with a 2KB junk string as the ID.
6.  **Resource Exhaustion**: Sending a 500KB string for a category name.
7.  **Shadow Field Update**: Adding a hidden `isAdmin: true` field to a user profile document.
8.  **Unauthorized Deletion**: A CONTRIBUTOR attempting to delete an article authored by an EDITOR.
9.  **Timestamp Spoofing**: Setting a future `publishedAt` date from the client.
10. **Referential Integrity Break**: Creating a comment for a non-existent `articleId`.
11. **PII Leak**: A guest attempting to 'list' the entire users collection.
12. **Spam Injection**: Creating 100 comments in 1 second (handled by rate limits and rules).

## Test Runner (firestore.rules.test.ts)
Verification tests will ensure these payloads return PERMISSION_DENIED.
