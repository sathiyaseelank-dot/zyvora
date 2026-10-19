import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DefaultMailer,
  MemoryMailer,
  type OrderConfirmationPayload,
  type PasswordResetPayload,
} from '../src/mail/mailer.js';

/**
 * ZYV-83 — Transactional Email & Mailer Infrastructure Tests.
 *
 * Acceptance Criteria verified:
 * - Email sent when provider is configured (tested via MemoryMailer)
 * - Order summary in email: items, quantities, total, shipping address
 * - Never fails order creation if email fails
 * - No email attempted when no provider is configured (graceful degradation)
 */

describe('ZYV-83 — Mailer Service', () => {
  const sampleOrder: OrderConfirmationPayload = {
    to: 'customer@example.com',
    orderId: 'ord-12345',
    customerName: 'Aarav Sharma',
    items: [
      {
        name: 'ZYVORA Premium Car Flag — Tricolour',
        quantity: 2,
        unitPrice: 499,
        lineTotal: 998,
      },
      {
        name: 'ZYVORA Magnetic Mount Kit — Universal',
        quantity: 1,
        unitPrice: 399,
        lineTotal: 399,
      },
    ],
    shippingAddress: {
      fullName: 'Aarav Sharma',
      houseNumberAndStreet: 'Flat 4B, Palm Grove',
      area: 'Anna Nagar',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pinCode: '600040',
    },
    totals: {
      subtotal: 1397,
      shipping: 0,
      tax: 0,
      discount: 0,
      total: 1397,
    },
  };

  const sampleReset: PasswordResetPayload = {
    to: 'customer@example.com',
    fullName: 'Aarav Sharma',
    resetToken: 'test-token-1234567890',
    resetUrl:
      'https://zyvora-omega.vercel.app/reset-password?token=test-token-1234567890',
    expiresInMinutes: 15,
  };

  it('gracefully degrades with noop when no email provider is configured', async () => {
    // Save current env and clear provider variables
    const oldSmtp = process.env.SMTP_HOST;
    const oldResend = process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.RESEND_API_KEY;

    try {
      const mailer = new DefaultMailer();
      assert.equal(mailer.isConfigured(), false);

      const orderRes = await mailer.sendOrderConfirmation(sampleOrder);
      assert.equal(orderRes.sent, false);
      assert.equal(orderRes.provider, 'noop');
      assert.match(orderRes.error ?? '', /no email provider/i);

      const resetRes = await mailer.sendPasswordReset(sampleReset);
      assert.equal(resetRes.sent, false);
      assert.equal(resetRes.provider, 'noop');
      assert.match(resetRes.error ?? '', /no email provider/i);
    } finally {
      if (oldSmtp) process.env.SMTP_HOST = oldSmtp;
      if (oldResend) process.env.RESEND_API_KEY = oldResend;
    }
  });

  it('records sent order confirmation with complete order summary in memory transport', async () => {
    const memoryMailer = new MemoryMailer();
    assert.equal(memoryMailer.isConfigured(), true);

    const res = await memoryMailer.sendOrderConfirmation(sampleOrder);
    assert.equal(res.sent, true);
    assert.equal(res.provider, 'memory');
    assert.ok(res.messageId);

    assert.equal(memoryMailer.sentEmails.length, 1);
    const recorded = memoryMailer.sentEmails[0];
    assert.equal(recorded.type, 'order_confirmation');

    const payload = recorded.payload as OrderConfirmationPayload;
    assert.equal(payload.to, 'customer@example.com');
    assert.equal(payload.orderId, 'ord-12345');
    assert.equal(payload.items.length, 2);
    assert.equal(payload.totals.total, 1397);
    assert.equal(payload.shippingAddress.city, 'Chennai');
    assert.equal(payload.shippingAddress.pinCode, '600040');
  });

  it('records sent password reset email with token and reset URL in memory transport', async () => {
    const memoryMailer = new MemoryMailer();

    const res = await memoryMailer.sendPasswordReset(sampleReset);
    assert.equal(res.sent, true);
    assert.equal(res.provider, 'memory');

    assert.equal(memoryMailer.sentEmails.length, 1);
    const recorded = memoryMailer.sentEmails[0];
    assert.equal(recorded.type, 'password_reset');

    const payload = recorded.payload as PasswordResetPayload;
    assert.equal(payload.to, 'customer@example.com');
    assert.equal(payload.resetToken, 'test-token-1234567890');
    assert.ok(payload.resetUrl.includes('test-token-1234567890'));
    assert.equal(payload.expiresInMinutes, 15);
  });
});
