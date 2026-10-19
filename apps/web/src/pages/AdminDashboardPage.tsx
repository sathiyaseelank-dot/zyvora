import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useSession } from '../lib/session';
import { request } from '../lib/api';

interface SalesSummary {
  period: string;
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
}

interface AdminProduct {
  id: string;
  name: string;
  description: string;
  categoryName: string;
  price: number;
  compareAtPrice: number | null;
  image: string;
  isActive: boolean;
  stock: number;
}

interface AdminOrder {
  id: string;
  userId: string;
  customerEmail: string;
  customerName: string;
  total: number;
  status: string;
  createdAt: string;
}

interface AdminRefund {
  id: string;
  paymentId: string;
  orderId: string;
  amount: number;
  reason: string;
  status: string;
  createdAt: string;
}

interface AdminAuditEntry {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export function AdminDashboardPage({ onTitle }: { onTitle?: (t: string) => void }) {
  const { user } = useSession();
  const [tab, setTab] = useState<'overview' | 'products' | 'orders' | 'refunds' | 'audit'>('overview');

  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [refunds, setRefunds] = useState<AdminRefund[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onTitle?.('Admin Console — ZYVORA');
  }, [onTitle]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function loadData() {
      try {
        if (tab === 'overview') {
          const res = await request<{ data: SalesSummary }>('/api/admin/reports/summary');
          if (active) setSummary(res.data);
        } else if (tab === 'products') {
          const res = await request<{ data: AdminProduct[] }>('/api/admin/products?limit=50');
          if (active) setProducts(res.data);
        } else if (tab === 'orders') {
          const res = await request<{ data: AdminOrder[] }>('/api/admin/orders?limit=50');
          if (active) setOrders(res.data);
        } else if (tab === 'refunds') {
          const res = await request<{ data: AdminRefund[] }>('/api/admin/refunds');
          if (active) setRefunds(res.data);
        } else if (tab === 'audit') {
          const res = await request<{ data: AdminAuditEntry[] }>('/api/admin/audit-log?limit=50');
          if (active) setAuditLogs(res.data);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load administration data');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [tab]);

  async function handleStatusTransition(orderId: string, nextStatus: string) {
    try {
      await request(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)),
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Transition failed');
    }
  }

  async function handleRefundStatus(refundId: string, nextStatus: 'approved' | 'rejected') {
    try {
      await request(`/api/admin/refunds/${refundId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setRefunds((prev) =>
        prev.map((r) => (r.id === refundId ? { ...r, status: nextStatus } : r)),
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Refund update failed');
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-12">
      <header className="mb-8 flex flex-col justify-between gap-4 border-b border-rule pb-6 sm:flex-row sm:items-center">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="font-display text-[32px] sm:text-[40px]">Control Console</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="rounded-full bg-brass-deep/10 px-3 py-1 text-[11px] font-semibold text-brass-deep uppercase">
            {user?.role} — {user?.email}
          </span>
          <Link
            to="/catalog"
            className="text-[12px] font-medium text-ink-muted hover:text-brass-deep"
          >
            Storefront
          </Link>
        </div>
      </header>

      {/* Tabs */}
      <nav aria-label="Admin Sections" className="mb-8 flex gap-2 border-b border-rule">
        {[
          { key: 'overview', label: 'Overview & Reports' },
          { key: 'products', label: 'Products' },
          { key: 'orders', label: 'Orders' },
          { key: 'refunds', label: 'Refund Requests' },
          { key: 'audit', label: 'Audit Log' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as typeof tab)}
            className={`border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === t.key
                ? 'border-brass-deep text-brass-deep font-semibold'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div role="alert" className="mb-6 rounded-lg bg-red-50 p-4 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div role="status" className="py-20 text-center text-ink-muted">
          Loading console data…
        </div>
      ) : (
        <div>
          {tab === 'overview' && summary && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                <div className="rounded-xl border border-rule bg-paper p-6">
                  <p className="text-[11px] font-semibold text-ink-muted uppercase">Total Revenue</p>
                  <p className="mt-2 font-display text-[32px]">₹{summary.totalRevenue.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-rule bg-paper p-6">
                  <p className="text-[11px] font-semibold text-ink-muted uppercase">Total Orders</p>
                  <p className="mt-2 font-display text-[32px]">{summary.totalOrders}</p>
                </div>
                <div className="rounded-xl border border-rule bg-paper p-6">
                  <p className="text-[11px] font-semibold text-ink-muted uppercase">Average Order Value</p>
                  <p className="mt-2 font-display text-[32px]">₹{summary.averageOrderValue.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex gap-4">
                <a
                  href="/api/admin/reports/summary?format=csv"
                  download
                  className="rounded bg-brass-deep px-4 py-2 text-[12px] font-semibold text-paper hover:bg-brass-deep/90"
                >
                  Export Sales Report (CSV)
                </a>
                <a
                  href="/api/admin/reports/low-stock?format=csv"
                  download
                  className="rounded border border-rule px-4 py-2 text-[12px] font-semibold text-ink hover:bg-paper-sunk"
                >
                  Export Low Stock (CSV)
                </a>
              </div>
            </div>
          )}

          {tab === 'products' && (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                  <tr>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-paper-sunk/50">
                      <td className="px-4 py-3.5 font-medium">{p.name}</td>
                      <td className="px-4 py-3.5 text-ink-muted">{p.categoryName}</td>
                      <td className="px-4 py-3.5">₹{p.price}</td>
                      <td className="px-4 py-3.5">{p.stock}</td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            p.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {p.isActive ? 'Active' : 'Archived'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'orders' && (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                  <tr>
                    <th className="px-4 py-3">Order ID</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Transition Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-paper-sunk/50">
                      <td className="px-4 py-3.5 font-mono text-[12px]">{o.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3.5">{o.customerEmail}</td>
                      <td className="px-4 py-3.5 font-medium">₹{o.total}</td>
                      <td className="px-4 py-3.5 capitalize">{o.status}</td>
                      <td className="px-4 py-3.5">
                        {o.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleStatusTransition(o.id, 'confirmed')}
                            className="rounded bg-brass-deep px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Confirm Order
                          </button>
                        )}
                        {o.status === 'confirmed' && (
                          <button
                            type="button"
                            onClick={() => handleStatusTransition(o.id, 'processing')}
                            className="rounded bg-brass-deep px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Process
                          </button>
                        )}
                        {o.status === 'processing' && (
                          <button
                            type="button"
                            onClick={() => handleStatusTransition(o.id, 'shipped')}
                            className="rounded bg-brass-deep px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Mark Shipped
                          </button>
                        )}
                        {o.status === 'shipped' && (
                          <button
                            type="button"
                            onClick={() => handleStatusTransition(o.id, 'delivered')}
                            className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-paper"
                          >
                            Mark Delivered
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'refunds' && (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                  <tr>
                    <th className="px-4 py-3">Refund ID</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {refunds.map((r) => (
                    <tr key={r.id} className="hover:bg-paper-sunk/50">
                      <td className="px-4 py-3.5 font-mono text-[12px]">{r.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3.5 font-medium">₹{r.amount}</td>
                      <td className="px-4 py-3.5 text-ink-muted">{r.reason}</td>
                      <td className="px-4 py-3.5 capitalize">{r.status}</td>
                      <td className="px-4 py-3.5">
                        {r.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleRefundStatus(r.id, 'approved')}
                              className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-paper"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRefundStatus(r.id, 'rejected')}
                              className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-paper"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'audit' && (
            <div className="overflow-x-auto rounded-xl border border-rule">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-rule bg-paper-sunk text-[11px] text-ink-muted uppercase">
                  <tr>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Entity Type</th>
                    <th className="px-4 py-3">Entity ID</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {auditLogs.map((a) => (
                    <tr key={a.id} className="hover:bg-paper-sunk/50">
                      <td className="px-4 py-3.5 font-mono text-[12px]">{a.action}</td>
                      <td className="px-4 py-3.5">{a.entityType}</td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-ink-muted">
                        {a.entityId ? `${a.entityId.slice(0, 8)}…` : '—'}
                      </td>
                      <td className="px-4 py-3.5 text-ink-muted">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
