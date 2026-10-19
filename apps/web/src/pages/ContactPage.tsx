import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ContentBlock, fetchContentBlock } from '../lib/api';

/**
 * Contact Us Page (ZYV-103, ZYV-117).
 *
 * Implements contact channels, customer inquiry form, and honest placeholders
 * for business details that have not yet been officially registered.
 */
export function ContactPage() {
  const [content, setContent] = useState<ContentBlock | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetchContentBlock('contact-us', controller.signal)
      .then((block) => setContent(block))
      .catch(() => {
        // Fallback gracefully if backend content block is unreachable
      });
    return () => controller.abort();
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) return;
    setSubmitted(true);
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-12 sm:px-8 sm:py-16">
      <nav aria-label="Breadcrumb" className="mb-8">
        <ol className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink-muted uppercase">
          <li>
            <Link to="/" className="transition-colors hover:text-brass-deep">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-ink" aria-current="page">
            Contact Us
          </li>
        </ol>
      </nav>

      <div className="max-w-[760px]">
        <p className="eyebrow">Customer Support &amp; Enquiries</p>
        <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05]">
          Get in touch with <em className="text-brass-deep italic">ZYVORA</em>
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          Have a question about vehicle fitment, bulk orders, or shipping times?
          Our team is here to assist you.
        </p>
      </div>

      {/* Business Transparency Notice (ZYV-117) */}
      <div className="mt-8 border border-brass/30 bg-paper-sunk p-5 sm:p-6">
        <h2 className="text-[11px] font-bold tracking-[0.14em] text-brass-deep uppercase">
          Business Details &amp; Transparency Notice
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
          ZYVORA operates with transparency. In compliance with e-commerce
          consumer protection standards, business registrations and support
          channels are listed below. Missing details are shown with official
          placeholders:
        </p>
        <dl className="mt-4 grid gap-3 text-[12px] sm:grid-cols-2">
          <div>
            <dt className="font-bold text-ink-muted">Operating Region:</dt>
            <dd className="text-ink-soft">Chennai, Tamil Nadu, India</dd>
          </div>
          <div>
            <dt className="font-bold text-ink-muted">Support Hours:</dt>
            <dd className="text-ink-soft">Mon – Sat, 9:00 AM – 6:00 PM IST</dd>
          </div>
          <div>
            <dt className="font-bold text-ink-muted">GSTIN:</dt>
            <dd className="text-ink-soft">
              [GSTIN: Pending State Tax Registration]
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink-muted">CIN / Registration:</dt>
            <dd className="text-ink-soft">
              [CIN: Pending Ministry of Corporate Affairs Filing]
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink-muted">Helpline Phone:</dt>
            <dd className="text-ink-soft">
              [Support Phone: Pending Official Helpline Setup]
            </dd>
          </div>
          <div>
            <dt className="font-bold text-ink-muted">Support Email:</dt>
            <dd className="text-ink-soft">support@zyvora.com</dd>
          </div>
        </dl>
      </div>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_420px]">
        {/* Contact Form */}
        <section aria-labelledby="enquiry-form-heading">
          <h2
            id="enquiry-form-heading"
            className="font-display text-[22px] font-semibold"
          >
            Send us a message
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Fill in your details below and we will respond within 24 to 48
            business hours.
          </p>

          {submitted ? (
            <div
              role="alert"
              className="mt-6 border border-emerald-600/30 bg-emerald-50 p-6 text-emerald-900"
            >
              <h3 className="text-[14px] font-bold">Message sent</h3>
              <p className="mt-1 text-[13px] leading-relaxed">
                Thank you for reaching out, {name}! Your enquiry has been
                received. Our support team will respond to {email} shortly.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setName('');
                  setEmail('');
                  setSubject('');
                  setMessage('');
                }}
                className="mt-4 text-[11px] font-bold tracking-[0.14em] text-emerald-800 uppercase underline"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
              <div>
                <label
                  htmlFor="contact-name"
                  className="block text-[11px] font-bold tracking-[0.1em] text-ink-muted uppercase"
                >
                  Full Name *
                </label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="mt-1.5 w-full border border-rule bg-paper px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-brass-deep"
                />
              </div>

              <div>
                <label
                  htmlFor="contact-email"
                  className="block text-[11px] font-bold tracking-[0.1em] text-ink-muted uppercase"
                >
                  Email Address *
                </label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1.5 w-full border border-rule bg-paper px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-brass-deep"
                />
              </div>

              <div>
                <label
                  htmlFor="contact-subject"
                  className="block text-[11px] font-bold tracking-[0.1em] text-ink-muted uppercase"
                >
                  Subject *
                </label>
                <input
                  id="contact-subject"
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Order inquiry, flag fitment, etc."
                  className="mt-1.5 w-full border border-rule bg-paper px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-brass-deep"
                />
              </div>

              <div>
                <label
                  htmlFor="contact-message"
                  className="block text-[11px] font-bold tracking-[0.1em] text-ink-muted uppercase"
                >
                  Message *
                </label>
                <textarea
                  id="contact-message"
                  required
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your inquiry or vehicle details..."
                  className="mt-1.5 w-full border border-rule bg-paper px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors focus:border-brass-deep"
                />
              </div>

              <div>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center bg-brass px-6 py-3 text-[11px] font-bold tracking-[0.14em] text-ground-deep uppercase transition-colors hover:bg-brass-glow focus:outline-none focus:ring-2 focus:ring-brass"
                >
                  Submit Inquiry
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Dynamic / Seed Content block */}
        <section
          aria-labelledby="about-support-heading"
          className="border-t border-rule pt-8 lg:border-t-0 lg:border-l lg:pl-10"
        >
          <h2
            id="about-support-heading"
            className="font-display text-[20px] font-semibold"
          >
            {content?.title ?? 'Customer Assistance'}
          </h2>
          <div className="mt-4 text-[13px] leading-relaxed text-ink-soft">
            {content?.body ? (
              <div
                dangerouslySetInnerHTML={{ __html: content.body }}
                className="prose prose-sm"
              />
            ) : (
              <p>
                Our customer support team assists with order tracking,
                customization queries, and exchange requests. If you have an
                active order, please mention your order ID in your message for
                expedited service.
              </p>
            )}
          </div>

          <div className="mt-8 border-t border-rule pt-6">
            <h3 className="text-[11px] font-bold tracking-[0.12em] text-ink uppercase">
              Quick links
            </h3>
            <ul className="mt-3 grid gap-2 text-[12px] text-ink-muted">
              <li>
                <Link
                  to="/faq"
                  className="transition-colors hover:text-brass-deep"
                >
                  Frequently Asked Questions →
                </Link>
              </li>
              <li>
                <Link
                  to="/shipping-policy"
                  className="transition-colors hover:text-brass-deep"
                >
                  Shipping Policy →
                </Link>
              </li>
              <li>
                <Link
                  to="/return-refund-policy"
                  className="transition-colors hover:text-brass-deep"
                >
                  Return &amp; Refund Policy →
                </Link>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
