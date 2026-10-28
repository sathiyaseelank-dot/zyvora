import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { ButtonLink } from '../components/Button';

/**
 * 404.
 *
 * Takes its title through a callback so the document title can be set from the
 * one place that owns it, rather than each page reaching for `document.title`.
 */
export function NotFoundPage({ onTitle }: { onTitle: (t: string) => void }) {
  useEffect(() => {
    onTitle('Page not found — GrownLeaf');
  }, [onTitle]);

  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 text-center sm:py-32">
      <p className="eyebrow eyebrow--centred">Error 404</p>
      <h1 className="font-display text-[clamp(2.5rem,6vw,4rem)]">
        This flag is <em className="text-brass-deep italic">not</em> in our
        range
      </h1>
      <p className="mx-auto mt-5 max-w-[44ch] text-[14px] leading-relaxed text-ink-soft">
        The page you are looking for has moved or never existed. The collection
        is still where you left it.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <ButtonLink to="/catalog" variant="brass" size="lg">
          Browse flags
        </ButtonLink>
        <Link
          to="/"
          className="self-center border-b border-brass-deep pb-1 text-[10px] font-bold tracking-[0.13em] uppercase transition-colors hover:text-brass-deep"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
