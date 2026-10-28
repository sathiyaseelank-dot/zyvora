import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PolicyPage } from '../src/pages/PolicyPage';
import { FaqPage } from '../src/pages/FaqPage';
import { ContactPage } from '../src/pages/ContactPage';
import { AboutPage } from '../src/pages/AboutPage';

describe('Policy, Brand and Support Pages (ZYV-102, ZYV-103, ZYV-104, ZYV-111, ZYV-114, ZYV-115, ZYV-117, ZYV-118, ZYV-119)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('PolicyPage', () => {
    it('renders shipping policy with fallback content and business transparency notice', async () => {
      render(
        <MemoryRouter>
          <PolicyPage slug="shipping-policy" />
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: /Shipping Policy/i,
        }),
      ).toBeTruthy();
      expect(screen.getByText(/Business Transparency Notice/i)).toBeTruthy();
      expect(
        screen.getByText(/\[GSTIN: Pending State Tax Registration\]/i),
      ).toBeTruthy();
      expect(screen.getByText(/Chennai, Tamil Nadu, India/i)).toBeTruthy();
    });

    it('renders cancellation policy', async () => {
      render(
        <MemoryRouter>
          <PolicyPage slug="cancellation-policy" />
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: /Cancellation Policy/i,
        }),
      ).toBeTruthy();
      expect(screen.getByText(/Cancellation Before Dispatch/i)).toBeTruthy();
    });

    it('renders return and refund policy', async () => {
      render(
        <MemoryRouter>
          <PolicyPage slug="return-refund-policy" />
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: /Return & Refund Policy/i,
        }),
      ).toBeTruthy();
      expect(screen.getByText(/7-Day Return Window/i)).toBeTruthy();
    });

    it('renders privacy policy', async () => {
      render(
        <MemoryRouter>
          <PolicyPage slug="privacy-policy" />
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: /Privacy Policy/i,
        }),
      ).toBeTruthy();
      expect(screen.getByText(/Data Collection and Purpose/i)).toBeTruthy();
    });

    it('renders terms and conditions', async () => {
      render(
        <MemoryRouter>
          <PolicyPage slug="terms-and-conditions" />
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: /Terms and Conditions/i,
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(/Quality \| Style \| For Your World/i),
      ).toBeTruthy();
    });
  });

  describe('FaqPage (ZYV-102)', () => {
    it('renders FAQ questions and categories', () => {
      render(
        <MemoryRouter>
          <FaqPage />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /Frequently Asked Questions/i,
        }),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: /^All$/i })).toBeTruthy();
      expect(screen.getByPlaceholderText(/Search questions/i)).toBeTruthy();
    });

    it('filters FAQs by search input', () => {
      render(
        <MemoryRouter>
          <FaqPage />
        </MemoryRouter>,
      );

      const searchInput = screen.getByPlaceholderText(/Search questions/i);
      fireEvent.change(searchInput, { target: { value: 'monsoon' } });

      expect(
        screen.getByText(/Are the mounting clips and hardware rust-proof\?/i),
      ).toBeTruthy();
    });

    it('toggles accordion answer on click', () => {
      render(
        <MemoryRouter>
          <FaqPage />
        </MemoryRouter>,
      );

      const questionBtn = screen.getByRole('button', {
        name: /How are ZYVORA flags tested for high-speed wind resistance\?/i,
      });
      expect(questionBtn).toBeTruthy();

      expect(
        screen.getByText(/rigorous road testing at speeds up to 120 km\/h/i),
      ).toBeTruthy();
    });
  });

  describe('ContactPage (ZYV-103, ZYV-117)', () => {
    it('renders contact details, honest placeholders, and submits inquiry form', async () => {
      render(
        <MemoryRouter>
          <ContactPage />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole('heading', {
          level: 1,
          name: /Get in touch with GrownLeaf/i,
        }),
      ).toBeTruthy();
      expect(screen.getByText(/support@zyvora.com/i)).toBeTruthy();
      expect(
        screen.getByText(/\[Support Phone: Pending Official Helpline Setup\]/i),
      ).toBeTruthy();

      fireEvent.change(screen.getByLabelText(/Full Name \*/i), {
        target: { value: 'Rajesh Kumar' },
      });
      fireEvent.change(screen.getByLabelText(/Email Address \*/i), {
        target: { value: 'rajesh@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/Subject \*/i), {
        target: { value: 'Car flag fitment query' },
      });
      fireEvent.change(screen.getByLabelText(/Message \*/i), {
        target: { value: 'Will this fit a 2024 Thar window glass?' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Submit Inquiry/i }));

      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(
        screen.getByText(/Thank you for reaching out, Rajesh Kumar!/i),
      ).toBeTruthy();
    });
  });

  describe('AboutPage (ZYV-104, ZYV-117)', () => {
    it('renders brand craft story, specifications and business transparency', () => {
      render(
        <MemoryRouter>
          <AboutPage />
        </MemoryRouter>,
      );

      expect(
        screen.getByRole('heading', { level: 1, name: /Made for the road/i }),
      ).toBeTruthy();
      expect(
        screen.getByText(/Company & Registration Transparency/i),
      ).toBeTruthy();
      expect(
        screen.getByText(/Quality \| Style \| For Your World/i),
      ).toBeTruthy();
      expect(
        screen.getByText(/UV-stabilised polyester, 110 gsm/i),
      ).toBeTruthy();
      expect(screen.getByText(/Tested to 120 km\/h/i)).toBeTruthy();
    });
  });
});
