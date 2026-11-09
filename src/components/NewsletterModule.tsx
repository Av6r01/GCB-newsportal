import React, { useState } from 'react';

export const NewsletterModule: React.FC = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setStatus('success');
      } else {
        setStatus('idle');
        alert('Failed to subscribe. Please try again.');
      }
    } catch (err) {
      console.error('Newsletter error:', err);
      setStatus('idle');
    }
  };

  return (
    <div className="bg-stone-100 p-6 rounded-lg my-8 space-y-4">
      <h3 className="font-serif font-bold text-lg text-stone-900">Subscribe to our Newsletter</h3>
      <p className="text-sm text-stone-600">Get the latest stories delivered to your inbox daily.</p>
      <div aria-live="polite">
        {status === 'success' ? (
          <p className="text-green-700 font-medium">Thank you for subscribing!</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              aria-label="Email address for newsletter"
              className="flex-1 px-3 py-2 border border-stone-300 rounded text-sm focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none"
              required
            />
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="bg-stone-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-stone-800 disabled:opacity-50 focus:ring-2 focus:ring-stone-900 outline-none"
            >
              {status === 'submitting' ? 'Submitting...' : 'Subscribe'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
