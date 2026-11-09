# Architecture Decision Records (ADR) - Global Chronicle News

## ADR 001: Modular Monolith Over Microservices
- **Status**: Accepted
- **Context**: The platform requires fast feature delivery, unified editorial management, and straightforward deployment without distributed network latency.
- **Decision**: Adopt a modular monolith architecture with clean internal folder boundaries in a React + Express stack.
- **Consequences**: Simplified deployment, unified transactional safety, and easy module refactoring.

## ADR 002: PostgreSQL with Prisma ORM
- **Status**: Accepted
- **Context**: Relational integrity is essential for articles, authors, categories, comments, and audit logs.
- **Decision**: Use PostgreSQL paired with Prisma ORM for robust migrations, type safety, and parameterized query protection.
- **Consequences**: Exceptional developer velocity and high database reliability.

## ADR 003: PostgreSQL Native Full-Text Search
- **Status**: Accepted
- **Context**: Readers require fast search across news articles without introducing complex external search infrastructure.
- **Decision**: Utilize PostgreSQL built-in `tsvector` and `tsquery` full-text search.
- **Consequences**: Zero additional infrastructure overhead while maintaining high performance.

## ADR 004: S3-Compatible Object Storage for Media Assets
- **Status**: Accepted
- **Context**: Newsrooms require reliable storage for high-resolution photography and media attachments.
- **Decision**: Integrate S3-compatible object storage with signed upload URLs and CDN delivery.
- **Consequences**: Scalable media management independent of application server disk storage.
