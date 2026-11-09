/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import bcrypt from 'bcrypt';
import { db } from './database.ts';
import { logger } from './logger.ts';

async function getOrCreateUser(data: any) {
  const existing = await db.user.findUnique({ where: { email: data.email } });
  if (existing) return existing;
  return db.user.create({ data });
}

async function getOrCreateCategory(data: any) {
  const existing = await db.category.findUnique({ where: { slug: data.slug } });
  if (existing) return existing;
  return db.category.create({ data });
}

/**
 * Fictional Development Seed Data
 * NOTICE: All accounts, dispatches, and entities created below are visibly fictional
 * for local development and QA testing only. Production environments must never depend
 * on seed data.
 */
export async function seedDevelopmentData() {
  try {
    logger.info('Ensuring development newsroom seed data is present...', 'SEED');

    // 1. Visibly Fictional Newsroom Users
    const passwordHash = await bcrypt.hash('DemoNewsroom2026!', 10);

    const adminUser = await getOrCreateUser({
      id: 'usr-demo-admin-01',
      email: 'demo-editor@globalchronicle.test',
      name: '[DEMO] Chief Bureau Editor - Marcus Vance',
      passwordHash,
      role: 'ADMIN',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    });

    const journalistUser = await getOrCreateUser({
      id: 'usr-demo-writer-02',
      email: 'demo-writer@globalchronicle.test',
      name: '[DEMO] Senior Reporter - Ayesha Rahman',
      passwordHash,
      role: 'REPORTER',
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150',
    });

    const analystUser = await getOrCreateUser({
      id: 'usr-demo-analyst-03',
      email: 'demo-analyst@globalchronicle.test',
      name: '[DEMO] Contributing Analyst - Dr. Farhan Ahmed',
      passwordHash,
      role: 'ANALYST',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    });

    // Fixed system principal used by the publishing scheduler for
    // editorialEvent.actorId / auditLog.userId (plan Q3 + §5.4).
    // Non-loginable: inactive + unguessable non-credential password hash.
    await getOrCreateUser({
      id: 'usr-system-daemon',
      email: 'system-daemon@globalchronicle.internal',
      name: 'System Daemon (Automated Publishing)',
      passwordHash: await bcrypt.hash('no-login-' + process.pid + '-' + Math.random().toString(36), 10),
      role: 'READER',
      isActive: false,
    });

    // 2. Author Profile
    const existingProfile = await db.authorProfile.findUnique({ where: { userId: journalistUser.id } });
    if (!existingProfile) {
      await db.authorProfile.create({
        data: {
          userId: journalistUser.id,
          byline: 'Ayesha Rahman covers environmental policy and international summits for Global Chronicle News.',
          biography: 'Award-winning investigative reporter with over 12 years of experience covering global climate pacts.',
          designation: 'Senior Environmental Correspondent',
          socialLinks: { twitter: '@ayesha_demo_reporter', linkedin: 'in/ayesha-demo' },
          credentials: 'Columbia Journalism Fellow 2024',
        },
      });
    }

    // 3. Nested Categories
    const catWorld = await getOrCreateCategory({
      id: 'cat-world',
      name: 'World',
      slug: 'world',
      description: 'International diplomacy, treaties, and global affairs',
      color: 'bg-blue-600',
      displayOrder: 1,
    });

    await getOrCreateCategory({
      id: 'cat-world-asia',
      name: 'Asia-Pacific',
      slug: 'asia-pacific',
      description: 'Regional developments across South & East Asia',
      color: 'bg-cyan-600',
      parentId: catWorld.id,
      displayOrder: 2,
    });

    await getOrCreateCategory({
      id: 'cat-bangladesh',
      name: 'Bangladesh',
      slug: 'bangladesh',
      description: 'National development, infrastructure, trade and civic affairs in Bangladesh',
      color: 'bg-emerald-700',
      displayOrder: 2,
    });

    await getOrCreateCategory({
      id: 'cat-politics',
      name: 'Politics',
      slug: 'politics',
      description: 'National governance, constitutional policy, and elections',
      color: 'bg-red-600',
      displayOrder: 3,
    });

    await getOrCreateCategory({
      id: 'cat-business',
      name: 'Business & Economy',
      slug: 'economy',
      description: 'Global markets, fiscal policy, trade, and central banking',
      color: 'bg-emerald-600',
      displayOrder: 4,
    });

    await getOrCreateCategory({
      id: 'cat-tech',
      name: 'Technology & AI',
      slug: 'tech',
      description: 'Artificial intelligence, cybersecurity, and computational research',
      color: 'bg-purple-600',
      displayOrder: 5,
    });

    await getOrCreateCategory({
      id: 'cat-sports',
      name: 'Sports',
      slug: 'sports',
      description: 'Cricket, football, international tournaments, and athletics',
      color: 'bg-amber-600',
      displayOrder: 6,
    });

    await getOrCreateCategory({
      id: 'cat-entertainment',
      name: 'Entertainment & Culture',
      slug: 'entertainment',
      description: 'Cinema, music, literature, art exhibitions and cultural heritage',
      color: 'bg-rose-600',
      displayOrder: 7,
    });

    await getOrCreateCategory({
      id: 'cat-opinion',
      name: 'Editorials & Opinion',
      slug: 'opinion',
      description: 'In-depth perspectives and guest columns from leading voices',
      color: 'bg-indigo-600',
      displayOrder: 8,
    });

    await getOrCreateCategory({
      id: 'cat-video-photo',
      name: 'Video & Photo Stories',
      slug: 'video-photo',
      description: 'Visual journalism, photo essays and documentary video dispatches',
      color: 'bg-slate-800',
      displayOrder: 9,
    });

    // 4. Articles
    const summitSlug = 'global-climate-summit-reaches-landmark-accord';
    const existingArticle = await db.article.findUnique({ where: { slug: summitSlug } });
    if (!existingArticle) {
      const mediaSummit = await db.mediaAsset.create({
        data: {
          id: 'med-summit-01',
          filename: 'geneva-climate-summit-hall.jpg',
          originalUrl: 'https://images.unsplash.com/photo-1497435334941-8c899ee9e8e9?w=1200',
          mimeType: 'image/jpeg',
          sizeBytes: 845210,
          width: 1920,
          height: 1080,
          altText: 'Delegates gather at the plenary hall of the Geneva Climate Summit',
          caption: 'Plenary session of the 2026 Geneva Accord on clean energy finance.',
          credit: 'Global Chronicle Photo Wire',
          uploaderId: adminUser.id,
        },
      });

      const articleSummit = await db.article.create({
        data: {
          id: 'art-demo-summit',
          title: 'Global Climate Summit Reaches Landmark Accord on Renewable Transition',
          slug: summitSlug,
          excerpt: 'Delegates from 195 nations sign historic pact to accelerate clean energy adoption and climate finance over the next decade.',
          content: '<p>Delegates from 195 nations meeting in Geneva have successfully concluded weeks of intense negotiations by signing a landmark accord committing to an accelerated transition toward renewable energy sources.</p><p>The agreement outlines rigorous funding mechanisms for developing economies to modernize their energy grids and phase out carbon-heavy power generation by 2035.</p><p>Observers have hailed the consensus as a pivotal turning point in international environmental diplomacy.</p>',
          coverImageId: mediaSummit.id,
          coverImage: mediaSummit.originalUrl,
          categoryId: catWorld.id,
          authorId: journalistUser.id,
          status: 'PUBLISHED',
          priority: 'BREAKING',
          views: 1845,
          version: 2,
          publishedAt: new Date().toISOString(),
        },
      });

      // Additional BroadSheet Articles across Categories
      const catBd = await db.category.findUnique({ where: { slug: 'bangladesh' } });
      if (catBd) {
        await db.article.create({
          data: {
            id: 'art-demo-bd-01',
            title: 'Dhaka Metro Rail Line Extension Opens to Public Ahead of Schedule',
            slug: 'dhaka-metro-rail-extension-opens-to-public',
            excerpt: 'Commuters celebrate reduced transit times across central Dhaka as new stations initiate commercial operations today.',
            content: '<p>The Ministry of Road Transport and Bridges officially inaugurated the elevated railway extension today, connecting key commercial districts to suburban hubs.</p><p>Officials confirmed passenger traffic exceeded opening day estimates by 20 percent, easing congestion along major arterial corridors.</p>',
            coverImage: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=1200',
            categoryId: catBd.id,
            authorId: journalistUser.id,
            status: 'PUBLISHED',
            priority: 'FEATURED',
            views: 2410,
            publishedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          },
        });
      }

      const catEcon = await db.category.findUnique({ where: { slug: 'economy' } });
      if (catEcon) {
        await db.article.create({
          data: {
            id: 'art-demo-econ-01',
            title: 'Central Bank Adjusts Interest Corridor to Support Industrial Growth',
            slug: 'central-bank-adjusts-interest-corridor-industrial-growth',
            excerpt: 'Policy rate shift aims to balance inflation controls with competitive credit access for export manufacturing sectors.',
            content: '<p>In a scheduled monetary policy briefing, the central bank announced a calibrated shift in benchmark borrowing rates aimed at stabilizing foreign reserves while safeguarding export productivity.</p>',
            coverImage: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1200',
            categoryId: catEcon.id,
            authorId: analystUser.id,
            status: 'PUBLISHED',
            priority: 'NORMAL',
            views: 1120,
            publishedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
          },
        });
      }

      const catSport = await db.category.findUnique({ where: { slug: 'sports' } });
      if (catSport) {
        await db.article.create({
          data: {
            id: 'art-demo-sport-01',
            title: 'National Cricket Team Secures Series Victory with Spectacular Final Over',
            slug: 'national-cricket-team-secures-series-victory',
            excerpt: 'A brilliant bowling display in the closing overs sealed a memorable victory before a sold-out stadium crowd.',
            content: '<p>The national team delivered a masterclass in high-pressure bowling to clinch the international series in a thrilling final-over finish.</p>',
            coverImage: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=1200',
            categoryId: catSport.id,
            authorId: journalistUser.id,
            status: 'PUBLISHED',
            priority: 'NORMAL',
            views: 3100,
            publishedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
          },
        });
      }

      const catTech = await db.category.findUnique({ where: { slug: 'tech' } });
      if (catTech) {
        await db.article.create({
          data: {
            id: 'art-demo-tech-01',
            title: 'Breakthrough Semiconductor Architecture Promises 10x Energy Efficiency',
            slug: 'breakthrough-semiconductor-architecture-energy-efficiency',
            excerpt: 'Engineers unveil a new chip manufacturing methodology operating at sub-nanometer scale for advanced AI workloads.',
            content: '<p>Researchers at leading microelectronics laboratories have demonstrated a novel transistor stacking paradigm that significantly reduces thermal dissipation.</p>',
            coverImage: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200',
            categoryId: catTech.id,
            authorId: analystUser.id,
            status: 'PUBLISHED',
            priority: 'FEATURED',
            views: 1950,
            publishedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
          },
        });
      }

      const catEnt = await db.category.findUnique({ where: { slug: 'entertainment' } });
      if (catEnt) {
        await db.article.create({
          data: {
            id: 'art-demo-ent-01',
            title: 'International Film Festival Celebrates Independent South Asian Directors',
            slug: 'international-film-festival-celebrates-independent-directors',
            excerpt: 'A weeklong retrospective showcases groundbreaking documentaries and narrative features exploring contemporary society.',
            content: '<p>Critics and audiences turned out in large numbers for the opening night gala featuring award-winning independent filmmakers.</p>',
            coverImage: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1200',
            categoryId: catEnt.id,
            authorId: journalistUser.id,
            status: 'PUBLISHED',
            priority: 'NORMAL',
            views: 890,
            publishedAt: new Date(Date.now() - 3600000 * 18).toISOString(),
          },
        });
      }

      const catOp = await db.category.findUnique({ where: { slug: 'opinion' } });
      if (catOp) {
        await db.article.create({
          data: {
            id: 'art-demo-op-01',
            title: 'Essay: Why Public Transportation Investments Define the Next Urban Century',
            slug: 'essay-public-transportation-investments-define-urban-century',
            excerpt: 'Modern metropolitan planning requires moving beyond private automobiles toward resilient, zero-emission mass transit systems.',
            content: '<p>As global urban populations expand, cities face a fundamental choice between sprawling congestion and sustainable mobility networks...</p>',
            coverImage: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=1200',
            categoryId: catOp.id,
            authorId: analystUser.id,
            status: 'PUBLISHED',
            priority: 'NORMAL',
            views: 1420,
            publishedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
          },
        });
      }

      const catVid = await db.category.findUnique({ where: { slug: 'video-photo' } });
      if (catVid) {
        await db.article.create({
          data: {
            id: 'art-demo-vid-01',
            title: 'Photo Essay: The River Delta Farmers Adapting to Seasonal Salinity Shift',
            slug: 'photo-essay-river-delta-farmers-salinity-shift',
            excerpt: 'Visual documentation of coastal agricultural communities cultivating salt-tolerant crop varieties along the bay.',
            content: '<p>Our photojournalists spent three weeks documenting coastal farming collectives pioneering climate-resilient agriculture...</p>',
            coverImage: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200',
            categoryId: catVid.id,
            authorId: journalistUser.id,
            status: 'PUBLISHED',
            priority: 'NORMAL',
            views: 2150,
            publishedAt: new Date(Date.now() - 3600000 * 30).toISOString(),
          },
        });
      }

      // Breaking News Announcement
      await db.breakingNewsAnnouncement.create({
        data: {
          headline: 'Historic Geneva Climate Accord Signed by 195 Nations',
          summary: 'Developing nations to receive accelerated transition capital beginning Q1 2027.',
          articleId: articleSummit.id,
          urgencyRank: 3,
          isActive: true,
        },
      });
    }

    // Site Settings
    const existingSetting = await db.siteSetting.findUnique({ where: { key: 'NEWSROOM_POLICIES' } });
    if (!existingSetting) {
      await db.siteSetting.create({
        data: {
          key: 'NEWSROOM_POLICIES',
          value: {
            commentsRequiresApproval: true,
            defaultBreakingAlertsActive: true,
            retentionDaysRevisions: 365,
          },
          description: 'Global editorial moderation and archival settings',
        },
      });
    }

    logger.info('✓ Fictional development newsroom seed verified.', 'SEED');
  } catch (err) {
    logger.error('Error during development seed execution:', 'SEED', { error: String(err) });
  }
}
