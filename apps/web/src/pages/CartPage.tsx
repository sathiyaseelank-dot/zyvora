import { Link } from 'react-router-dom';

import { ButtonLink } from '../components/Button';

/**
 * Cart placeholder.
 *
 * The cart is E5 (ZYV-42 … ZYV-55) and none of it exists yet. The header
 * already carries a cart control, and it used to link here — straight into a
 * 404, from the most-used control on every page. That is worse than shipping
 * no cart at all: it looks like a working storefront that has broken.
 *
 * So the route exists and says plainly what is missing. The alternative —
 * hiding the control until E5 lands — was rejected because the cart is part
 * of the store's shape, and a storefront without it reads as unfinished in a
 * different way.
 */
export function CartPage() {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 text-center sm:py-32">
      <p className="eyebrow eyebrow--centred">Your cart</p>
      <h1 className="font-display text-[clamp(2.25rem,5vw,3.5rem)]">
        The cart is <em className="text-brass-deep italic">nearly</em> here
      </h1>

      <p className="mx-auto mt-6 max-w-[46ch] text-[14px] leading-relaxed text-ink-soft">
        Guest carts and persistence arrive with the commerce epics. We would
        rather tell you that than show you an empty basket that pretends to be
        working.
      </p>

      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <ButtonLink to="/catalog" variant="brass" size="lg">
          Browse flags
        </ButtonLink>
        <Link
          to="/login"
          className="self-center border-b border-brass-deep pb-1 text-[10px] font-bold tracking-[0.13em] uppercase transition-colors hover:text-brass-deep"
        >
          Sign in to your account
        </Link>
      </div>
    </div>
  );
}
