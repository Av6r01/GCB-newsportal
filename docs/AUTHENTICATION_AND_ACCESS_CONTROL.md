# Authentication, Session Management & Access Control

## 1. Authentication Architecture
Global Chronicle News implements a hardened authentication and session security architecture:
- **Session Tokens**: Cryptographically signed JSON Web Tokens (JWT) using `HS256` with strict expiration windows and unique UUID identifiers.
- **Credential Storage**: Passwords hashed using `bcrypt` with work factor 10.
- **Session Revocation**: Real-time server-side token revocation table (`revokedTokens`) ensuring that sign-out or administrative suspension immediately revokes the token.
- **Account State Verification**: Active account flag (`isActive: boolean`). Deactivated accounts are rejected at both login and API middleware levels.
- **Password Reset Flow**: Time-limited cryptographic reset tokens (`/api/auth/password-reset/request` & `/api/auth/password-reset/confirm`) with enumeration prevention (generic response messages).

## 2. Threat Mitigations & Protection Rules
- **Brute-Force & Credential Stuffing**: Sliding window login rate limiter (`loginRateLimiter`) enforcing a 15-minute lockout after 5 consecutive failures per IP/email tuple.
- **Enumeration Prevention**: Uniform authentication failure response (`"Invalid email or password"`) across registered and non-registered identifiers.
- **Privilege Escalation Prevention**:
  - Public registration (`/api/auth/register`) strictly sets role to `READER`. Any attempt to supply an administrative or editorial role is rejected (`403 Forbidden`).
  - Role management endpoint (`/api/admin/users/:id/role`) requires `roles:assign` and enforces `preventPrivilegeEscalation` (only Super Administrators can grant `SUPER_ADMIN` or `ADMIN` roles).
- **Horizontal Access Violations**:
  - A reporter can only edit their own draft (`article:edit_own` where `article.authorId === user.id`).
  - Attempts by another reporter to edit or overwrite another user's draft are rejected (`403 Forbidden: Horizontal access violation`).

## 3. Newsroom Role Hierarchy & Granular Permissions

| Role | Primary Purpose | Key Permissions |
| :--- | :--- | :--- |
| **`SUPER_ADMIN`** | System Owner | All permissions, including `roles:assign`, `settings:manage`, `users:manage` |
| **`ADMIN`** | Operations Director | All permissions, newsroom management, settings |
| **`MANAGING_EDITOR`**| Executive Editorial | `article:create`, `article:edit_any`, `article:publish`, `article:delete`, `analytics:view` |
| **`SECTION_EDITOR`** | Desk Chief | `article:create`, `article:edit_any`, `article:publish`, `media:manage` |
| **`COPY_EDITOR`** | Proofreading & Quality | `article:edit_any`, `article:submit_review`, `article:request_changes` |
| **`REPORTER`** | Staff Journalist | `article:create`, `article:edit_own`, `article:submit_review`, `media:upload` |
| **`PHOTOGRAPHER`** | Photo Desk | `media:upload`, `media:manage` |
| **`VIDEO_EDITOR`** | Video & Broadcast | `media:upload`, `media:manage`, `video:manage` |
| **`ADVERTISING_MANAGER`** | Commercial Revenue | `ad:manage`, `analytics:view` (CANNOT edit newsroom articles or assign roles) |
| **`ANALYST`** | Editorial Insights | `analytics:view` (CANNOT alter articles or users) |
| **`READER`** | Public Consumer | `comment:create`, `poll:vote` |

## 4. Automated Verification Suite
The access control rules are verified by `tests/authorization.test.ts`:
- Permission matrix validation for all 10 roles.
- Horizontal access isolation between reporters.
- Publishing boundaries between copy editors and managing editors.
- Non-editorial role boundaries for advertising and analytics.
- Brute-force rate limiter lockout verification.
- Real-time session invalidation verification.
