import { useState } from 'react';

/**
 * Product image with a graceful failure state.
 *
 * Two seed URLs were returning 404, which rendered as a broken-image icon
 * beside the alt text — on a storefront, an empty frame reads as "no product
 * photography" rather than "this URL is wrong", and it is a dead end for the
 * shopper.
 *
 * So a failed load is a designed state, not an accident: a neutral placeholder
 * carrying the flag motif and the product name. It keeps the aspect ratio, so
 * a failure does not reflow the grid, and the alt text still reaches assistive
 * technology.
 */

interface ProductImageProps {
  src: string;
  alt: string;
  /** Applied by the parent on hover; must keep the same box. */
  className?: string;
  loading?: 'lazy' | 'eager';
}

export function ProductImage({
  src,
  alt,
  className = '',
  loading = 'lazy',
}: ProductImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-paper-sunk ${className}`}
      >
        {/* Three skewed bands — the same flag motif as the hero, in CSS. */}
        <div className="flex gap-1 opacity-25" aria-hidden="true">
          <span className="h-6 w-3 -skew-x-[12deg] bg-flag-yellow" />
          <span className="h-6 w-3 -skew-x-[12deg] bg-flag-red" />
          <span className="h-6 w-3 -skew-x-[12deg] bg-flag-cream" />
        </div>
        <span className="px-3 text-center text-[10px] leading-snug tracking-[0.08em] text-ink-muted uppercase">
          Image unavailable
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
