import { Link } from 'react-router-dom';

/**
 * Site footer (ZYV-100, ZYV-111, ZYV-114, ZYV-115, ZYV-117, ZYV-118, ZYV-119).
 *
 * Provides organized navigation, official policy links, customer support
 * resources, and transparent placeholder business disclosures.
 */

const COLUMNS = [
  {
    heading: 'Shop',
    links: [
      { label: 'All Flags', to: '/catalog' },
      { label: 'Car Flags', to: '/catalog?category=car' },
      { label: 'Bike Flags', to: '/catalog?category=bike' },
    ],
  },
  {
    heading: 'Customer Support',
    links: [
      { label: 'FAQ', to: '/faq' },
      { label: 'Contact Us', to: '/contact' },
      { label: 'Your Orders', to: '/account' },
      { label: 'About Us', to: '/about' },
    ],
  },
  {
    heading: 'Policies',
    links: [
      { label: 'Shipping Policy', to: '/shipping-policy' },
      { label: 'Cancellation Policy', to: '/cancellation-policy' },
      { label: 'Return & Refund Policy', to: '/return-refund-policy' },
      { label: 'Privacy Policy', to: '/privacy-policy' },
      { label: 'Terms & Conditions', to: '/terms' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-rule bg-paper">
      <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8">
        <div className="flex flex-wrap gap-12">
          <div className="max-w-[280px]">
            <Link to="/" className="inline-block">
              <span className="font-display text-[22px] font-bold tracking-[0.17em]">
                ZYVORA
                <sup className="ml-0.5 align-super text-[8px] font-bold tracking-normal text-brass-deep">
                  ®
                </sup>
              </span>
            </Link>
            <p className="mt-1 text-[10px] font-bold tracking-[0.14em] text-brass-deep uppercase">
              Quality | Style | For Your World
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
              Premium car and bike flags, cut and finished by hand. Built for
              wind, weather and the road.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="mb-3 text-[10px] font-bold tracking-[0.14em] text-ink uppercase">
                {column.heading}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-[12px] text-ink-muted transition-colors hover:text-brass-deep"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Business Transparency Disclosure (ZYV-117) */}
        <div className="mt-12 border-t border-rule pt-6 text-[11px] leading-relaxed text-ink-muted">
          <p className="font-medium">
            Business Details &amp; Transparency:
            <span className="ml-1 text-ink-soft">
              Chennai, Tamil Nadu, India • [GSTIN: Pending State Tax
              Registration] • [CIN: Pending Ministry of Corporate Affairs
              Filing] • [Support Phone: Pending Official Helpline Setup] •
              support@zyvora.com
            </span>
          </p>
        </div>

        <div className="mt-4 flex flex-wrap justify-between gap-3 border-t border-rule/50 pt-4 text-[11px] text-ink-muted">
          <p>© {new Date().getFullYear()} ZYVORA. All rights reserved.</p>
          <p>Made in India</p>
        </div>
      </div>
    </footer>
  );
}
