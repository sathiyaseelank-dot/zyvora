import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useSession } from '../lib/session';
import {
  fetchCart,
  fetchAddresses,
  createAddress,
  validateCheckout,
  createOrder,
  type Cart,
  type Address,
  type CheckoutValidation,
} from '../lib/api';
import { Button } from '../components/Button';
import { UpiQrPayment } from '../components/UpiQrPayment';

function rupees(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

const CHECKOUT_STORAGE_KEY = 'zyvora_checkout_state';

interface CheckoutState {
  step: 1 | 2 | 3;
  addressId?: string;
  newAddress?: {
    fullName: string;
    mobile: string;
    email: string;
    houseNumberAndStreet: string;
    area: string;
    landmark?: string;
    city: string;
    state: string;
    pinCode: string;
    country: string;
    deliveryInstructions?: string;
    saveToAccount?: boolean;
  };
  couponCode?: string;
  checkoutSessionId: string;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useSession();
  const fullNameRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [cart, setCart] = useState<Cart | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [couponCode, setCouponCode] = useState<string>('');
  const [validation, setValidation] = useState<CheckoutValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [paymentMethod, setPaymentMethod] = useState<'upi_qr' | 'cod'>(
    'upi_qr',
  );
  const [utr, setUtr] = useState('');

  // Address form fields
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [houseNumberAndStreet, setHouseNumberAndStreet] = useState('');
  const [area, setArea] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const [saveToAccount, setSaveToAccount] = useState(true);

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Session ID for idempotency (ZYV-73)
  const [sessionId] = useState<string>(() => {
    const saved = sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
    if (saved) {
      try {
        const parsed: CheckoutState = JSON.parse(saved);
        return parsed.checkoutSessionId;
      } catch {
        // ignore
      }
    }
    const newId = crypto.randomUUID();
    return newId;
  });

  // Auto-focus full name field when arriving from "Buy now"
  useEffect(() => {
    const state = location.state as { autoFocusFullName?: boolean } | null;
    if (state?.autoFocusFullName) {
      setTimeout(() => fullNameRef.current?.focus(), 100);
    }
  }, [location.state]);

  // Load initial cart and addresses
  useEffect(() => {
    let active = true;
    async function init() {
      try {
        setLoading(true);
        const cartData = await fetchCart();
        if (!active) return;
        setCart(cartData);

        if (!cartData?.lines || cartData.lines.length === 0) {
          navigate('/cart');
          return;
        }

        if (user) {
          setEmail(user.email);
          if (user.fullName) setFullName(user.fullName);

          const addrs = await fetchAddresses();
          if (!active) return;
          setSavedAddresses(addrs);
          const defaultAddr = addrs.find((a) => a.isDefault) ?? addrs[0];
          if (defaultAddr) {
            setSelectedAddressId(defaultAddr.id);
          }
        }

        // Restore state from sessionStorage if returning from login redirect (ZYV-66)
        const saved = sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
        if (saved) {
          try {
            const parsed: CheckoutState = JSON.parse(saved);
            if (parsed.couponCode) setCouponCode(parsed.couponCode);
            if (parsed.step) setStep(parsed.step);
            if (parsed.newAddress) {
              setFullName(parsed.newAddress.fullName);
              setMobile(parsed.newAddress.mobile);
              setEmail(parsed.newAddress.email);
              setHouseNumberAndStreet(parsed.newAddress.houseNumberAndStreet);
              setArea(parsed.newAddress.area);
              setLandmark(parsed.newAddress.landmark ?? '');
              setCity(parsed.newAddress.city);
              setState(parsed.newAddress.state);
              setPinCode(parsed.newAddress.pinCode);
              setDeliveryInstructions(
                parsed.newAddress.deliveryInstructions ?? '',
              );
            }
          } catch {
            // ignore
          }
        }
      } catch (err: any) {
        if (active) setError(err.message ?? 'Failed to load checkout');
      } finally {
        if (active) setLoading(false);
      }
    }

    void init();
    return () => {
      active = false;
    };
  }, [user, navigate]);

  // Persist draft checkout state to sessionStorage (ZYV-66)
  useEffect(() => {
    const stateObj: CheckoutState = {
      step,
      addressId: selectedAddressId,
      newAddress: {
        fullName,
        mobile,
        email,
        houseNumberAndStreet,
        area,
        landmark,
        city,
        state,
        pinCode,
        country: 'India',
        deliveryInstructions,
        saveToAccount,
      },
      couponCode,
      checkoutSessionId: sessionId,
    };
    sessionStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(stateObj));
  }, [
    step,
    selectedAddressId,
    fullName,
    mobile,
    email,
    houseNumberAndStreet,
    area,
    landmark,
    city,
    state,
    pinCode,
    deliveryInstructions,
    saveToAccount,
    couponCode,
    sessionId,
  ]);

  // Handle Step 1 -> Step 2 (Address -> Review)
  const handleProceedToReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      let finalAddressId = selectedAddressId;

      // Validate address input if entering a new address
      if (!selectedAddressId) {
        const cleanFullName = fullName.trim();
        const cleanMobile = mobile
          .replace(/[\s\-()]/g, '')
          .replace(/^(?:\+91|0)/, '');
        const cleanEmail = email.trim().toLowerCase();
        const cleanStreet = houseNumberAndStreet.trim();
        const cleanArea = area.trim();
        const cleanCity = city.trim();
        const cleanState = state.trim();
        const cleanPin = pinCode.replace(/\s+/g, '');
        const cleanLandmark = landmark.trim() || null;
        const cleanInstructions = deliveryInstructions.trim() || null;

        if (!cleanFullName) throw new Error('Full name is required');
        if (cleanFullName.length < 2)
          throw new Error('Full name must be at least 2 characters');
        if (!cleanMobile) throw new Error('Mobile number is required');
        if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
          throw new Error(
            'Please enter a valid 10-digit Indian mobile number (e.g. 9876543210)',
          );
        }
        if (!cleanEmail) throw new Error('Email address is required');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
          throw new Error('Please enter a valid email address');
        }
        if (!cleanStreet)
          throw new Error('Flat / House No. & Street is required');
        if (cleanStreet.length < 3)
          throw new Error(
            'Flat / House No. & Street must be at least 3 characters',
          );
        if (!cleanArea) throw new Error('Area / Locality is required');
        if (cleanArea.length < 2)
          throw new Error('Area / Locality must be at least 2 characters');
        if (!cleanCity) throw new Error('City is required');
        if (cleanCity.length < 2)
          throw new Error('City must be at least 2 characters');
        if (!cleanState) throw new Error('State is required');
        if (cleanState.length < 2)
          throw new Error('State must be at least 2 characters');
        if (!cleanPin) throw new Error('PIN Code is required');
        if (!/^\d{6}$/.test(cleanPin)) {
          throw new Error('Please enter a valid 6-digit PIN code');
        }

        // Save address to server if user is authenticated
        if (user) {
          const newAddr = await createAddress({
            fullName: cleanFullName,
            mobile: cleanMobile,
            email: cleanEmail,
            houseNumberAndStreet: cleanStreet,
            area: cleanArea,
            landmark: cleanLandmark,
            city: cleanCity,
            state: cleanState,
            pinCode: cleanPin,
            country: 'India',
            deliveryInstructions: cleanInstructions,
            isDefault: saveToAccount && savedAddresses.length === 0,
          });
          finalAddressId = newAddr.id;
          setSelectedAddressId(newAddr.id);
          setSavedAddresses((prev) => [...prev, newAddr]);
        }
      }

      // Revalidate basket with server (ZYV-59)
      const val = await validateCheckout({
        addressId: user ? finalAddressId || undefined : undefined,
        couponCode: couponCode || undefined,
      });

      setValidation(val);
      if (!val.canCheckout) {
        setError(val.blockers?.[0]?.message ?? 'Checkout cannot proceed');
        return;
      }

      setStep(2);
    } catch (err: any) {
      if (err.fieldErrors && Object.keys(err.fieldErrors).length > 0) {
        setFieldErrors(err.fieldErrors);
        const firstKey = Object.keys(err.fieldErrors)[0];
        const firstMsg = err.fieldErrors[firstKey]?.[0];
        setError(
          firstMsg ??
            err.message ??
            'Please check the highlighted address fields',
        );
      } else {
        setError(err.message ?? 'Failed to validate address');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Revalidate coupon
  const handleApplyCoupon = async () => {
    try {
      setError(null);
      const val = await validateCheckout({
        addressId: user ? selectedAddressId || undefined : undefined,
        couponCode: couponCode.trim().toUpperCase() || undefined,
      });
      setValidation(val);
    } catch (err: any) {
      setError(err.message ?? 'Failed to apply coupon');
    }
  };

  // Handle Step 3 Payment & Order Creation (ZYV-61, ZYV-63, ZYV-73)
  const handlePayNow = async () => {
    setError(null);

    // If guest, redirect to login/register (ZYV-63)
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent('/checkout')}`);
      return;
    }

    if (!selectedAddressId) {
      setError('Please select or add a delivery address');
      setStep(1);
      return;
    }

    try {
      setSubmitting(true);
      const res = await createOrder({
        addressId: selectedAddressId,
        couponCode: couponCode ? couponCode.trim().toUpperCase() : undefined,
        checkoutSessionId: sessionId,
      });

      // Clear checkout state from storage
      sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);

      // Navigate to order confirmation page (ZYV-82)
      navigate(`/order-confirmation/${res.order.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[800px] px-5 py-16 text-center text-ink-muted">
        Loading checkout...
      </div>
    );
  }

  const totals = validation?.totals ?? cart?.totals;

  return (
    <div className="mx-auto max-w-[1000px] px-5 pt-8 pb-32 sm:py-16">
      <div className="mb-10 text-center">
        <h1 className="font-display text-[32px] sm:text-[40px] text-ink">
          Complete Your Order
        </h1>
      </div>

      {/* Stepper Header (ZYV-99) */}
      <div className="mb-12 flex justify-center items-center gap-4 text-xs font-mono tracking-widest uppercase">
        <button
          type="button"
          onClick={() => setStep(1)}
          className={`flex items-center gap-2 pb-2 border-b-2 transition-colors ${
            step === 1
              ? 'border-brass text-ink font-semibold'
              : 'border-transparent text-ink-muted'
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-surface-sunken flex items-center justify-center text-[10px]">
            1
          </span>
          Delivery
        </button>
        <span className="text-rule">―</span>
        <button
          type="button"
          onClick={() => (selectedAddressId || !user) && setStep(2)}
          disabled={!selectedAddressId && Boolean(user)}
          className={`flex items-center gap-2 pb-2 border-b-2 transition-colors ${
            step === 2
              ? 'border-brass text-ink font-semibold'
              : 'border-transparent text-ink-muted'
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-surface-sunken flex items-center justify-center text-[10px]">
            2
          </span>
          Review
        </button>
        <span className="text-rule">―</span>
        <button
          type="button"
          onClick={() => setStep(3)}
          disabled={step < 2}
          className={`flex items-center gap-2 pb-2 border-b-2 transition-colors ${
            step === 3
              ? 'border-brass text-ink font-semibold'
              : 'border-transparent text-ink-muted'
          }`}
        >
          <span className="w-5 h-5 rounded-full bg-surface-sunken flex items-center justify-center text-[10px]">
            3
          </span>
          Payment
        </button>
      </div>

      {error && (
        <div className="mb-8 p-4 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Main Step Body */}
        <div className="lg:col-span-7">
          {/* STEP 1: DELIVERY ADDRESS */}
          {step === 1 && (
            <div className="space-y-8">
              <h2 className="font-display text-2xl text-ink">
                Delivery Address
              </h2>

              {/* Saved addresses picker if logged in */}
              {user && savedAddresses.length > 0 && (
                <div className="space-y-4">
                  <p className="text-xs uppercase tracking-wider text-ink-muted">
                    Saved Addresses
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    {savedAddresses.map((addr) => (
                      <label
                        key={addr.id}
                        className={`p-4 border rounded cursor-pointer transition-all flex items-start gap-3 ${
                          selectedAddressId === addr.id
                            ? 'border-brass bg-amber-50/20'
                            : 'border-rule hover:border-ink-muted'
                        }`}
                      >
                        <input
                          type="radio"
                          name="savedAddress"
                          checked={selectedAddressId === addr.id}
                          onChange={() => setSelectedAddressId(addr.id)}
                          className="mt-1"
                        />
                        <div className="text-sm">
                          <p className="font-semibold text-ink">
                            {addr.fullName}
                          </p>
                          <p className="text-ink-muted">
                            {addr.houseNumberAndStreet}, {addr.area}
                          </p>
                          <p className="text-ink-muted">
                            {addr.city}, {addr.state} — {addr.pinCode}
                          </p>
                          <p className="text-xs text-ink-muted mt-1">
                            Phone: {addr.mobile}
                          </p>
                        </div>
                      </label>
                    ))}
                    <label
                      className={`p-4 border rounded cursor-pointer transition-all flex items-center gap-3 ${
                        !selectedAddressId
                          ? 'border-brass bg-amber-50/20'
                          : 'border-rule hover:border-ink-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name="savedAddress"
                        checked={!selectedAddressId}
                        onChange={() => setSelectedAddressId('')}
                      />
                      <span className="text-sm font-medium">
                        Add New Address
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* New Address Form */}
              {(!user || !selectedAddressId) && (
                <form
                  id="addressForm"
                  onSubmit={handleProceedToReview}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        ref={fullNameRef}
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          clearFieldError('fullName');
                        }}
                        className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                          fieldErrors.fullName
                            ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                            : 'border-rule focus:border-brass'
                        }`}
                      />
                      {fieldErrors.fullName && (
                        <p className="mt-1 text-xs text-rose-600 font-medium">
                          {fieldErrors.fullName[0]}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                        Mobile Number *
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="10-digit number"
                        value={mobile}
                        onChange={(e) => {
                          setMobile(e.target.value);
                          clearFieldError('mobile');
                        }}
                        className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                          fieldErrors.mobile
                            ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                            : 'border-rule focus:border-brass'
                        }`}
                      />
                      {fieldErrors.mobile && (
                        <p className="mt-1 text-xs text-rose-600 font-medium">
                          {fieldErrors.mobile[0]}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearFieldError('email');
                      }}
                      className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                        fieldErrors.email
                          ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                          : 'border-rule focus:border-brass'
                      }`}
                    />
                    {fieldErrors.email && (
                      <p className="mt-1 text-xs text-rose-600 font-medium">
                        {fieldErrors.email[0]}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                      Flat / House No. & Street *
                    </label>
                    <input
                      type="text"
                      required
                      value={houseNumberAndStreet}
                      onChange={(e) => {
                        setHouseNumberAndStreet(e.target.value);
                        clearFieldError('houseNumberAndStreet');
                      }}
                      className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                        fieldErrors.houseNumberAndStreet
                          ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                          : 'border-rule focus:border-brass'
                      }`}
                    />
                    {fieldErrors.houseNumberAndStreet && (
                      <p className="mt-1 text-xs text-rose-600 font-medium">
                        {fieldErrors.houseNumberAndStreet[0]}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                        Area / Locality *
                      </label>
                      <input
                        type="text"
                        required
                        value={area}
                        onChange={(e) => {
                          setArea(e.target.value);
                          clearFieldError('area');
                        }}
                        className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                          fieldErrors.area
                            ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                            : 'border-rule focus:border-brass'
                        }`}
                      />
                      {fieldErrors.area && (
                        <p className="mt-1 text-xs text-rose-600 font-medium">
                          {fieldErrors.area[0]}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                        Landmark (Optional)
                      </label>
                      <input
                        type="text"
                        value={landmark}
                        onChange={(e) => {
                          setLandmark(e.target.value);
                          clearFieldError('landmark');
                        }}
                        className="w-full border border-rule rounded px-3 py-2 text-sm focus:border-brass outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                        City *
                      </label>
                      <input
                        type="text"
                        required
                        value={city}
                        onChange={(e) => {
                          setCity(e.target.value);
                          clearFieldError('city');
                        }}
                        className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                          fieldErrors.city
                            ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                            : 'border-rule focus:border-brass'
                        }`}
                      />
                      {fieldErrors.city && (
                        <p className="mt-1 text-xs text-rose-600 font-medium">
                          {fieldErrors.city[0]}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                        State *
                      </label>
                      <input
                        type="text"
                        required
                        value={state}
                        onChange={(e) => {
                          setState(e.target.value);
                          clearFieldError('state');
                        }}
                        className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                          fieldErrors.state
                            ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                            : 'border-rule focus:border-brass'
                        }`}
                      />
                      {fieldErrors.state && (
                        <p className="mt-1 text-xs text-rose-600 font-medium">
                          {fieldErrors.state[0]}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                        PIN Code *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        placeholder="6 digits"
                        value={pinCode}
                        onChange={(e) => {
                          setPinCode(e.target.value);
                          clearFieldError('pinCode');
                        }}
                        className={`w-full border rounded px-3 py-2 text-sm outline-none transition-colors ${
                          fieldErrors.pinCode
                            ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500'
                            : 'border-rule focus:border-brass'
                        }`}
                      />
                      {fieldErrors.pinCode && (
                        <p className="mt-1 text-xs text-rose-600 font-medium">
                          {fieldErrors.pinCode[0]}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wider text-ink-muted mb-1">
                      Delivery Instructions (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={deliveryInstructions}
                      onChange={(e) => {
                        setDeliveryInstructions(e.target.value);
                        clearFieldError('deliveryInstructions');
                      }}
                      className="w-full border border-rule rounded px-3 py-2 text-sm focus:border-brass outline-none"
                    />
                  </div>

                  {user && (
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-ink-muted">
                      <input
                        type="checkbox"
                        checked={saveToAccount}
                        onChange={(e) => setSaveToAccount(e.target.checked)}
                      />
                      Save this address to my account
                    </label>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="p-3.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-700 text-sm flex items-start gap-2.5 shadow-xs"
                    >
                      <span
                        className="shrink-0 text-rose-500 font-bold"
                        aria-hidden="true"
                      >
                        ⚠️
                      </span>
                      <span>{error}</span>
                    </div>
                  )}
                </form>
              )}

              {/* Clearance spacer on mobile so fixed bottom dock never overlaps form inputs */}
              <div className="h-24 sm:hidden" aria-hidden="true" />

              {/* Reshaped Bottom Bar (Flipkart UX on mobile, standard layout on desktop) */}
              <div className="fixed bottom-0 inset-x-0 z-40 rounded-t-[16px] border-t border-slate-200/90 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.09)] sm:static sm:inset-auto sm:z-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                <div className="mx-auto flex max-w-md items-center justify-between gap-3 sm:max-w-none sm:block flex-nowrap">
                  <div className="sm:hidden min-w-0 shrink-0">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      Total Payable
                    </p>
                    <p className="text-[16px] font-bold text-slate-900 leading-tight whitespace-nowrap">
                      {rupees(totals?.total ?? 0)}
                    </p>
                  </div>
                  <Button
                    type="submit"
                    form={!selectedAddressId ? 'addressForm' : undefined}
                    onClick={
                      selectedAddressId ? handleProceedToReview : undefined
                    }
                    variant="brass"
                    size="sm"
                    className="h-10 sm:h-12 w-auto shrink-0 sm:w-full font-bold shadow-xs text-xs sm:text-sm whitespace-nowrap px-4 sm:px-6"
                    disabled={submitting}
                  >
                    {submitting ? 'Validating...' : 'Continue to Order Review'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: ORDER REVIEW */}
          {step === 2 && (
            <div className="space-y-8">
              <div className="flex justify-between items-center">
                <h2 className="font-display text-2xl text-ink">Review Order</h2>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="text-xs text-brass hover:underline uppercase tracking-wider"
                >
                  Edit Address
                </button>
              </div>

              {/* Delivery Address Summary */}
              <div className="p-4 border border-rule rounded bg-surface-sunken/40 text-sm">
                <p className="font-semibold text-ink">
                  {validation?.address?.fullName ?? fullName}
                </p>
                <p className="text-ink-muted">
                  {validation?.address?.houseNumberAndStreet ??
                    houseNumberAndStreet}
                  , {validation?.address?.area ?? area}
                </p>
                <p className="text-ink-muted">
                  {validation?.address?.city ?? city},{' '}
                  {validation?.address?.state ?? state} —{' '}
                  {validation?.address?.pinCode ?? pinCode}
                </p>
                <p className="text-xs text-ink-muted mt-1">
                  Phone: {validation?.address?.mobile ?? mobile}
                </p>
              </div>

              {/* Products List */}
              <div className="border border-rule rounded divide-y divide-rule">
                {cart?.lines.map((item) => (
                  <div
                    key={item.itemId}
                    className="p-4 flex items-center gap-4"
                  >
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-16 h-16 object-cover rounded bg-surface-sunken"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-ink truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-ink-muted">
                        Qty: {item.quantity} × {rupees(item.unitPrice)}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-ink">
                      {rupees(item.lineTotal)}
                    </p>
                  </div>
                ))}
              </div>

              {/* Coupon Code Input */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Coupon Code"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  className="flex-1 min-w-0 border border-rule rounded-xl px-3.5 py-2.5 text-sm uppercase focus:border-brass outline-none"
                />
                <Button
                  type="button"
                  onClick={handleApplyCoupon}
                  variant="outline"
                  size="md"
                  className="shrink-0"
                >
                  Apply
                </Button>
              </div>

              {/* Clearance spacer on mobile so fixed bottom dock never overlaps coupon / action elements */}
              <div className="h-24 sm:hidden" aria-hidden="true" />

              {/* Reshaped Bottom Bar (Flipkart UX on mobile, standard layout on desktop) */}
              <div className="fixed bottom-0 inset-x-0 z-40 rounded-t-[16px] border-t border-slate-200/90 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.09)] sm:static sm:inset-auto sm:z-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                <div className="mx-auto flex max-w-md items-center justify-between gap-3 sm:max-w-none sm:flex sm:gap-4 flex-nowrap">
                  <div className="sm:hidden min-w-0 shrink-0">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      Total Payable
                    </p>
                    <p className="text-[16px] font-bold text-slate-900 leading-tight whitespace-nowrap">
                      {rupees(totals?.total ?? 0)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-nowrap shrink-0 sm:w-full sm:shrink">
                    <Button
                      type="button"
                      onClick={() => setStep(1)}
                      variant="outline"
                      size="sm"
                      className="h-10 sm:h-12 px-3 sm:px-6 sm:w-1/3 text-xs sm:text-sm whitespace-nowrap shrink-0"
                    >
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setStep(3)}
                      variant="brass"
                      size="sm"
                      className="h-10 sm:h-12 px-4 sm:px-6 flex-1 sm:flex-1 font-bold shadow-xs text-xs sm:text-sm whitespace-nowrap shrink-0"
                    >
                      Place Order
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PAYMENT */}
          {step === 3 && (
            <div className="space-y-8">
              <div className="flex justify-between items-center">
                <h2 className="font-display text-2xl text-ink">
                  Payment Method
                </h2>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="text-xs text-brass hover:underline uppercase tracking-wider"
                >
                  Review Order
                </button>
              </div>

              <UpiQrPayment
                amount={totals?.total ?? 0}
                orderReference={`ZYVORA-${sessionId.slice(0, 8)}`}
                onMethodChange={setPaymentMethod}
                utr={utr}
                onUtrChange={setUtr}
              />

              {!user && (
                <div className="p-4 rounded-xl bg-surface-sunken text-xs text-ink-muted leading-relaxed">
                  Notice: Clicking Pay Now will securely direct you to sign in
                  or create an account. Your cart, address, and checkout
                  progress will be preserved.
                </div>
              )}

              {/* Clearance spacer on mobile so fixed bottom dock never overlaps form inputs */}
              <div className="h-24 sm:hidden" aria-hidden="true" />

              {/* Reshaped Bottom Bar (Flipkart UX on mobile, standard layout on desktop) */}
              <div className="fixed bottom-0 inset-x-0 z-40 rounded-t-[16px] border-t border-slate-200/90 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.09)] sm:static sm:inset-auto sm:z-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                <div className="mx-auto flex max-w-md items-center justify-between gap-3 sm:max-w-none sm:flex sm:gap-4 flex-nowrap">
                  <div className="sm:hidden min-w-0 shrink-0">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                      Total Payable
                    </p>
                    <p className="text-[16px] font-bold text-slate-900 leading-tight whitespace-nowrap">
                      {rupees(totals?.total ?? 0)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-nowrap shrink-0 sm:w-full sm:shrink">
                    <Button
                      type="button"
                      onClick={() => setStep(2)}
                      variant="outline"
                      size="sm"
                      className="h-10 sm:h-12 px-3 sm:px-6 sm:w-1/3 text-xs sm:text-sm whitespace-nowrap shrink-0"
                    >
                      Back
                    </Button>
                    <Button
                      type="button"
                      onClick={handlePayNow}
                      disabled={submitting}
                      variant="brass"
                      size="sm"
                      className="h-10 sm:h-12 px-4 sm:px-6 flex-1 sm:flex-1 font-bold shadow-xs text-xs sm:text-sm whitespace-nowrap shrink-0"
                    >
                      {submitting
                        ? 'Processing...'
                        : user
                          ? paymentMethod === 'upi_qr'
                            ? `Pay Now via UPI • ${rupees(totals?.total ?? 0)}`
                            : `Pay Now • ${rupees(totals?.total ?? 0)}`
                          : 'Sign in to Pay Now'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Order Summary Sidebar */}
        <div className="lg:col-span-5">
          <div className="p-6 border border-rule rounded bg-surface-sunken/30 space-y-6 sticky top-24">
            <h3 className="font-display text-lg text-ink">Order Summary</h3>

            <div className="divide-y divide-rule text-sm">
              <div className="flex justify-between py-2 text-ink-muted">
                <span>Subtotal</span>
                <span className="font-medium text-ink">
                  {rupees(totals?.subtotal ?? 0)}
                </span>
              </div>
              <div className="flex justify-between py-2 text-ink-muted">
                <span>Shipping</span>
                <span>
                  {totals?.shipping === 0 ? (
                    <span className="text-emerald-600 font-semibold uppercase text-xs">
                      Free
                    </span>
                  ) : (
                    rupees(totals?.shipping ?? 99)
                  )}
                </span>
              </div>
              {Boolean(totals?.discount) && (
                <div className="flex justify-between py-2 text-emerald-600">
                  <span>Discount</span>
                  <span>- {rupees(totals?.discount ?? 0)}</span>
                </div>
              )}
              <div className="flex justify-between py-3 text-base font-bold text-ink pt-4">
                <span>Total Amount</span>
                <span>{rupees(totals?.total ?? 0)}</span>
              </div>
            </div>

            <div className="text-xs text-ink-muted space-y-1">
              <p>✔ Free shipping on orders ₹2,000 and above</p>
              <p>✔ Premium automotive grade fabrics & fittings</p>
              <p>✔ Secure transaction guarantee</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
