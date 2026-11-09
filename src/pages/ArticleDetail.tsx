/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Clock, Eye, Share2, ArrowLeft, ChevronRight } from 'lucide-react';
import { DispatchAudioPlayer } from '../components/DispatchAudioPlayer';
import { ReactionMeter } from '../components/ReactionMeter';
import { LiveBlogStream } from '../components/LiveBlogStream';
import { CommentSection } from '../components/CommentSection';
import { ArticleImage } from '../components/ArticleImage';
import { PageMetadata } from '../components/PageMetadata';
import { NewsletterModule } from '../components/NewsletterModule';
import { RelatedStories } from '../components/RelatedStories';
import DOMPurify from 'dompurify';
import parse, { Element } from 'html-react-parser';
import YouTube from 'react-youtube';
import { TwitterTweetEmbed } from 'react-twitter-embed';
import { Slideshow } from '../components/Slideshow';

interface ArticleDetailProps {
  slug: string;
  onBack: () => void;
  onSelectCategory: (slug: string) => void;
}

export const ArticleDetail: React.FC<ArticleDetailProps> = ({ slug, onBack, onSelectCategory }) => {
  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/articles/${encodeURIComponent(slug)}`)
      .then((res) => res.json())
      .then((data) => {
        setArticle(data);
        setLoading(false);

        // Fire analytics PAGE_VIEW event (Phase 8 metadata allowlist keys only)
        if (data && data.id) {
          fetch('/api/analytics/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'PAGE_VIEW',
              entityId: data.id,
              metadata: {
                articleId: data.id,
                referrer: document.referrer
              }
            })
          }).catch(err => console.error('Analytics tracking failed:', err));
        }
      })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-stone-900"></div>
      </div>
    );
  }

  if (!article || article.error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <h2 className="font-serif font-bold text-2xl text-stone-900">Article not found</h2>
        <button onClick={onBack} className="bg-stone-900 text-white px-6 py-2 rounded-lg text-sm font-medium">
          Return to Homepage
        </button>
      </div>
    );
  }

  // Phase 9: share/canonical URL is built from the validated server-injected
  // APP_URL + the stable slug path — never raw window.location.href.
  const articleUrlShare = `${(window as any).__GC_APP_URL__ || ''}/article/${encodeURIComponent(article.slug)}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt || undefined,
    image: article.coverImage ? [article.coverImage] : undefined,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    author: [{
      '@type': 'Person',
      name: article.author?.name || 'Staff Reporter'
    }],
    publisher: {
      '@type': 'NewsMediaOrganization',
      name: 'Global Chronicle',
      logo: {
        '@type': 'ImageObject',
        url: `${(window as any).__GC_APP_URL__ || ''}/logo.svg`
      }
    },
    mainEntityOfPage: articleUrlShare,
    articleSection: article.category?.name || undefined,
    inLanguage: (article as any).language === 'bn' ? 'bn' : 'en'
  };

  return (
    <article className="max-w-4xl mx-auto px-4 md:px-8 py-10 space-y-8">
      <PageMetadata
        title={article.title}
        description={article.excerpt}
        canonicalPath={`/article/${encodeURIComponent(article.slug)}`}
        ogImage={article.coverImage}
        type="article"
        publishedAt={article.publishedAt}
        modifiedAt={article.updatedAt}
        authorName={article.author?.name}
      />
      <script type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </script>
      <div className="flex items-center text-sm text-stone-500 mb-4 space-x-2">
        <span>Home</span>
        <ChevronRight className="w-4 h-4" />
        <span>{article.category?.name || 'News'}</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-stone-900 font-medium truncate">{article.title}</span>
      </div>
      <button
        onClick={onBack}
        className="flex items-center space-x-2 text-stone-600 hover:text-stone-950 font-medium text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to News Feed</span>
      </button>

      {/* Article Header */}
      <div className="space-y-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => onSelectCategory(article.category?.slug || 'world')}
            className={`${article.category?.color || 'bg-red-700'} text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded shadow-xs`}
          >
            {article.category?.name || 'World News'}
          </button>
          {article.articleType === 'OPINION' && (
            <span className="bg-amber-100 text-amber-800 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded shadow-xs">
              Opinion
            </span>
          )}
          {article.articleType === 'EXPLAINER' && (
            <span className="bg-blue-100 text-blue-800 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded shadow-xs">
              Explainer
            </span>
          )}
          <span className="text-stone-400">•</span>
          <span className="text-xs text-stone-500 flex items-center space-x-1">
            <Clock className="w-3.5 h-3.5" />
            <span>{new Date(article.publishedAt || article.createdAt).toLocaleDateString()}</span>
          </span>
          <span className="text-stone-400">•</span>
          <span className="text-xs text-stone-500 flex items-center space-x-1">
            <Eye className="w-3.5 h-3.5" />
            <span>{article.views} reads</span>
          </span>
        </div>

        <h1 className="font-serif font-bold text-3xl md:text-5xl text-stone-900 leading-tight">
          {article.title}
        </h1>

        <p className="text-stone-600 text-xl leading-relaxed font-serif">
          {article.excerpt}
        </p>

        {/* Author Byline */}
        <div className="flex items-center justify-between border-y border-stone-200 py-4">
          <div className="flex items-center space-x-3">
            <img
              src={article.author?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}
              alt={article.author?.name || 'Staff Reporter'}
              className="w-12 h-12 rounded-full object-cover border border-stone-300 shadow-xs"
            />
            <div>
              <h4 className="font-serif font-bold text-stone-900 text-base">{article.author?.name || 'Staff Reporter'}</h4>
              <p className="text-xs text-stone-500">Senior Staff Correspondent, Global Chronicle Bureau</p>
            </div>
          </div>

          <button
            onClick={() => {
              navigator.clipboard.writeText(articleUrlShare);
              setToastMessage('Article link copied to clipboard!');
              setTimeout(() => setToastMessage(''), 3000);
            }}
            className="p-2.5 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-800 transition-colors"
            title="Share Article"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>

        {toastMessage && (
          <div className="bg-stone-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-md animate-fade-in flex items-center justify-between">
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage('')} className="ml-4 text-stone-400 hover:text-white">✕</button>
          </div>
        )}
      </div>

      {/* AI Audio Dispatch Narration */}
      <DispatchAudioPlayer
        title={article.title}
        excerpt={article.excerpt}
        content={article.content}
      />

      {/* Specialized Media Header (Video, Gallery, or Cover Image) */}
      {article.articleType === 'VIDEO' && article.videoUrl && (
        <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-lg my-8">
          <iframe
            src={article.videoUrl.includes('youtube.com') || article.videoUrl.includes('youtu.be') 
              ? article.videoUrl.replace('watch?v=', 'embed/').split('&')[0]
              : article.videoUrl}
            className="w-full h-full border-0"
            allowFullScreen
            title="Video Content"
          />
        </div>
      )}

      {article.articleType === 'PHOTO_GALLERY' && article.mediaAssets && article.mediaAssets.length > 0 && (
        <Slideshow items={article.mediaAssets} />
      )}

      {article.articleType !== 'VIDEO' && article.articleType !== 'PHOTO_GALLERY' && article.coverImage && (
        <ArticleImage
          src={article.coverImage}
          alt={article.title}
          caption={article.imageCaption}
          credit={article.imageCredit}
          priority={true}
        />
      )}

      {/* Article Body Content */}
      <div className="prose prose-stone lg:prose-lg max-w-none font-serif leading-relaxed space-y-6 text-stone-800">
        {parse(DOMPurify.sanitize(article.content), {
          replace: (domNode) => {
            if (domNode instanceof Element && domNode.name === 'iframe') {
              const src = domNode.attribs.src;
              if (src.includes('youtube.com') || src.includes('youtu.be')) {
                const videoId = src.split('/').pop()?.split('?')[0];
                return <YouTube videoId={videoId} />;
              }
              if (src.includes('twitter.com')) {
                const tweetId = src.split('/').pop();
                return <TwitterTweetEmbed tweetId={tweetId || ''} />;
              }
            }
          }
        })}
      </div>

      <NewsletterModule />

      <RelatedStories 
        articleId={article.id} 
        tags={article.tags || []} 
        categoryId={article.category?.id} 
      />

      {/* Live Blog Coverage Stream if present */}
      <LiveBlogStream articleId={article.id} />

      {/* Reader Reaction Meter */}
      <ReactionMeter articleId={article.id} />

      {/* Moderated Comments Section */}
      <CommentSection articleId={article.id} />
    </article>
  );
};

