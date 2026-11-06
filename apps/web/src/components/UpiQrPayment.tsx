import { useMemo, useState, useEffect } from 'react';

import { generateQrSvg } from '../lib/qr';

interface UpiQrPaymentProps {
  amount: number;
  orderReference?: string;
  onMethodChange?: (method: 'upi_qr' | 'cod') => void;
  utr: string;
  onUtrChange: (utr: string) => void;
}

export function UpiQrPayment({
  amount,
  orderReference = 'ZYVORA Order',
  onMethodChange,
  utr,
  onUtrChange,
}: UpiQrPaymentProps) {
  const [method, setMethod] = useState<'upi_qr' | 'cod'>('upi_qr');
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15 * 60); // 15 minutes timer

  const defaultUpi =
    (import.meta.env.VITE_UPI_ID as string | undefined)?.trim() ||
    'zyvora@icici';
  const [upiId, setUpiId] = useState(defaultUpi);
  const [tempUpiId, setTempUpiId] = useState(defaultUpi);
  const [isEditingUpi, setIsEditingUpi] = useState(false);
  const payeeName = 'ZYVORA Flags';

  // Standard NPCI UPI URI specifications
  const upiUri = useMemo(() => {
    const cleanPa = upiId.trim();
    const formattedAmount = Number(amount).toFixed(2);
    const cleanTn = orderReference.slice(0, 30);
    const params = new URLSearchParams({
      pa: cleanPa,
      pn: payeeName,
      am: formattedAmount,
      cu: 'INR',
      tn: cleanTn,
      mode: '02',
    });
    return `upi://pay?${params.toString()}`;
  }, [upiId, payeeName, amount, orderReference]);

  const qrSvg = useMemo(() => {
    try {
      return generateQrSvg(upiUri, {
        margin: 2,
        darkColor: '#0f172a',
        lightColor: '#ffffff',
      });
    } catch {
      return '';
    }
  }, [upiUri]);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(upiId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSaveCustomUpi = () => {
    const trimmed = tempUpiId.trim();
    if (trimmed && trimmed.includes('@')) {
      setUpiId(trimmed);
      setIsEditingUpi(false);
    }
  };

  const handleSelectMethod = (m: 'upi_qr' | 'cod') => {
    setMethod(m);
    onMethodChange?.(m);
  };

  return (
    <div className="space-y-5">
      {/* Payment Options Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* UPI Option */}
        <label
          onClick={() => handleSelectMethod('upi_qr')}
          className={`flex items-start gap-3.5 p-4 rounded-2xl border cursor-pointer transition-all ${
            method === 'upi_qr'
              ? 'border-brass bg-amber-50/40 shadow-xs'
              : 'border-slate-200/80 bg-white hover:border-slate-300'
          }`}
        >
          <input
            type="radio"
            name="paymentOption"
            checked={method === 'upi_qr'}
            onChange={() => handleSelectMethod('upi_qr')}
            className="mt-1 accent-brass h-4 w-4 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-900">
                UPI QR Code & App
              </span>
              <span className="rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                Instant
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Scan dynamic QR with Google Pay, PhonePe, Paytm, or BHIM.
            </p>
          </div>
        </label>

        {/* Cash / Reservation Option */}
        <label
          onClick={() => handleSelectMethod('cod')}
          className={`flex items-start gap-3.5 p-4 rounded-2xl border cursor-pointer transition-all ${
            method === 'cod'
              ? 'border-brass bg-amber-50/40 shadow-xs'
              : 'border-slate-200/80 bg-white hover:border-slate-300'
          }`}
        >
          <input
            type="radio"
            name="paymentOption"
            checked={method === 'cod'}
            onChange={() => handleSelectMethod('cod')}
            className="mt-1 accent-brass h-4 w-4 shrink-0"
          />
          <div className="min-w-0">
            <span className="font-semibold text-sm text-slate-900">
              Standard Checkout (Order Reservation)
            </span>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Order confirmed and reserved for dispatch. Pay upon receipt.
            </p>
          </div>
        </label>
      </div>

      {/* QR Code Presentation Box */}
      {method === 'upi_qr' && (
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-xs space-y-6">
          {/* Header & Status */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                Live UPI Gateway Active
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500 bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-lg">
              <span>Expires in</span>
              <span className="font-bold text-amber-700">
                {formatTimer(timeLeft)}
              </span>
            </div>
          </div>

          {/* QR Code & Instructions Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Left: Dynamic QR Container */}
            <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-gradient-to-b from-slate-50 to-amber-50/30 border border-slate-200/80 shadow-inner">
              <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-200/80">
                {qrSvg ? (
                  <div
                    className="w-48 h-48 sm:w-56 sm:h-56 [&>svg]:w-full [&>svg]:h-full"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : (
                  <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center text-xs text-slate-400">
                    Generating QR code...
                  </div>
                )}
              </div>

              <div className="mt-3.5 text-center">
                <p className="text-xs font-bold text-slate-800">
                  Scan to Pay ₹{Number(amount).toLocaleString('en-IN')}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Point GPay, Paytm, or PhonePe camera to pay
                </p>
              </div>

              {/* Mobile Deep Link: Direct intent trigger on phones */}
              <a
                href={upiUri}
                className="mt-4 sm:hidden flex items-center justify-center gap-2 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs active:scale-95 transition"
              >
                <span>⚡</span>
                <span>Open in Installed UPI App</span>
              </a>
            </div>

            {/* Right: Manual UPI ID & App Badges */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Payee UPI ID
                  </p>
                  {!isEditingUpi && (
                    <button
                      type="button"
                      onClick={() => {
                        setTempUpiId(upiId);
                        setIsEditingUpi(true);
                      }}
                      className="text-[11px] text-brass hover:underline font-semibold"
                    >
                      Change UPI ID
                    </button>
                  )}
                </div>

                {isEditingUpi ? (
                  <div className="space-y-2 p-3 rounded-xl border border-amber-300 bg-amber-50/30">
                    <label className="block text-[11px] text-slate-600 font-medium">
                      Enter your personal or merchant UPI ID to accept payments:
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. yourname@oksbi or number@paytm"
                        value={tempUpiId}
                        onChange={(e) => setTempUpiId(e.target.value.trim())}
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono outline-none focus:border-brass"
                      />
                      <button
                        type="button"
                        onClick={handleSaveCustomUpi}
                        className="rounded-lg bg-brass px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-brass-light transition"
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingUpi(false)}
                        className="rounded-lg bg-white border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50/80">
                    <div className="flex-1 font-mono text-xs font-semibold text-slate-800 px-1 truncate">
                      {upiId}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="rounded-lg bg-white border border-slate-200/90 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brass hover:text-brass-deep transition shadow-xs active:scale-95 shrink-0"
                    >
                      {copied ? '✓ Copied' : 'Copy UPI'}
                    </button>
                  </div>
                )}
              </div>

              {/* Supported App Logos / Badges */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Supported UPI Applications
                </p>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {[
                    'Google Pay',
                    'PhonePe',
                    'Paytm',
                    'BHIM',
                    'CRED',
                    'Any UPI',
                  ].map((app) => (
                    <span
                      key={app}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700"
                    >
                      {app}
                    </span>
                  ))}
                </div>
              </div>

              {/* UTR / Transaction Reference Input */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  12-Digit UPI Ref / UTR Number (Optional)
                </label>
                <input
                  type="text"
                  maxLength={12}
                  placeholder="e.g. 403819284719"
                  value={utr}
                  onChange={(e) =>
                    onUtrChange(e.target.value.replace(/\D/g, ''))
                  }
                  className="w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 text-xs font-mono tracking-wider focus:border-brass outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Found in your UPI app payment receipt after scanning.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
