import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PasswordField } from '../src/components/PasswordField';
import { TextField } from '../src/components/Field';

/**
 * ZYV-101 — accessibility wiring, asserted rather than assumed.
 *
 * These check the things a screenshot cannot: that the label is programmatically
 * associated with the input, that an error is announced, and that the
 * visibility toggle is a real button in the tab order.
 */
describe('PasswordField accessibility', () => {
  it('associates the label with the input', () => {
    render(<PasswordField label="Password" value="" onChange={() => {}} />);
    // getByLabelText throws if the association is missing.
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
  });

  it('toggles visibility with a real, labelled, stateful button', async () => {
    const user = userEvent.setup();
    render(
      <PasswordField label="Password" value="secret123" onChange={() => {}} />,
    );

    const input = screen.getByLabelText(/^Password/);
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: /show password/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(
      screen.getByRole('button', { name: /hide password/i }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('announces a server error and wires it to the input', () => {
    render(
      <PasswordField
        label="Password"
        value=""
        onChange={() => {}}
        error="Password is too common"
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Password is too common');

    const input = screen.getByLabelText(/^Password/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The message must be reachable from the input, not just present.
    expect(input.getAttribute('aria-describedby')).toContain(
      alert.getAttribute('id'),
    );
  });

  it('exposes the strength meter to assistive technology without chattering', () => {
    render(
      <PasswordField
        label="Password"
        value="Th1s-Is-A-Long-Passphrase!"
        onChange={() => {}}
      />,
    );
    // Referenced via aria-describedby, so it is available on demand — and not
    // a live region, which would read every strength change aloud mid-typing.
    const input = screen.getByLabelText(/^Password/);
    const described = input.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)).toHaveTextContent('Strong');
  });

  it('hides the meter on the confirmation field', () => {
    render(
      <PasswordField
        label="Confirm password"
        value="Th1s-Is-A-Long-Passphrase!"
        onChange={() => {}}
        showMeter={false}
      />,
    );
    expect(screen.queryByText('Strong')).not.toBeInTheDocument();
  });

  it('marks a required field for assistive technology, not only visually', () => {
    render(<TextField label="Email" value="" onChange={() => {}} required />);
    const input = screen.getByLabelText(/^Email/);
    expect(input).toBeRequired();
    // The asterisk is aria-hidden, so "(required)" carries the meaning.
    expect(screen.getByText('(required)')).toHaveClass('sr-only');
  });

  it('reports keystrokes to the caller', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Email" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText(/^Email/), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
