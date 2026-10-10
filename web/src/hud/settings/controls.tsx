import type { ReactNode } from "react";

/** An on/off row: label and hint on the left, the switch (with a finger-sized hit area) on the right. */
export function Switch({
  label,
  hint,
  on,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  on: boolean;
  disabled?: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <div className={`setting-row${disabled ? " disabled" : ""}`}>
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <button type="button" role="switch" className="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}

/** Native radios (arrow keys move between them), drawn as a segmented control. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(v: T): void;
}) {
  const name = `setting-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <fieldset className="segmented setting-choice">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? "checked" : undefined}>
          <input type="radio" className="choice-input" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

/** A label and hint above a control that needs the panel's full width (choices, sliders, times). */
export function Labeled({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="setting-row">
        <div className="setting-text">
          <span className="setting-label">{label}</span>
          {hint && <span className="setting-hint">{hint}</span>}
        </div>
      </div>
      {children}
    </>
  );
}
