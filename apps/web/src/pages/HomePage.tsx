import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProductSummary } from '@zyvora/types';

import heroAsset from '../assets/hero.png';
import { Banner, fetchBanners, fetchProducts } from '../lib/api';
import { ButtonLink } from '../components/Button';
import { ProductImage } from '../components/ProductImage';

/**
 * Home page (ZYV-96 shell, ZYV-107 hero banner, ZYV-108 genuine reviews, ZYV-112 structure).
 *
 * Requirements:
 *  - ZYV-107: Main promotional banner assets produced, responsive crops for mobile and desktop,
 *    advertisement used as inspiration rather than the whole page.
 *  - ZYV-108: Reviews section shown ONLY when genuine reviews exist. Section hidden when no
 *    approved reviews. Shows rating and count only when real. No fabricated testimonials.
 *  - ZYV-112: Full home structure with featured products, features, Why Choose ZYVORA, FAQ preview.
 */

function ProductStrip({
  onProductsLoaded,
}: {
  onProductsLoaded?: (products: ProductSummary[]) => void;
}) {
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchProducts({ pageSize: 6 }, controller.signal)
      .then((r) => {
        setProducts(r.data);
        onProductsLoaded?.(r.data);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [onProductsLoaded]);

  if (failed) {
    return (
      <p className="text-[13px] text-ink-muted">
        Flags are unavailable right now. Please try again shortly.
      </p>
    );
  }

  if (!products) {
    return (
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="aspect-4/5 animate-pulse bg-paper-sunk" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted">No flags published yet.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
      {products.slice(0, 3).map((product) => (
        <Link
          key={product.id}
          to={`/products/${product.id}`}
          className="group block min-w-0"
        >
          <div className="aspect-4/5 overflow-hidden bg-paper-sunk">
            <ProductImage
              src={product.image}
              alt={product.name}
              className="h-full w-full object-cover saturate-[0.82] transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-105"
            />
          </div>
          <p className="mt-4 mb-1.5 text-[9px] font-bold tracking-[0.13em] text-brass-deep uppercase">
            {product.category}
          </p>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-[17px]">{product.name}</h3>
            <p className="shrink-0 text-[13px] font-semibold whitespace-nowrap">
              {formatPrice(product.price)}
            </p>
          </div>
          {product.rating ? (
            <p className="mt-1 text-[11px] font-medium text-brass-deep">
              {product.rating.average} ★{' '}
              <span className="text-ink-muted">({product.rating.count})</span>
            </p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

function formatPrice(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

const TICKER = [
  'Free shipping over ₹2,000',
  'Hand-finished in Chennai',
  'Weatherproof to 120 km/h',
];

const WHY_CHOOSE_ITEMS = [
  {
    title: 'Aerodynamic Strength',
    description:
      'Engineered specifically for high-speed highway wind load, tested to remain firmly attached and fray-resistant up to 120 km/h.',
    icon: '⚡',
  },
  {
    title: 'UV-Stabilised Cloth',
    description:
      'Durable 110 GSM polyester treated with UV-resistant dyes to ensure colours remain vibrant through intense tropical sunlight.',
    icon: '☀️',
  },
  {
    title: 'Triple-Stitched Hem',
    description:
      'The fly edge is triple-stitched on all three outer sides with bonded thread so the edge under tension does not unravel.',
    icon: '🧵',
  },
  {
    title: 'Tool-Free Mounting',
    description:
      'Heavy-duty rubberised aluminium clips install in seconds on car window glass or motorcycle handlebar mounts without scratches.',
    icon: '🔧',
  },
];

const PREVIEW_FAQS = [
  {
    q: 'Will the flag withstand highway speeds and heavy rain?',
    a: 'Yes. Every GrownLeaf flag is constructed from 110 GSM UV-stabilised polyester with triple-stitched outer hems and tested to withstand highway winds up to 120 km/h in wet and dry conditions.',
  },
  {
    q: 'Will the window clip damage my car glass or tint film?',
    a: 'No. The mounting clip features anti-slip rubberised cushions on all contact points to protect automotive glass and window tints from scratches or pressure marks.',
  },
  {
    q: 'Can the flag be washed?',
    a: 'Yes. Our flags can be gently hand-washed or cold-machine-washed using mild detergent. The fade-resistant dyes are colour-fast and will not shrink.',
  },
];

export function HomePage() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [ratedProducts, setRatedProducts] = useState<ProductSummary[]>([]);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchBanners(controller.signal)
      .then((b) => setBanners(b))
      .catch(() => {
        // Fallback silently if banner endpoint is unavailable
      });
    return () => controller.abort();
  }, []);

  function handleProductsLoaded(items: ProductSummary[]) {
    const genuine = items.filter(
      (p) =>
        p.rating && typeof p.rating.count === 'number' && p.rating.count > 0,
    );
    setRatedProducts(genuine);
  }

  return (
    <>
      {/* Hero section with promotional visual and branding (ZYV-107, ZYV-112) */}
      <section className="on-ground grid min-h-[520px] bg-ground text-on-ground lg:grid-cols-[46fr_54fr]">
        <div className="relative z-10 flex flex-col items-start justify-center px-6 py-16 sm:px-10 lg:px-[clamp(2rem,8vw,7.5rem)]">
          <p className="eyebrow">Premium car &amp; bike flags</p>
          <h1 className="font-display text-[clamp(3.25rem,7vw,5.75rem)] leading-[0.94]">
            Flags that <em className="text-brass-glow italic">fly</em> first.
          </h1>
          <p className="mt-6 max-w-[38ch] text-[15px] leading-[1.7] text-on-ground-muted">
            Triple-stitched, UV-stabilised and cut to the wind. Built for the
            road, not the shelf.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <ButtonLink to="/catalog" variant="brass" size="lg">
              Shop flags <span aria-hidden="true">→</span>
            </ButtonLink>
            <ButtonLink
              to="/about"
              variant="ghost"
              size="lg"
              className="text-on-ground hover:text-brass-glow hover:border-brass-glow/40"
            >
              Our craft
            </ButtonLink>
          </div>
        </div>

        {/* Responsive Hero Banner Asset (ZYV-107) */}
        <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden bg-gradient-to-br from-[#2a2927] to-[#101010] p-6 lg:min-h-[480px]">
          <div
            className="absolute top-[13%] right-[15%] h-[420px] w-[420px] rounded-full bg-[#bc8e3e]/20 blur-2xl"
            aria-hidden="true"
          />
          <img
            src={heroAsset}
            alt="GrownLeaf Premium Car and Bike Flag Banner"
            className="relative z-1 max-h-[380px] w-auto max-w-full rounded-sm object-contain shadow-2xl drop-shadow-[0_20px_25px_rgba(0,0,0,0.6)]"
          />
        </div>
      </section>

      {/* Promotional Banners from Database if published (ZYV-107) */}
      {banners.length > 0 ? (
        <section
          aria-label="Promotional announcements"
          className="border-b border-rule bg-paper-sunk py-3 px-5 text-center sm:px-8"
        >
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-6 text-[12px]">
            {banners.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <span className="font-bold text-brass-deep uppercase">
                  {b.title}:
                </span>
                <span className="text-ink-soft">{b.subtitle}</span>
                {b.link_url ? (
                  <Link
                    to={b.link_url}
                    className="ml-1 font-semibold text-brass-deep underline hover:text-ink"
                  >
                    Explore →
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Ticker bar */}
      <div className="overflow-hidden bg-brass py-3">
        <ul className="flex justify-around gap-8 whitespace-nowrap">
          {TICKER.map((item) => (
            <li
              key={item}
              className="text-[9px] font-bold tracking-[0.18em] text-ground-deep uppercase"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Featured Collection Strip */}
      <section className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="font-display text-[clamp(2.25rem,5vw,3.75rem)]">
              Flags worth <em className="text-brass-deep italic">flying</em>
            </h2>
          </div>
          <Link
            to="/catalog"
            className="flex items-center gap-3 border-b border-brass-deep pb-2 text-[10px] font-bold tracking-[0.14em] uppercase transition-colors hover:text-brass-deep"
          >
            View all <span aria-hidden="true">→</span>
          </Link>
        </div>

        <ProductStrip onProductsLoaded={handleProductsLoaded} />
      </section>

      {/* Why Choose GrownLeaf Section (ZYV-112) */}
      <section className="border-y border-rule bg-paper-sunk py-20">
        <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
          <div className="max-w-[700px]">
            <p className="eyebrow">The GrownLeaf standard</p>
            <h2 className="font-display text-[clamp(2.25rem,5vw,3.75rem)]">
              Why choose <em className="text-brass-deep italic">GrownLeaf</em>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
              Most novelty flags disintegrate after a single highway journey. We
              re-engineered vehicle flags from thread to clip.
            </p>
          </div>

          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {WHY_CHOOSE_ITEMS.map((item) => (
              <div
                key={item.title}
                className="border border-rule bg-paper p-6 transition-all hover:border-brass/40"
              >
                <span className="text-[28px]" aria-hidden="true">
                  {item.icon}
                </span>
                <h3 className="mt-4 font-display text-[18px] font-semibold">
                  {item.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Customer Reviews — Rendered ONLY when genuine approved reviews exist (ZYV-108) */}
      {ratedProducts.length > 0 ? (
        <section
          aria-labelledby="genuine-reviews-heading"
          className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8"
        >
          <div className="max-w-[650px]">
            <p className="eyebrow">Verified Customers</p>
            <h2
              id="genuine-reviews-heading"
              className="font-display text-[clamp(2.25rem,5vw,3.75rem)]"
            >
              Genuine <em className="text-brass-deep italic">Reviews</em>
            </h2>
            <p className="mt-3 text-[14px] text-ink-soft">
              Real feedback from verified purchasers. No fabricated ratings or
              fictitious quotes.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ratedProducts.map((p) => (
              <div
                key={p.id}
                className="border border-rule bg-paper p-6 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded bg-brass/20 px-2.5 py-1 text-[11px] font-bold text-ground-deep">
                    {p.rating?.average} ★
                  </span>
                  <span className="text-[11px] text-ink-muted">
                    {p.rating?.count} verified{' '}
                    {p.rating?.count === 1 ? 'review' : 'reviews'}
                  </span>
                </div>
                <h3 className="mt-4 font-display text-[16px] font-semibold text-ink">
                  {p.name}
                </h3>
                <Link
                  to={`/products/${p.id}`}
                  className="mt-4 inline-block text-[11px] font-bold tracking-[0.12em] text-brass-deep uppercase hover:underline"
                >
                  View Product Details →
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Our Craft section */}
      <section className="grid bg-paper-sunk lg:grid-cols-2">
        <div
          className="min-h-[320px] bg-gradient-to-br from-[#3a3733] to-[#1a1918] lg:min-h-[460px]"
          aria-hidden="true"
        />
        <div className="flex flex-col items-start justify-center px-6 py-16 sm:px-10 lg:px-[clamp(2.5rem,8vw,7rem)]">
          <p className="eyebrow">Our craft</p>
          <h2 className="font-display text-[clamp(2.25rem,5vw,3.75rem)]">
            Cut for the <em className="text-brass-deep italic">wind</em>
          </h2>
          <p className="mt-7 max-w-[46ch] text-[14px] leading-[1.8] text-ink-soft">
            Every flag is cut from UV-stabilised polyester and finished with
            double-stitched hems along the fly edge — the part that frays first.
            Aluminium clips are tested to 120 km/h on our own road, not a
            laboratory rig.
          </p>
          <ul className="mt-7 grid gap-3 text-[13px] text-ink-soft">
            {[
              'Triple-stitched fly edge',
              'UV-stable, fade-resistant dyes',
              'Aluminium clips, rust-proof',
              'Cold-wash, no shrinkage',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span aria-hidden="true" className="text-brass-deep">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
          <ButtonLink to="/about" variant="outline" size="md" className="mt-9">
            Read our story
          </ButtonLink>
        </div>
      </section>

      {/* FAQ Preview Section (ZYV-112, ZYV-102) */}
      <section className="mx-auto max-w-[1000px] px-5 py-20 sm:px-8">
        <div className="text-center">
          <p className="eyebrow">Got questions?</p>
          <h2 className="font-display text-[clamp(2.25rem,5vw,3.5rem)]">
            Frequently Asked Questions
          </h2>
          <p className="mx-auto mt-3 max-w-[500px] text-[14px] text-ink-soft">
            Answers to common questions regarding vehicle fitment, highway
            durability, and flag care.
          </p>
        </div>

        <div className="mt-12 divide-y divide-rule border-y border-rule">
          {PREVIEW_FAQS.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div key={faq.q} className="py-5">
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 text-left font-display text-[17px] font-semibold text-ink transition-colors hover:text-brass-deep"
                >
                  <span>{faq.q}</span>
                  <span
                    className="text-[18px] text-brass-deep"
                    aria-hidden="true"
                  >
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen ? (
                  <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
                    {faq.a}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-center">
          <ButtonLink to="/faq" variant="outline" size="md">
            View all frequently asked questions →
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
