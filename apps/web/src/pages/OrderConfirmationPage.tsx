import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { fetchOrder, type Order } from '../lib/api';
import { ButtonLink } from '../components/Button';

function rupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function OrderConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!id) return;
      try {
        setLoading(true);
        const data = await fetchOrder(id);
        if (active) setOrder(data);
      } catch (err: any) {
        if (active)
          setError(err.message ?? 'Failed to load order confirmation');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[700px] px-5 py-20 text-center text-ink-muted">
        Loading your order confirmation...
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mx-auto max-w-[600px] px-5 py-20 text-center space-y-4">
        <h1 className="font-display text-2xl text-ink">Order Not Found</h1>
        <p className="text-sm text-ink-muted">
          {error ?? 'Could not find the requested order details.'}
        </p>
        <ButtonLink to="/catalog" variant="brass">
          Continue Shopping
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[800px] px-5 py-16 sm:py-20">
      {/* Success banner */}
      <div className="mb-10 text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 mb-2">
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <p className="eyebrow">Thank You for Your Order</p>
        <h1 className="font-display text-3xl sm:text-4xl text-ink">
          Order Confirmed
        </h1>
        <p className="text-sm text-ink-muted">
          Order Reference:{' '}
          <span className="font-mono text-ink font-semibold">{order.id}</span>
        </p>
      </div>

      <div className="border border-rule rounded divide-y divide-rule bg-surface-sunken/20">
        {/* Status bar */}
        <div className="p-6 flex flex-wrap justify-between items-center gap-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-ink-muted block">
              Order Status
            </span>
            <span className="inline-block mt-1 px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded bg-amber-100 text-amber-800">
              {order.status}
            </span>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-ink-muted block">
              Payment Status
            </span>
            <span className="inline-block mt-1 px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded bg-emerald-100 text-emerald-800">
              {order.payment?.status ?? 'Pending'}
            </span>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wider text-ink-muted block">
              Estimated Delivery
            </span>
            <span className="text-sm font-medium text-ink mt-1 block">
              3–5 Business Days
            </span>
          </div>
        </div>

        {/* Purchased Items */}
        <div className="p-6 space-y-4">
          <h2 className="font-display text-lg text-ink">Purchased Products</h2>
          <div className="divide-y divide-rule">
            {order.items?.map((item) => (
              <div
                key={item.id}
                className="py-3 flex justify-between items-center text-sm"
              >
                <div>
                  <p className="font-medium text-ink">{item.name}</p>
                  <p className="text-xs text-ink-muted">
                    Qty: {item.quantity} × {rupees(item.unit_price)}
                  </p>
                </div>
                <p className="font-semibold text-ink">
                  {rupees(item.unit_price * item.quantity)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Delivery Address & Pricing summary */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-ink-muted mb-2 font-semibold">
              Delivery Address
            </h3>
            {order.shippingAddress ? (
              <div className="text-sm text-ink space-y-1">
                <p className="font-semibold">
                  {order.shippingAddress.fullName}
                </p>
                <p className="text-ink-muted">
                  {order.shippingAddress.houseNumberAndStreet},{' '}
                  {order.shippingAddress.area}
                </p>
                <p className="text-ink-muted">
                  {order.shippingAddress.city}, {order.shippingAddress.state} —{' '}
                  {order.shippingAddress.pinCode}
                </p>
                <p className="text-xs text-ink-muted pt-1">
                  Contact: {order.shippingAddress.mobile}
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Delivery details attached to account.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider text-ink-muted mb-2 font-semibold">
              Payment Summary
            </h3>
            <div className="text-sm space-y-1.5 divide-y divide-rule/50">
              <div className="flex justify-between text-ink-muted pt-1">
                <span>Subtotal</span>
                <span>{rupees(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-ink-muted pt-1">
                <span>Shipping</span>
                <span>
                  {order.shipping === 0 ? 'FREE' : rupees(order.shipping)}
                </span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-emerald-600 pt-1">
                  <span>Discount</span>
                  <span>- {rupees(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base text-ink pt-2">
                <span>Total Paid</span>
                <span>{rupees(order.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation CTAs (ZYV-82) */}
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <ButtonLink to="/catalog" variant="outline" size="lg">
          Continue Shopping
        </ButtonLink>
        <ButtonLink to="/account" variant="brass" size="lg">
          View My Orders
        </ButtonLink>
      </div>
    </div>
  );
}
