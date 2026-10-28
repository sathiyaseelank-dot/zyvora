import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchContentBlock, type ContentBlock } from '../lib/api';

interface PolicyPageProps {
  slug: string;
  defaultTitle?: string;
  defaultContent?: string;
  onTitle?: (title: string) => void;
}

const DEFAULT_TITLES: Record<string, string> = {
  'shipping-policy': 'Shipping Policy',
  'cancellation-policy': 'Cancellation Policy',
  'return-refund-policy': 'Return & Refund Policy',
  'privacy-policy': 'Privacy Policy',
  'terms-and-conditions': 'Terms and Conditions',
};

const DEFAULT_CONTENT: Record<string, string> = {
  'shipping-policy': `1. Shipping Rates & Delivery Time
- We offer free standard delivery across India on orders above ₹2,000.
- For orders below ₹2,000, a standard delivery charge of ₹150 applies.
- Dispatched within 24–48 hours from our Chennai facility via insured express courier services.
- Estimated delivery timeframe is typically 3–7 business days depending on customer delivery pincode.

2. Tracking Your Order
Once your package is collected by our logistics partner, real-time tracking details will be accessible directly within your Customer Account dashboard under 'My Orders'.

3. Packaging & Inspection
Every ZYVORA automotive flag and aluminium mounting assembly is hand-inspected and sealed in tamper-evident protective transit packaging.`,

  'cancellation-policy': `1. Cancellation Before Dispatch
Orders can be cancelled directly through your account dashboard at any point while in 'Pending', 'Confirmed', or 'Processing' status prior to dispatch. A 100% full refund will be processed to the original payment source.

2. Orders in Transit
Once an order has been marked as 'Shipped' or 'Out for Delivery', cancellation is no longer possible through the dashboard. You may refuse delivery upon arrival or initiate an exchange/return under our 7-day Return Policy.

3. Seller Cancellation
ZYVORA reserves the right to cancel an order due to unforeseen stock unavailability or delivery pin code serviceability issues, with prompt customer notification and a full refund.`,

  'return-refund-policy': `1. 7-Day Return Window
We provide a 7-day return guarantee from the date of confirmed delivery. If you are unsatisfied with the fitment, material, or quality of your vehicle flag, you may initiate a return from your account dashboard.

2. Eligibility Conditions
- Item must be unused, unwashed, and in its original packaging with all mounting hardware, rubberised clips, and tags intact.
- Items damaged due to improper installation or non-automotive modification are not eligible for return.

3. Refund Process & Timelines
Upon safe return and inspection at our facility, refunds are approved within 48 business hours and credited to your original payment method within 5–7 banking days.`,

  'privacy-policy': `1. Data Collection and Purpose
ZYVORA collects customer contact details (name, email address, mobile number) and delivery addresses strictly for order fulfillment, account authentication, and shipment tracking updates.

2. Security of Customer Information
- We never store payment credentials, card numbers, or UPI PINs on our servers.
- Passwords are encrypted using modern cryptographic hashing algorithms (Argon2id/bcrypt).
- Authentication sessions use secure, HTTP-only cookie headers protected against cross-site scripting.

3. Sharing with Third Parties
Customer delivery details are shared exclusively with certified courier partners for logistics fulfillment. We do not sell, rent, or trade your personal information to third-party advertisers.`,

  'terms-and-conditions': `1. Introduction & Acceptance
Welcome to ZYVORA ("Quality | Style | For Your World"). By browsing this website, creating an account, or placing an order, you agree to comply with and be bound by these Terms and Conditions.

2. Product Specifications & Vehicle Fitment
Our vehicle flags and mounting accessories are designed for automotive use as specified on product listings. Customers are responsible for verifying vehicle compatibility and following mounting instructions before highway operation.

3. Pricing & Governing Law
All prices are displayed in Indian Rupees (₹ INR) inclusive of applicable taxes. These terms shall be governed by and construed in accordance with the laws of India. Any disputes arising shall be subject to the exclusive jurisdiction of the courts in Chennai, Tamil Nadu.`,
};

export function PolicyPage({
  slug,
  defaultTitle,
  defaultContent,
  onTitle,
}: PolicyPageProps) {
  const [block, setBlock] = useState<ContentBlock | null>(null);
  const location = useLocation();

  const title =
    block?.title ?? defaultTitle ?? DEFAULT_TITLES[slug] ?? 'Policy';
  const content =
    block?.body ??
    defaultContent ??
    DEFAULT_CONTENT[slug] ??
    'Policy details will be updated shortly.';

  useEffect(() => {
    let active = true;

    if (onTitle) {
      onTitle(`${title} — GrownLeaf`);
    }

    fetchContentBlock(slug)
      .then((data) => {
        if (!active) return;
        setBlock(data);
      })
      .catch(() => {
        // Fallback to default content smoothly without showing an error block
      });

    return () => {
      active = false;
    };
  }, [slug, title, onTitle, location.pathname]);

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
          <li>
            <span className="text-ink-muted">Policies</span>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink font-medium">
            {title}
          </li>
        </ol>
      </nav>

      {/* Header */}
      <div className="mb-8 border-b border-slate-200 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              {title}
            </h1>
            <p className="mt-2 text-xs text-slate-500">
              Last revised: February 2027 • Governed by GrownLeaf customer
              protection standards
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Official Policy
          </span>
        </div>
      </div>

      <div className="space-y-6 leading-relaxed">
        {/* Main Content Body */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs whitespace-pre-line text-sm sm:text-[15px] leading-relaxed text-slate-700">
          {content}
        </div>

        {/* Honest placeholder notice per ZYV-117 */}
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 shadow-xs text-xs text-slate-600 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm" aria-hidden="true">
              🛡️
            </span>
            <p className="font-bold text-slate-900 text-xs">
              Business Transparency Notice
            </p>
          </div>
          <p className="leading-relaxed">
            Corporate registration details: [CIN: Pending Official Filing] •
            GSTIN: [GSTIN: Pending State Tax Registration] • Location: Chennai,
            Tamil Nadu, India. For all formal legal notices or inquiries,
            contact support@zyvora.com.
          </p>
        </div>

        {/* Related Policy Links */}
        <div className="pt-8 border-t border-slate-200">
          <h2 className="font-display text-lg font-bold text-slate-900 mb-4">
            Related Policies &amp; Help
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              to="/shipping-policy"
              className="p-4 rounded-xl border border-slate-200 bg-white hover:border-brass hover:shadow-sm transition-all block text-sm"
            >
              <p className="font-semibold text-slate-900">Shipping Policy</p>
              <p className="text-xs text-slate-500 mt-1">
                Delivery timelines &amp; rates
              </p>
            </Link>
            <Link
              to="/cancellation-policy"
              className="p-4 rounded-xl border border-slate-200 bg-white hover:border-brass hover:shadow-sm transition-all block text-sm"
            >
              <p className="font-semibold text-slate-900">
                Cancellation Policy
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Cancellation rules &amp; deadlines
              </p>
            </Link>
            <Link
              to="/return-refund-policy"
              className="p-4 rounded-xl border border-slate-200 bg-white hover:border-brass hover:shadow-sm transition-all block text-sm"
            >
              <p className="font-semibold text-slate-900">
                Return &amp; Refund Policy
              </p>
              <p className="text-xs text-slate-500 mt-1">
                7-day return guarantee
              </p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
