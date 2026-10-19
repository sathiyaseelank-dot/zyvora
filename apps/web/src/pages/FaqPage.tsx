import { useState } from 'react';
import { Link } from 'react-router-dom';

interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
}

const FAQ_DATA: FaqItem[] = [
  {
    id: 'ship-1',
    category: 'Shipping & Delivery',
    question: 'How long does delivery take across India?',
    answer:
      'Orders are processed and dispatched within 24–48 hours. Standard courier transit time is typically 3–5 business days to most metro cities and urban centres via BlueDart and partner express logistics.',
  },
  {
    id: 'ship-2',
    category: 'Shipping & Delivery',
    question: 'What are the shipping charges and thresholds?',
    answer:
      'We offer complimentary Free Shipping on all orders of ₹2,000 and above. For orders below ₹2,000, a transparent flat-rate shipping fee of ₹150 is applied at checkout.',
  },
  {
    id: 'craft-1',
    category: 'Craft & Durability',
    question: 'How are ZYVORA flags tested for high-speed wind resistance?',
    answer:
      'Every flag design undergoes rigorous road testing at speeds up to 120 km/h. We use high-tensile UV-stabilised automotive polyester and triple-stitch the outer fly edge to prevent fraying and wind shear failure.',
  },
  {
    id: 'craft-2',
    category: 'Craft & Durability',
    question: 'Are the mounting clips and hardware rust-proof?',
    answer:
      'Yes. Our clips are fabricated from anodized aluminium and stainless hardware, engineered specifically to resist monsoon moisture, road grime, and salt corrosion.',
  },
  {
    id: 'compat-1',
    category: 'Vehicle Compatibility',
    question: 'Will these flags fit my specific car or motorcycle?',
    answer:
      'Our car flags feature universal window-clip mounts that securely attach to standard roll-up side windows without scratching glass or damaging tint films. Bike flags include durable handlebar/mirror bracket attachments.',
  },
  {
    id: 'order-1',
    category: 'Orders & Cancellation',
    question: 'Can I cancel an order after placing it?',
    answer:
      'Yes, per our Cancellation Policy, orders can be cancelled immediately from your Customer Account dashboard while in Pending, Confirmed, or Processing status prior to dispatch. Once an order is shipped or out for delivery, it cannot be cancelled.',
  },
  {
    id: 'return-1',
    category: 'Returns & Refunds',
    question: 'What is your return policy?',
    answer:
      'We stand behind our craftsmanship with a 7-day return guarantee. Delivered items may be returned within 7 days of delivery in unused, original condition with all tags and hardware intact.',
  },
  {
    id: 'pay-1',
    category: 'Payment Methods',
    question: 'What payment options are supported?',
    answer:
      'We offer standard checkout with immediate order reservation. Online Razorpay payment gateway integration is currently undergoing scheduled platform upgrades.',
  },
];

const CATEGORIES = [
  'All',
  'Shipping & Delivery',
  'Craft & Durability',
  'Vehicle Compatibility',
  'Orders & Cancellation',
  'Returns & Refunds',
  'Payment Methods',
];

export function FaqPage() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(
    new Set(['ship-1', 'craft-1']),
  );

  const toggleItem = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredFaqs = FAQ_DATA.filter((faq) => {
    const matchesCategory =
      selectedCategory === 'All' || faq.category === selectedCategory;
    const matchesQuery =
      searchQuery.trim() === '' ||
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="mx-auto max-w-[900px] px-5 py-12 sm:py-16">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-6 text-xs text-ink-muted">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/" className="hover:text-brass transition-colors">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink font-medium">
            Frequently Asked Questions
          </li>
        </ol>
      </nav>

      {/* Header */}
      <div className="mb-10 text-center space-y-3">
        <p className="eyebrow">Customer Support &amp; Knowledge Base</p>
        <h1 className="font-display text-3xl sm:text-4xl text-ink">
          Frequently Asked Questions
        </h1>
        <p className="text-sm text-ink-muted max-w-[50ch] mx-auto">
          Everything you need to know about our automotive flags, road testing,
          delivery, and policies.
        </p>
      </div>

      {/* Search Input */}
      <div className="mb-8">
        <div className="relative max-w-[550px] mx-auto">
          <input
            type="search"
            placeholder="Search questions (e.g. shipping, wind speed, cancellation)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 pl-10 border border-rule rounded bg-surface text-sm focus:border-brass outline-none shadow-sm"
          />
          <span
            aria-hidden="true"
            className="absolute left-3.5 top-3.5 text-ink-muted text-sm"
          >
            ⌕
          </span>
        </div>
      </div>

      {/* Category Pills */}
      <div className="mb-10 flex flex-wrap justify-center gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`px-3.5 py-1.5 rounded text-xs font-mono tracking-wider uppercase transition-colors ${
              selectedCategory === cat
                ? 'bg-ink text-surface font-semibold'
                : 'bg-paper-sunk text-ink-muted hover:text-ink border border-rule'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* FAQ Accordion List */}
      <div className="space-y-4">
        {filteredFaqs.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-rule rounded">
            <p className="text-sm text-ink-muted">
              No matching questions found for &ldquo;{searchQuery}&rdquo;.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('All');
              }}
              className="mt-3 text-xs text-brass underline font-medium"
            >
              Clear filters
            </button>
          </div>
        ) : (
          filteredFaqs.map((faq) => {
            const isOpen = openIds.has(faq.id);
            return (
              <div
                key={faq.id}
                className="border border-rule rounded overflow-hidden bg-surface transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleItem(faq.id)}
                  aria-expanded={isOpen}
                  className="w-full px-5 py-4 text-left flex justify-between items-center gap-4 hover:bg-surface-sunken/30 transition-colors"
                >
                  <span className="font-semibold text-ink text-sm sm:text-base">
                    {faq.question}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-ink-muted text-lg font-mono leading-none transition-transform duration-200"
                    style={{
                      transform: isOpen ? 'rotate(45deg)' : 'rotate(0)',
                    }}
                  >
                    +
                  </span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pt-1 text-sm text-ink-soft border-t border-rule/40 leading-relaxed bg-surface-sunken/10">
                    <p>{faq.answer}</p>
                    <span className="inline-block mt-3 text-[10px] font-mono tracking-wider uppercase text-ink-muted">
                      Category: {faq.category}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Contact Prompt Footer CTA */}
      <div className="mt-14 p-8 border border-rule rounded bg-surface-sunken/30 text-center space-y-3">
        <h2 className="font-display text-xl text-ink">
          Still have a question?
        </h2>
        <p className="text-xs text-ink-muted max-w-[45ch] mx-auto">
          Can&apos;t find the answer you&apos;re looking for? Our customer care
          team is available to assist you.
        </p>
        <div className="pt-2">
          <Link
            to="/contact"
            className="inline-block px-5 py-2.5 rounded bg-brass text-ground-deep font-bold text-xs uppercase tracking-wider hover:bg-brass-light transition-colors"
          >
            Contact Customer Support
          </Link>
        </div>
      </div>
    </div>
  );
}
