import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useSession } from '../lib/session';
import {
  fetchOrders,
  fetchAddresses,
  createAddress,
  deleteAddress,
  updateAddress,
  cancelOrder,
  requestReturn,
  updateProfile,
  changePassword,
  type Order,
  type Address,
  type AddressInput,
} from '../lib/api';
import { Button } from '../components/Button';

function rupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function AccountPage() {
  const { user, refresh, logout } = useSession();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<
    'orders' | 'addresses' | 'profile'
  >('orders');

  // Orders state (ZYV-88, ZYV-89, ZYV-87)
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState<string>('');

  // Addresses state (ZYV-74)
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [addressesError, setAddressesError] = useState<string | null>(null);
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [newAddr, setNewAddr] = useState<AddressInput>({
    fullName: '',
    mobile: '',
    email: user?.email ?? '',
    houseNumberAndStreet: '',
    area: '',
    landmark: '',
    city: '',
    state: '',
    pinCode: '',
    country: 'India',
    deliveryInstructions: '',
    isDefault: false,
  });

  // Profile state (ZYV-79)
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [mobile, setMobile] = useState('');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  // Password change state (ZYV-79)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  // Load orders
  useEffect(() => {
    if (activeTab === 'orders') {
      let active = true;
      setOrdersLoading(true);
      fetchOrders()
        .then((res) => {
          if (active) {
            const list = Array.isArray(res?.data)
              ? res.data
              : Array.isArray(res)
                ? res
                : [];
            setOrders(list);
          }
        })
        .catch((err) => {
          if (active) setOrdersError(err.message ?? 'Failed to load orders');
        })
        .finally(() => {
          if (active) setOrdersLoading(false);
        });
      return () => {
        active = false;
      };
    }
  }, [activeTab]);

  // Load addresses
  useEffect(() => {
    if (activeTab === 'addresses') {
      let active = true;
      setAddressesLoading(true);
      fetchAddresses()
        .then((addrs) => {
          if (active) setAddresses(addrs);
        })
        .catch((err) => {
          if (active)
            setAddressesError(err.message ?? 'Failed to load addresses');
        })
        .finally(() => {
          if (active) setAddressesLoading(false);
        });
      return () => {
        active = false;
      };
    }
  }, [activeTab]);

  // Handle Cancel Order (ZYV-89)
  const handleCancelOrder = async (orderId: string) => {
    try {
      setOrdersError(null);
      await cancelOrder(orderId, cancelReason || undefined);
      setCancellingId(null);
      setCancelReason('');
      // Reload orders
      const res = await fetchOrders();
      setOrders(res.data);
    } catch (err: any) {
      setOrdersError(err.message ?? 'Failed to cancel order');
    }
  };

  // Handle Return Request (ZYV-87)
  const handleReturnRequest = async (orderId: string) => {
    if (!returnReason.trim()) {
      setOrdersError('Please provide a reason for the return');
      return;
    }
    try {
      setOrdersError(null);
      await requestReturn(orderId, returnReason);
      setReturningId(null);
      setReturnReason('');
      // Reload orders
      const res = await fetchOrders();
      setOrders(res.data);
    } catch (err: any) {
      setOrdersError(err.message ?? 'Failed to request return');
    }
  };

  // Handle Add Address (ZYV-74)
  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddressesError(null);
    try {
      const created = await createAddress(newAddr);
      setAddresses((prev) => [...prev, created]);
      setShowAddAddress(false);
      setNewAddr({
        fullName: '',
        mobile: '',
        email: user?.email ?? '',
        houseNumberAndStreet: '',
        area: '',
        landmark: '',
        city: '',
        state: '',
        pinCode: '',
        country: 'India',
        deliveryInstructions: '',
        isDefault: false,
      });
    } catch (err: any) {
      setAddressesError(err.message ?? 'Failed to add address');
    }
  };

  // Handle Delete Address
  const handleDeleteAddress = async (id: string) => {
    try {
      await deleteAddress(id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setAddressesError(err.message ?? 'Failed to delete address');
    }
  };

  // Handle Set Default Address
  const handleSetDefaultAddress = async (id: string) => {
    try {
      await updateAddress(id, { isDefault: true });
      const addrs = await fetchAddresses();
      setAddresses(addrs);
    } catch (err: any) {
      setAddressesError(err.message ?? 'Failed to set default address');
    }
  };

  // Handle Profile Update (ZYV-79)
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);
    setProfileError(null);
    setProfileBusy(true);
    try {
      await updateProfile({
        fullName: fullName.trim() || undefined,
        mobile: mobile.trim() || undefined,
      });
      await refresh();
      setProfileMessage('Profile details updated successfully.');
    } catch (err: any) {
      setProfileError(err.message ?? 'Failed to update profile');
    } finally {
      setProfileBusy(false);
    }
  };

  // Handle Password Change (ZYV-79)
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);

    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }

    setPasswordBusy(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordMessage('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.message ?? 'Failed to change password');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-12 sm:py-16">
      <div className="mb-8 flex flex-wrap justify-between items-end gap-4 border-b border-rule pb-6">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-ink">
            Hello, {user?.fullName?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="text-xs text-ink-muted mt-1">{user?.email}</p>
        </div>

        <Button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/');
          }}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          Sign Out
        </Button>
      </div>

      {/* Tab Navigation (ZYV-97) */}
      <div className="flex gap-2 border-b border-rule mb-8">
        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          className={`px-4 py-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === 'orders'
              ? 'border-brass text-ink font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          My Orders
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('addresses')}
          className={`px-4 py-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === 'addresses'
              ? 'border-brass text-ink font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Saved Addresses
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2.5 text-xs font-mono uppercase tracking-wider border-b-2 transition-colors ${
            activeTab === 'profile'
              ? 'border-brass text-ink font-semibold'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Profile & Security
        </button>
      </div>

      {/* TAB 1: MY ORDERS (ZYV-88, ZYV-89, ZYV-87) */}
      {activeTab === 'orders' && (
        <div className="space-y-6">
          {ordersError && (
            <div className="p-4 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm">
              {ordersError}
            </div>
          )}

          {ordersLoading ? (
            <p className="text-sm text-ink-muted py-8 text-center">
              Loading your orders...
            </p>
          ) : !orders || orders.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-rule rounded space-y-4">
              <p className="font-display text-xl text-ink">No Orders Yet</p>
              <p className="text-sm text-ink-muted">
                You haven&apos;t placed any orders yet. Explore our handcrafted
                flags!
              </p>
              <Link
                to="/catalog"
                className="inline-block px-5 py-2.5 bg-ink text-surface text-xs font-mono uppercase tracking-wider rounded hover:bg-ink-muted transition-colors"
              >
                Explore Catalogue
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {orders.map((order) => {
                const canCancel = [
                  'pending',
                  'confirmed',
                  'processing',
                ].includes(order.status.toLowerCase());
                const canReturn = order.status.toLowerCase() === 'delivered';

                return (
                  <div
                    key={order.id}
                    className="border border-rule rounded divide-y divide-rule bg-surface-sunken/10"
                  >
                    <div className="p-4 flex flex-wrap justify-between items-center gap-4 bg-surface-sunken/40">
                      <div>
                        <span className="text-xs text-ink-muted block font-mono">
                          Order ID: {order.id}
                        </span>
                        <span className="text-xs text-ink-muted">
                          Placed on{' '}
                          {new Date(order.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider bg-amber-100 text-amber-800">
                          {order.status}
                        </span>
                        <span className="font-bold text-sm text-ink">
                          {rupees(order.total)}
                        </span>
                      </div>
                    </div>

                    {/* Order items */}
                    <div className="p-4 divide-y divide-rule/60">
                      {order.items?.map((item) => (
                        <div
                          key={item.id}
                          className="py-2.5 flex justify-between text-sm"
                        >
                          <div>
                            <p className="font-medium text-ink">{item.name}</p>
                            <p className="text-xs text-ink-muted">
                              Qty: {item.quantity} × {rupees(item.unit_price)}
                            </p>
                          </div>
                          <p className="font-medium text-ink">
                            {rupees(item.unit_price * item.quantity)}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Shipment Tracking info (ZYV-88) */}
                    {order.shipment && (
                      <div className="p-4 bg-emerald-50/50 border-t border-rule text-xs text-emerald-900 space-y-1">
                        <p className="font-semibold uppercase tracking-wider">
                          Shipment Tracking
                        </p>
                        <p>
                          Carrier:{' '}
                          {order.shipment.carrier ?? 'Express Logistics'}
                        </p>
                        <p className="font-mono">
                          Tracking No:{' '}
                          {order.shipment.tracking_number ?? 'In Transit'}
                        </p>
                        <p>Status: {order.shipment.status}</p>
                      </div>
                    )}

                    {/* Actions: Cancel & Return (ZYV-89, ZYV-87) */}
                    <div className="p-4 flex flex-wrap justify-end gap-3 bg-surface">
                      {canCancel && cancellingId !== order.id && (
                        <button
                          type="button"
                          onClick={() => setCancellingId(order.id)}
                          className="text-xs text-rose-600 hover:text-rose-800 font-medium"
                        >
                          Cancel Order
                        </button>
                      )}

                      {canReturn && returningId !== order.id && (
                        <button
                          type="button"
                          onClick={() => setReturningId(order.id)}
                          className="text-xs text-brass hover:text-brass-deep font-medium"
                        >
                          Request Return / Refund
                        </button>
                      )}

                      <Link
                        to={`/order-confirmation/${order.id}`}
                        className="text-xs text-ink-muted hover:text-ink underline"
                      >
                        View Full Details
                      </Link>
                    </div>

                    {/* Cancellation confirmation box */}
                    {cancellingId === order.id && (
                      <div className="p-4 bg-rose-50 border-t border-rose-200 space-y-3">
                        <p className="text-xs font-semibold text-rose-800">
                          Confirm Cancellation (per Cancellation Policy)
                        </p>
                        <input
                          type="text"
                          placeholder="Reason for cancellation (optional)"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          className="w-full border border-rose-300 rounded px-3 py-1.5 text-xs outline-none bg-surface"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setCancellingId(null);
                              setCancelReason('');
                            }}
                            className="text-xs px-3 py-1.5 rounded border border-rule"
                          >
                            Keep Order
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(order.id)}
                            className="text-xs px-3 py-1.5 rounded bg-rose-600 text-white font-medium hover:bg-rose-700"
                          >
                            Confirm Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Return confirmation box */}
                    {returningId === order.id && (
                      <div className="p-4 bg-amber-50 border-t border-amber-200 space-y-3">
                        <p className="text-xs font-semibold text-amber-900">
                          Request Return / Refund (per Return Policy)
                        </p>
                        <textarea
                          rows={2}
                          placeholder="Reason for return request (required)*"
                          value={returnReason}
                          onChange={(e) => setReturnReason(e.target.value)}
                          className="w-full border border-amber-300 rounded px-3 py-1.5 text-xs outline-none bg-surface"
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setReturningId(null);
                              setReturnReason('');
                            }}
                            className="text-xs px-3 py-1.5 rounded border border-rule"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReturnRequest(order.id)}
                            className="text-xs px-3 py-1.5 rounded bg-brass text-white font-medium hover:bg-brass-deep"
                          >
                            Submit Return Request
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SAVED ADDRESSES (ZYV-74) */}
      {activeTab === 'addresses' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="font-display text-xl text-ink">
              Delivery Addresses
            </h2>
            <Button
              type="button"
              onClick={() => setShowAddAddress(!showAddAddress)}
              variant="outline"
              size="sm"
            >
              {showAddAddress ? 'Close Form' : '+ Add Address'}
            </Button>
          </div>

          {addressesError && (
            <div className="p-4 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm">
              {addressesError}
            </div>
          )}

          {showAddAddress && (
            <form
              onSubmit={handleSaveAddress}
              className="p-6 border border-rule rounded bg-surface-sunken/20 space-y-4"
            >
              <h3 className="text-sm font-semibold text-ink">
                New Delivery Address
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase text-ink-muted mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAddr.fullName}
                    onChange={(e) =>
                      setNewAddr({ ...newAddr, fullName: e.target.value })
                    }
                    className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase text-ink-muted mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="10-digit number"
                    value={newAddr.mobile}
                    onChange={(e) =>
                      setNewAddr({ ...newAddr, mobile: e.target.value })
                    }
                    className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs uppercase text-ink-muted mb-1">
                  Street / House No. *
                </label>
                <input
                  type="text"
                  required
                  value={newAddr.houseNumberAndStreet}
                  onChange={(e) =>
                    setNewAddr({
                      ...newAddr,
                      houseNumberAndStreet: e.target.value,
                    })
                  }
                  className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs uppercase text-ink-muted mb-1">
                    Area / Locality *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAddr.area}
                    onChange={(e) =>
                      setNewAddr({ ...newAddr, area: e.target.value })
                    }
                    className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase text-ink-muted mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAddr.city}
                    onChange={(e) =>
                      setNewAddr({ ...newAddr, city: e.target.value })
                    }
                    className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase text-ink-muted mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    value={newAddr.state}
                    onChange={(e) =>
                      setNewAddr({ ...newAddr, state: e.target.value })
                    }
                    className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase text-ink-muted mb-1">
                    PIN Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={newAddr.pinCode}
                    onChange={(e) =>
                      setNewAddr({ ...newAddr, pinCode: e.target.value })
                    }
                    className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase text-ink-muted mb-1">
                    Landmark (Optional)
                  </label>
                  <input
                    type="text"
                    value={newAddr.landmark ?? ''}
                    onChange={(e) =>
                      setNewAddr({ ...newAddr, landmark: e.target.value })
                    }
                    className="w-full border border-rule rounded px-3 py-1.5 text-sm bg-surface"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAddr.isDefault}
                  onChange={(e) =>
                    setNewAddr({ ...newAddr, isDefault: e.target.checked })
                  }
                />
                Set as default delivery address
              </label>

              <Button type="submit" variant="brass" size="md">
                Save Address
              </Button>
            </form>
          )}

          {addressesLoading ? (
            <p className="text-sm text-ink-muted py-8 text-center">
              Loading addresses...
            </p>
          ) : addresses.length === 0 ? (
            <p className="text-sm text-ink-muted py-8 text-center">
              No saved addresses found. Add one above for quicker checkout!
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {addresses.map((addr) => (
                <div
                  key={addr.id}
                  className={`p-5 border rounded relative flex flex-col justify-between ${
                    addr.isDefault
                      ? 'border-brass bg-amber-50/20'
                      : 'border-rule'
                  }`}
                >
                  <div className="space-y-1 text-sm">
                    {addr.isDefault && (
                      <span className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-brass text-white mb-2">
                        Default Address
                      </span>
                    )}
                    <p className="font-semibold text-ink">{addr.fullName}</p>
                    <p className="text-ink-muted">
                      {addr.houseNumberAndStreet}, {addr.area}
                    </p>
                    <p className="text-ink-muted">
                      {addr.city}, {addr.state} — {addr.pinCode}
                    </p>
                    <p className="text-xs text-ink-muted pt-1">
                      Phone: {addr.mobile}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-rule flex justify-between items-center text-xs">
                    {!addr.isDefault ? (
                      <button
                        type="button"
                        onClick={() => handleSetDefaultAddress(addr.id)}
                        className="text-brass hover:underline"
                      >
                        Make Default
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteAddress(addr.id)}
                      className="text-rose-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PROFILE & SECURITY (ZYV-79) */}
      {activeTab === 'profile' && (
        <div className="space-y-12">
          {/* Profile details form */}
          <form
            onSubmit={handleUpdateProfile}
            className="p-6 border border-rule rounded space-y-4"
          >
            <h2 className="font-display text-xl text-ink">Personal Details</h2>
            {profileMessage && (
              <p className="text-sm text-emerald-600 font-medium">
                {profileMessage}
              </p>
            )}
            {profileError && (
              <p className="text-sm text-rose-600 font-medium">
                {profileError}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase text-ink-muted mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full border border-rule rounded px-3 py-2 text-sm bg-surface"
                />
              </div>
              <div>
                <label className="block text-xs uppercase text-ink-muted mb-1">
                  Mobile Number
                </label>
                <input
                  type="tel"
                  placeholder="10-digit number"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="w-full border border-rule rounded px-3 py-2 text-sm bg-surface"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase text-ink-muted mb-1">
                Email Address
              </label>
              <input
                type="email"
                disabled
                value={user?.email ?? ''}
                className="w-full border border-rule/50 rounded px-3 py-2 text-sm bg-surface-sunken text-ink-muted"
              />
              <span className="text-[11px] text-ink-muted">
                Email address cannot be changed.
              </span>
            </div>

            <Button
              type="submit"
              variant="brass"
              size="md"
              disabled={profileBusy}
            >
              {profileBusy ? 'Saving...' : 'Update Profile'}
            </Button>
          </form>

          {/* Change password form */}
          <form
            onSubmit={handleChangePassword}
            className="p-6 border border-rule rounded space-y-4"
          >
            <h2 className="font-display text-xl text-ink">Change Password</h2>
            {passwordMessage && (
              <p className="text-sm text-emerald-600 font-medium">
                {passwordMessage}
              </p>
            )}
            {passwordError && (
              <p className="text-sm text-rose-600 font-medium">
                {passwordError}
              </p>
            )}

            <div>
              <label className="block text-xs uppercase text-ink-muted mb-1">
                Current Password *
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full border border-rule rounded px-3 py-2 text-sm bg-surface"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs uppercase text-ink-muted mb-1">
                  New Password (12+ chars) *
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-rule rounded px-3 py-2 text-sm bg-surface"
                />
              </div>
              <div>
                <label className="block text-xs uppercase text-ink-muted mb-1">
                  Confirm New Password *
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-rule rounded px-3 py-2 text-sm bg-surface"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="brass"
              size="md"
              disabled={passwordBusy}
            >
              {passwordBusy ? 'Updating Password...' : 'Change Password'}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
