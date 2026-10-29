import type { ReactNode } from 'react';
import { useId } from 'react';

/**
 * Form field primitives (ZYV-101, ZYV-54).
 *
 * The accessibility work is structural rather than cosmetic: every control is
 * wired to its label, its error and its hint through generated ids, so a
 * screen reader announces "Password, edit text, must be at least 12
 * characters" instead of an unlabelled box. Nothing here relies on
 * placeholder text as a label — placeholders vanish on focus and are
 * unreachable by several assistive technologies.
 */

const CONTROL =
  'w-full rounded-xl border bg-slate-50/70 px-3.5 py-2.5 text-[14px] text-slate-900 ' +
  'placeholder:text-slate-400 transition-all duration-150 ' +
  'focus:border-brass focus:bg-white focus:ring-2 focus:ring-brass/20 focus:outline-none';

interface FieldProps {
  label: string;
  /** Server-side message for this field, if the API named one. */
  error?: string;
  /** Client-side message, shown before a request has been made. */
  hint?: ReactNode;
  /** Renders the control itself — keeps ids and aria wiring in one place. */
  children: (ids: {
    id: string;
    describedBy?: string;
    invalid: boolean;
  }) => ReactNode;
  required?: boolean;
}

export function Field({ label, error, hint, children, required }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // Point at the error first: it is the more urgent of the two.
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold text-slate-700"
      >
        {label}
        {required ? (
          <span className="ml-1 text-brass-deep" aria-hidden="true">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>

      {children({
        id,
        describedBy: describedBy || undefined,
        invalid: Boolean(error),
      })}

      {hint ? (
        <p id={hintId} className="text-[12px] leading-relaxed text-ink-muted">
          {hint}
        </p>
      ) : null}

      {/*
        `role="alert"` so the message is announced the moment it appears.
        `aria-live` alone is not enough on a node that is inserted into the DOM
        at the same time as its text — the live region has to already exist.
      */}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-[12px] font-medium text-danger"
        >
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Shared control styling, with the invalid state applied. */
export function controlClass(invalid: boolean): string {
  return invalid
    ? `${CONTROL} border-danger focus:border-danger`
    : `${CONTROL} border-rule`;
}

interface TextFieldProps {
  label: string;
  type?: 'text' | 'email' | 'tel' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  inputMode?: 'text' | 'email' | 'tel' | 'numeric';
  maxLength?: number;
  minLength?: number;
}

export function TextField({
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  placeholder,
  error,
  hint,
  required,
  disabled,
  inputMode,
  maxLength,
  minLength,
}: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={maxLength}
          minLength={minLength}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className={controlClass(invalid)}
        />
      )}
    </Field>
  );
}
