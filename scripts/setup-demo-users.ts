import bcrypt from 'bcrypt';
import { db } from '../src/lib/database.ts';

async function setupDemoUsers() {
  const passwordHash = await bcrypt.hash('DemoNewsroom2026!', 10);
  
  const demoAccounts = [
    { id: 'usr-demo-admin', email: 'admin@globalchronicle.news', name: 'Marcus Vance (Admin)', role: 'ADMIN' },
    { id: 'usr-demo-managing', email: 'managing@globalchronicle.news', name: 'Dave Sterling (Managing Editor)', role: 'MANAGING_EDITOR' },
    { id: 'usr-demo-editor', email: 'editor@globalchronicle.news', name: 'Elena Rostova (Section Editor)', role: 'SECTION_EDITOR' },
    { id: 'usr-demo-copy', email: 'copyeditor@globalchronicle.news', name: 'Carol Higgins (Copy Editor)', role: 'COPY_EDITOR' },
    { id: 'usr-demo-reporter', email: 'reporter@globalchronicle.news', name: 'Ayesha Rahman (Senior Reporter)', role: 'REPORTER' },
    { id: 'usr-demo-analyst', email: 'analyst@globalchronicle.news', name: 'Dr. Farhan Ahmed (Analyst)', role: 'ANALYST' },
    { id: 'usr-demo-reader', email: 'reader@globalchronicle.news', name: 'Sophia Miller (Reader)', role: 'READER' },
  ];

  for (const acc of demoAccounts) {
    const existing = await db.user.findUnique({ where: { email: acc.email } });
    if (existing) {
      await db.user.update({
        where: { email: acc.email },
        data: { passwordHash, role: acc.role, name: acc.name }
      });
      console.log('Updated:', acc.email, '->', acc.role);
    } else {
      await db.user.create({
        data: {
          id: acc.id,
          email: acc.email,
          name: acc.name,
          passwordHash,
          role: acc.role,
        }
      });
      console.log('Created:', acc.email, '->', acc.role);
    }
  }
}

setupDemoUsers()
  .then(() => {
    console.log('SUCCESS: All 7 demo accounts configured with password DemoNewsroom2026!');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
