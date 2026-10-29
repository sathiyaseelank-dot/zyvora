import { Link } from 'react-router-dom';

import { ButtonLink } from '../components/Button';

/**
 * Craft — the "Our craft" destination.
 *
 * Static content only; nothing here needs the API. It exists because the
 * header and the footer both linked to `/about`, and that route was rendering
 * the product catalog under the label "Craft".
 *
 * The copy is the brand story from the design reference, written out rather
 * than imported — the reference is a visual reference, not a content source.
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

export function CraftPage() {
  return (
    <>
      <section className="mx-auto max-w-[1400px] px-5 py-16 sm:px-8 sm:py-24">
        <h1 className="max-w-[18ch] font-display text-[clamp(2.5rem,6vw,4.25rem)] leading-[0.98]">
          Made for the road, <em className="text-brass-deep italic">not</em> the
          shelf
        </h1>
        <p className="mt-7 max-w-[52ch] text-[15px] leading-[1.75] text-ink-soft">
          A flag spends its life in the wind at the edge of a car, held on by a
          clip, in rain and sun. Everything here follows from that. We do not
          make much else, so we make this properly.
        </p>
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
            to="/shipping"
            className="self-center border-b border-brass-deep pb-1 text-[10px] font-bold tracking-[0.13em] uppercase transition-colors hover:text-brass-deep"
          >
            Shipping &amp; returns
          </Link>
        </div>
      </section>
    </>
  );
}
