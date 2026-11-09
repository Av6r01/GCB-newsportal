# Production Deployment and Operations Guide

This document outlines the procedures for deploying and maintaining the Global Chronicle News platform in a production environment.

## 1. Local Setup
To run the platform locally in a production-like environment:
1. Ensure Docker and Docker Compose are installed.
2. Clone the repository.
3. Copy `.env.example` to `.env` and fill in the required production secrets.
4. Run `docker-compose up --build`.
5. Access the app at `http://localhost:3000`.

## 2. Staging Deployment
Staging is used for final QA before production.
- **Environment**: Isolated from production data.
- **Trigger**: Automatic deployment on push to `staging` branch.
- **Media**: Uses a separate staging S3 bucket.
- **Database**: Uses a staging PostgreSQL instance.

## 3. Production Deployment
Production is the live environment.
- **Infrastructure**: Scalable Node.js cluster (e.g., Cloud Run or AWS ECS).
- **Database**: Managed PostgreSQL (e.g., Google Cloud SQL or AWS RDS).
- **SSL**: Managed via the load balancer or ingress controller.
- **Worker**: Ensure at least one dedicated instance is running for the publishing scheduler.

## 4. Database Migrations
Migrations are managed via Prisma.
- **Command**: `npx prisma migrate deploy`
- **Workflow**:
  1. Update `prisma/schema.prisma`.
  2. Create migration: `npx prisma migrate dev --name <description>`.
  3. Deploy to production as part of the CI/CD pipeline.

## 5. Backup Creation
Automated backups are critical for data integrity.
- **Database**: Configure daily snapshots with 30-day retention in the managed database console.
- **Media**: S3-compatible storage should have versioning enabled.
- **Manual Backup**: `pg_dump -U $SQL_USER $SQL_DB_NAME > backup_$(date +%F).sql`

## 6. Restore Testing
Backups must be verified regularly.
- **Procedure**:
  1. Provision a temporary PostgreSQL instance.
  2. Restore the latest backup: `psql -U $USER $DB < backup.sql`.
  3. Run the application smoke tests against the restored data.

## 7. Incident Response
In case of system failure:
1. **Identify**: Check logs in CloudWatch/Cloud Logging.
2. **Contain**: If a specific service is failing, isolate it.
3. **Resolve**: Roll back if a recent deployment caused the issue.
4. **Post-Mortem**: Document the cause and preventative measures.

## 8. Rollback
If a deployment fails:
1. **Application**: Revert to the previous stable Docker image tag.
2. **Database**: If a migration is irreversible, restore from the last snapshot (Warning: data loss may occur).

## 9. Account Recovery
- **Admin Access**: If an admin loses access, use the `scripts/promote-user.ts` tool via the server console.
- **User Reset**: Users can use the "Forgot Password" flow (requires configured SMTP).

## 10. Routine Maintenance
- **Weekly**: Monitor error rates and latency in the dashboard.
- **Monthly**: Review audit logs for suspicious activity.
- **Quarterly**: Update dependencies and patch security vulnerabilities.
- **Biannually**: Perform a full disaster recovery drill.
