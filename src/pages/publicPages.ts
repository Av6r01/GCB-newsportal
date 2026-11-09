/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 10: owned policy/standards pages — single source of truth shared by
 * the client renderer (src/pages/PublicPage.tsx) and the server SEO shell
 * (case 'page' in server.ts). Every statement describes this application's
 * actual verified mechanics (review queues, revision tracking, first-party
 * analytics, stored newsletter subscriptions) — no invented certifications,
 * no promised features that do not exist.
 */

export interface StaticSection {
  heading: string;
  paragraphs: string[];
}

export interface StaticPage {
  slug: string;
  title: string;
  description: string;
  /** ISO date the copy was last reviewed, shown in the page header. */
  reviewedAt: string;
  sections: StaticSection[];
}

export const STATIC_PAGES: Record<string, StaticPage> = {
  about: {
    slug: 'about',
    title: 'About the Global Chronicle',
    description:
      'Who we are: the Global Chronicle newsroom, its bureaus, and how the newsroom operates the publishing pipeline you are reading.',
    reviewedAt: '2026-11-08',
    sections: [
      {
        heading: 'An independent journalistic record',
        paragraphs: [
          'The Global Chronicle is an independent news organisation operating bureaus in Dhaka, London, New York and Tokyo. Its editorial mission has not changed since its founding: publish a verified record of world events — breaking coverage, analysis, and long investigations — free from commercial or political instruction.',
          'This portal is bilingual. Editors file in English or Bangla and every dispatch carries its own language metadata so readers see the story as it was written.',
        ],
      },
      {
        heading: 'How this newsroom runs',
        paragraphs: [
          'Every story you read passed through the newsroom workflow you would expect of a functioning editorial operation: reporters draft, section editors review, copy editors correct the prose, and managing editors approve before publication. Drafts, revisions, approvals and corrections are all recorded in the publishing system with a named editor and a timestamp — the record is auditable internally at any moment.',
          'Timed releases run through the scheduled-publishing pipeline: when a dispatch is slated for a future release, it stays hidden until the scheduled moment, then goes live to the portal, feeds and sitemaps.',
        ],
      },
      {
        heading: 'Tell us what we are getting wrong',
        paragraphs: [
          'Our corrections and standards processes are described on the standards page. The newsroom reads every message sent to newsroom@globalchronicle.org and treats receipts (tips, documents, data) as confidential.',
        ],
      },
    ],
  },

  standards: {
    slug: 'standards',
    title: 'Editorial Standards & Integrity',
    description:
      'The Global Chronicle editorial integrity policy: sourcing discipline, fact-checking protocol, corrections, conflict-of-interest disclosure and how readers can reach the standards desk.',
    reviewedAt: '2026-11-08',
    sections: [
      {
        heading: 'Editorial integrity policy',
        paragraphs: [
          'Fact claims in a published dispatch must be attributable — to a named source, a document, or an on-the-record interview. When the newsroom grants anonymity, the reasons are recorded in the internal review trail before publication, and the source is known to at least two editors by identity.',
          'The publishing system enforces this discipline structurally: nothing reaches the live portal until it has moved through the review queue, been approved by an editor with publishing rights, and been recorded in the audit trail. No story bypasses that sequence.',
        ],
      },
      {
        heading: 'Fact-checking protocol',
        paragraphs: [
          'Reports designated investigative undergo a dedicated verification pass: source documents are checked against originals, figures are re-derived from the underlying data, and quotations are reconciled against recordings or contemporaneous notes. Findings are logged per article, so the trail of what was verified — and how — can be reconstructed for any published piece.',
        ],
      },
      {
        heading: 'Corrections & standards response',
        paragraphs: [
          'Errors are corrected on the record. A correction to a live article is applied as a tracked revision — the previous version is preserved and the change is annotated — rather than silently rewritten. Where the error materially affected readers\u2019 understanding, the correction is labelled at the top of the piece.',
          'Readers who believe a dispatch is wrong can write to newsroom@globalchronicle.org. Complaints naming a specific article are reviewed by an editor who had no hand in the original story.',
        ],
      },
      {
        heading: 'Conflict of interest disclosures',
        paragraphs: [
          'Staff with a financial or personal stake in a subject of coverage must declare it to their editor, and the story is reassigned or the relationship disclosed in the article. Editors of commercial operations and the newsroom desk are organisationally separate: advertising decisions do not reach story assignment.',
        ],
      },
      {
        heading: 'Sources & sensitive information',
        paragraphs: [
          'Readers with documents or tips can contact the newsroom desk at newsroom@globalchronicle.org. Treat communications you need to keep confidential as material for expressive review by your own counsel; do not transmit credentials that would compromise you, and never send regulated data the law reserves to public authorities. Tips are read by editors only.',
        ],
      },
    ],
  },

  privacy: {
    slug: 'privacy',
    title: 'Privacy Policy',
    description:
      'What data this site collects, why (first-party analytics, newsletter subscriptions, moderated comments), how long it is kept, and what it is never used for.',
    reviewedAt: '2026-11-08',
    sections: [
      {
        heading: 'What we collect',
        paragraphs: [
          'Newsletter subscriptions: the email address you submit is stored in this site\u2019s database for the newsletter list and for nothing else. You can remove it at any time via the unsubscribe form on any article page that features the signup module, and staff removal is available on request.',
          'Comments: if you submit a comment, your display name and the comment text are stored, and comments enter a moderation queue before they appear where approval is required.',
          'First-party analytics: this site records anonymous reader events (page views, article opens, searches, shares, clicks, reactions, comment activity) in its own database to count readership. Events are enumerated and bounded — no screen-recording pixels, no session replay, no advertising identifiers.',
        ],
      },
      {
        heading: 'What we never do',
        paragraphs: [
          'No third-party analytics or tracking scripts run on this site. Advertising slots, when configured, are served from this site\u2019s own ad inventory — the application does not connect programmatic tracking brokers.',
          'Subscriber emails are never sold, swapped, or exported to advertising platforms. Editorial staff access to subscriber rosters is permission-gated and every roster change is recorded in an audit trail.',
        ],
      },
      {
        heading: 'Sessions & sign-ins',
        paragraphs: [
          'Editorial staff sign into a protected workspace; sessions are token-based and can be revoked by the account holder (sign out) or an administrator at any time. Reader-facing pages require no account.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [
          'Questions about stored data can be sent to newsroom@globalchronicle.org, stating the address you want reviewed.',
        ],
      },
    ],
  },

  terms: {
    slug: 'terms',
    title: 'Terms of Use',
    description:
      'Ground rules for using this site: what we publish, what you may do with it, and the standard that reader submissions must meet.',
    reviewedAt: '2026-11-08',
    sections: [
      {
        heading: 'Content and its licence',
        paragraphs: [
          'Published dispatches, photography and artwork are the copyrighted work of the Global Chronicle or their stated authors. You may share and quote excerpts online with attribution and a link to the article page. Bulk republication, machine-scraping at volume, or presenting our reporting as your own are not permitted.',
        ],
      },
      {
        heading: 'Reader submissions',
        paragraphs: [
          'Comments and submitted material must be lawful and civil. The newsroom moderates submissions and removes content that is defamatory, threatening, hateful or spam, in line with the moderation policy applied in the system. Repeated abuse can lead to blocked submissions.',
          'You keep ownership of what you write, but by submitting you grant the newsroom the right to display and store the contribution as part of the published discussion.',
        ],
      },
      {
        heading: 'Accuracy and liability',
        paragraphs: [
          'The newsroom publishes verified reporting, but no publication is a guarantee against error; our corrections process is described on the standards page. Content is provided as-is for information purposes; analysis and opinion pieces are identified as such and represent their authors.',
        ],
      },
    ],
  },

  contact: {
    slug: 'contact',
    title: 'Contact the Newsroom',
    description:
      'Bureau addresses and newsroom email for the Global Chronicle — tips, corrections, standards complaints and subscriber enquiries.',
    reviewedAt: '2026-11-08',
    sections: [
      {
        heading: 'Newsroom desk',
        paragraphs: [
          'General editorial contact, tips and corrections: newsroom@globalchronicle.org. Messages are read by editors; tip material is treated as confidential to the standards desk.',
        ],
      },
      {
        heading: 'Bureaus',
        paragraphs: [
          'Dhaka main desk: Kawran Bazar, Dhaka 1215.',
          'London office: Fleet Street, EC4Y 1AA.',
          'New York bureau: 8th Ave, NY 10018.',
        ],
      },
      {
        heading: 'Staff access',
        paragraphs: [
          'Editorial staff sign in through the Editorial CMS link in this site\u2019s footer. Reader accounts are not required to browse or comment.',
        ],
      },
    ],
  },
};

export function isStaticPageSlug(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(STATIC_PAGES, slug);
}
