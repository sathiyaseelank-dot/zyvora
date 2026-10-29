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
          GrownLeaf was founded on a simple principle: car and bike flags should
          be engineered to withstand highway speeds, weather, and sun. We don't
          make cheap novelties. Everything here is built to fly with pride.
        </p>

        {/* Business Transparency Notice (ZYV-117) */}
        <div className="mt-10 max-w-[860px] rounded-2xl border border-slate-200/80 bg-slate-50/70 p-6 sm:p-7 shadow-xs">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100/80 text-amber-800 text-base shadow-xs"
              aria-hidden="true"
            >
              🛡️
            </span>
            <div>
              <h2 className="text-[15px] font-bold text-slate-900 leading-snug">
                Company &amp; Registration Transparency
              </h2>
              <p className="text-[11px] font-medium text-slate-500">
                Official business compliance disclosures
              </p>
            </div>
          </div>

          <p className="mt-3.5 text-[13px] leading-relaxed text-slate-600">
            In accordance with e-commerce compliance guidelines, we provide
            truthful operational disclosures. No corporate details are invented:
          </p>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Brand Name
              </dt>
              <dd className="mt-1 text-sm font-bold text-slate-900">
                GrownLeaf®
              </dd>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Official Tagline
              </dt>
              <dd className="mt-1 text-xs font-semibold text-amber-800">
                Quality | Style | For Your World
              </dd>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Origin &amp; Base
              </dt>
              <dd className="mt-1 text-xs font-semibold text-slate-800">
                Chennai, Tamil Nadu, India
              </dd>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Customer Support
              </dt>
              <dd className="mt-1 text-xs font-semibold text-slate-800">
                support@zyvora.com
              </dd>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                State Tax ID
              </dt>
              <dd className="mt-1.5 inline-block rounded-md border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                [GSTIN: Pending State Tax Registration]
              </dd>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
              <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Corporate Filing
              </dt>
              <dd className="mt-1.5 inline-block rounded-md border border-amber-200/60 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
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
