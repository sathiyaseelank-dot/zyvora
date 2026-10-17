import { Link } from 'react-router-dom';

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
    heading: 'Account',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Create account', to: '/register' },
      { label: 'Your orders', to: '/account' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Our craft', to: '/about' },
      { label: 'Shipping', to: '/shipping' },
      { label: 'Returns', to: '/returns' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-rule bg-paper">
      <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8">
        <div className="flex flex-wrap gap-12">
          <div className="max-w-[260px]">
            <p className="font-display text-[20px] font-bold tracking-[0.17em]">
              ZYVORA
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

        <div className="mt-12 flex flex-wrap justify-between gap-3 border-t border-rule pt-6 text-[11px] text-ink-muted">
          <p>© {new Date().getFullYear()} ZYVORA. All rights reserved.</p>
          <p>Made in India</p>
        </div>
      </div>
    </footer>
  );
}
