import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { generateQrMatrix } from '../src/lib/qr';
import { UpiQrPayment } from '../src/components/UpiQrPayment';

describe('QR Matrix Generation (lib/qr)', () => {
  it('generates a valid QR matrix for a standard UPI payment string', () => {
    const upiUri = 'upi://pay?pa=zyvora@icici&pn=ZYVORA&am=1999&cu=INR';
    const matrix = generateQrMatrix(upiUri);

    expect(matrix).toBeDefined();
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0].length).toBe(matrix.length);

    // Verify finder patterns (7x7 black corners)
    // Top-left
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][6]).toBe(true);
    expect(matrix[6][0]).toBe(true);
    expect(matrix[6][6]).toBe(true);
    expect(matrix[1][1]).toBe(false);

    // Top-right
    expect(matrix[0][matrix.length - 1]).toBe(true);
    expect(matrix[0][matrix.length - 7]).toBe(true);

    // Bottom-left
    expect(matrix[matrix.length - 1][0]).toBe(true);
    expect(matrix[matrix.length - 7][0]).toBe(true);
  });
});

describe('UpiQrPayment component', () => {
  it('renders UPI QR code, active gateway status, and copy UPI button', async () => {
    let currentUtr = '';

    render(
      <UpiQrPayment
        amount={2499}
        orderReference="ZYVORA-TEST123"
        utr={currentUtr}
        onUtrChange={(val) => {
          currentUtr = val;
        }}
      />,
    );

    expect(screen.getByText(/Live UPI Gateway Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Scan to Pay ₹2,499/i)).toBeInTheDocument();
    expect(screen.getByText('zyvora@icici')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /copy upi/i }),
    ).toBeInTheDocument();

    // Verify UPI Apps badges
    expect(screen.getByText('Google Pay')).toBeInTheDocument();
    expect(screen.getByText('PhonePe')).toBeInTheDocument();
    expect(screen.getByText('Paytm')).toBeInTheDocument();

    // Verify direct mobile link
    const mobileLink = screen.getByRole('link', {
      name: /open in installed upi app/i,
    });
    expect(mobileLink).toHaveAttribute(
      'href',
      expect.stringContaining('upi://pay?'),
    );
  });

  it('allows switching to Cash on Delivery / Standard Reservation', async () => {
    const user = userEvent.setup();
    let selectedMethod = 'upi_qr';

    render(
      <UpiQrPayment
        amount={999}
        onMethodChange={(m) => {
          selectedMethod = m;
        }}
        utr=""
        onUtrChange={() => {}}
      />,
    );

    const codOption = screen.getByText(
      /Standard Checkout \(Order Reservation\)/i,
    );
    await user.click(codOption);

    expect(selectedMethod).toBe('cod');
  });
});
