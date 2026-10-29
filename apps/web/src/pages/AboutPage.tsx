import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { ButtonLink } from '../components/Button';
import { ContentBlock, fetchContentBlock } from '../lib/api';

/**
 * About Us — Brand Story and Company Information (ZYV-104, ZYV-117).
 *
 * Combines the ZYVORA craft story with honest business disclosures and
 * configurable content blocks.
 */

const SPECS = [
  ['Fabric', 'UV-stabilised polyester, 110 gsm'],
  ['Fly edge', 'Triple-stitched, 8 mm hem'],
  ['Dye', 'Fade-resistant, colour-fast to 40 washes'],
  ['Pole', 'Telescopic aluminium, to 1.2 m'],
  ['Clips', 'Anti-slip rubberised aluminium'],
  ['Wind load', 'Tested to 120 km/h'],
];

const STEPS = [
  {
    title: 'Cut',
    body: 'Flags are cut on a 30 × 20 cm bed with the seam allowance taken out of the panel rather than the fly edge, so the edge that takes the load is the strongest part of the cloth.',
  },
  {
    title: 'Stitched',
    body: 'The fly edge is triple-stitched on all three exposed sides. It is the first thing to fail on a cheap flag, and the reason this one outlives the car it is sold with.',
  },
  {
    title: 'Tested',
    body: 'Every batch goes out on our own road before it ships, not a laboratory rig. Hardware is checked for slip at speed and for corrosion after a monsoon.',
  },
];

export function AboutPage() {
  const [content, setContent] = useState<ContentBlock | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchContentBlock('about-us', controller.signal)
      .then((block) => setContent(block))
      .catch(() => {
        // Fallback gracefully
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <section className="mx-auto max-w-[1400px] px-5 py-16 sm:px-8 sm:py-24">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-ink-muted uppercase">
            <li>
              <Link to="/" className="transition-colors hover:text-brass-deep">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-ink" aria-current="page">
              About Us
            </li>
          </ol>
        </nav>

        <h1 className="max-w-[18ch] font-display text-[clamp(2.5rem,6vw,4.25rem)] leading-[0.98]">
          Made for the road, <em className="text-brass-deep italic">not</em> the
          shelf
        </h1>
        <p className="mt-7 max-w-[52ch] text-[15px] leading-[1.75] text-ink-soft">
          GrownLeaf was founded on a simple principle: car and bike flags should be
          engineered to withstand highway speeds, weather, and sun. We don't
          make cheap novelties. Everything here is built to fly with pride.
        </p>

        {/* Business Transparency Notice (ZYV-117) */}
        <div className="mt-10 max-w-[800px] rounded-2xl border border-slate-200/80 bg-slate-50/70 p-6 shadow-xs">
          <h2 className="text-[11px] font-bold tracking-[0.14em] text-brass-deep uppercase">
            Company &amp; Registration Transparency (ZYV-117)
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
            In accordance with e-commerce compliance guidelines, we provide
            truthful operational disclosures. No corporate details are invented:
          </p>
          <dl className="mt-4 grid gap-3 text-[12px] sm:grid-cols-2">
            <div>
              <dt className="font-bold text-ink-muted">Brand Name:</dt>
              <dd className="text-ink-soft">GrownLeaf®</dd>
            </div>
            <div>
              <dt className="font-bold text-ink-muted">Tagline:</dt>
              <dd className="text-ink-soft">
                Quality | Style | For Your World
              </dd>
            </div>
            <div>
              <dt className="font-bold text-ink-muted">Origin &amp; Base:</dt>
              <dd className="text-ink-soft">Chennai, Tamil Nadu, India</dd>
            </div>
            <div>
              <dt className="font-bold text-ink-muted">Customer Support:</dt>
              <dd className="text-ink-soft">support@zyvora.com</dd>
            </div>
            <div>
              <dt className="font-bold text-ink-muted">Legal GSTIN:</dt>
              <dd className="text-ink-soft">
                [GSTIN: Pending State Tax Registration]
              </dd>
            </div>
            <div>
              <dt className="font-bold text-ink-muted">Corporate Identity:</dt>
              <dd className="text-ink-soft">
                [CIN: Pending Ministry of Corporate Affairs Filing]
              </dd>
            </div>
          </dl>
        </div>

        {content?.body ? (
          <div className="prose mt-10 max-w-[700px] text-[14px] leading-relaxed text-ink-soft">
            <div dangerouslySetInnerHTML={{ __html: content.body }} />
          </div>
        ) : null}
      </section>

      <section className="grid bg-paper-sunk lg:grid-cols-2">
        <div
          className="min-h-[300px] bg-gradient-to-br from-[#3a3733] to-[#1a1918] lg:min-h-[480px]"
          aria-hidden="true"
        />
        <div className="flex flex-col items-start justify-center px-6 py-16 sm:px-10 lg:px-[clamp(2.5rem,8vw,7rem)]">
          <h2 className="font-display text-[clamp(2rem,4vw,3rem)]">
            The process
          </h2>
          <dl className="mt-8 grid gap-8">
            {STEPS.map((step) => (
              <div key={step.title}>
                <dt className="text-[10px] font-bold tracking-[0.18em] text-brass-deep uppercase">
                  {step.title}
                </dt>
                <dd className="mt-2 max-w-[46ch] text-[14px] leading-[1.75] text-ink-soft">
                  {step.body}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-[900px] px-5 py-20 sm:px-8">
        <p className="eyebrow">Specification</p>
        <h2 className="font-display text-[clamp(2rem,4vw,3rem)]">
          What you are <em className="text-brass-deep italic">buying</em>
        </h2>

        <dl className="mt-9 divide-y divide-rule border-y border-rule">
          {SPECS.map(([term, value]) => (
            <div
              key={term}
              className="grid gap-1 py-4 sm:grid-cols-[180px_1fr] sm:gap-6"
            >
              <dt className="text-[11px] font-bold tracking-[0.1em] text-ink-muted uppercase">
                {term}
              </dt>
              <dd className="text-[14px] text-ink-soft">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 flex flex-wrap gap-4">
          <ButtonLink to="/catalog" variant="brass" size="lg">
            Shop the collection
          </ButtonLink>
          <Link
            to="/shipping-policy"
            className="self-center border-b border-brass-deep pb-1 text-[10px] font-bold tracking-[0.13em] uppercase transition-colors hover:text-brass-deep"
          >
            Shipping Policy
          </Link>
          <Link
            to="/contact"
            className="self-center border-b border-brass-deep pb-1 text-[10px] font-bold tracking-[0.13em] uppercase transition-colors hover:text-brass-deep"
          >
            Contact Support
          </Link>
        </div>
      </section>
    </>
  );
}
