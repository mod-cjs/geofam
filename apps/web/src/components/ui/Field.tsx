"use client";

/**
 * A-02 + A-03 + A-04 + A-05 — Field (Input / Select / Textarea / Checkbox / Radio / Switch)
 *
 * Règles non négociables :
 * - Validation UNIQUEMENT on-blur — jamais pendant la frappe
 * - États : défaut · focus · rempli valide · validé on-blur (Check) · erreur rouge · avertissement orange · disabled
 * - Labels obligatoires (a11y)
 * - 218 champs métier = dérivés depuis ENGINE_DESCRIPTORS (Lot 3 — combinatoire Code)
 */

import { AlertCircle, Check, ChevronDown } from "lucide-react";
import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
  useState,
} from "react";

/* ------------------------------------------------------------------ */
/* Types partagés                                                       */
/* ------------------------------------------------------------------ */

export type FieldState = "default" | "valid" | "error" | "warning" | "disabled";

interface FieldWrapperProps {
  label: string;
  id: string;
  required?: boolean;
  hint?: string;
  unit?: string;
  error?: string;
  warning?: string;
  state?: FieldState;
  children: ReactNode;
}

/* ------------------------------------------------------------------ */
/* Wrapper commun label + message                                       */
/* ------------------------------------------------------------------ */

function FieldWrapper({
  label,
  id,
  required,
  hint,
  unit,
  error,
  warning,
  state,
  children,
}: FieldWrapperProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* Label */}
      <label
        htmlFor={id}
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: state === "disabled" ? "var(--text-muted)" : "var(--text-secondary)",
          lineHeight: 1.4,
        }}
      >
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: "var(--status-fail-tx)", marginLeft: 2 }}>
            *
          </span>
        )}
        {unit && (
          <span
            style={{ marginLeft: 4, color: "var(--text-muted)", fontWeight: 400 }}
          >
            ({unit})
          </span>
        )}
      </label>

      {/* Champ + icône d'état */}
      <div style={{ position: "relative" }}>
        {children}

        {/* Icône d'état (on-blur) */}
        {state === "valid" && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--status-pass-tx)",
              display: "flex",
              animation: `rds-fade-in var(--dur-fast) var(--ease-entrance)`,
            }}
          >
            <Check size={16} strokeWidth={1.5} />
          </span>
        )}
        {state === "error" && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--status-fail-tx)",
              display: "flex",
              animation: `rds-fade-in var(--dur-fast) var(--ease-entrance)`,
            }}
          >
            <AlertCircle size={16} strokeWidth={1.5} />
          </span>
        )}
        {state === "warning" && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#b45309",
              display: "flex",
            }}
          >
            <AlertCircle size={16} strokeWidth={1.5} />
          </span>
        )}
      </div>

      {/* Aide contextuelle */}
      {hint && !error && !warning && (
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>{hint}</p>
      )}

      {/* Message erreur (on-blur) */}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          style={{
            fontSize: 12,
            color: "var(--status-fail-tx)",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            animation: `rds-fade-in var(--dur-fast) var(--ease-entrance)`,
          }}
        >
          {error}
        </p>
      )}

      {/* Message avertissement (hors plage physique — bouton reste actif) */}
      {warning && !error && (
        <p
          id={`${id}-warning`}
          style={{
            fontSize: 12,
            color: "#92400e",
            margin: 0,
          }}
        >
          {warning}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Input texte                                                          */
/* ------------------------------------------------------------------ */

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  id: string;
  unit?: string;
  hint?: string;
  error?: string;
  warning?: string;
  fieldState?: FieldState;
  onValidate?: (value: string) => { error?: string; warning?: string } | void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    id,
    unit,
    hint,
    error: externalError,
    warning: externalWarning,
    fieldState: externalState,
    onValidate,
    disabled,
    required,
    ...rest
  },
  ref
) {
  const [internalError, setInternalError] = useState<string | undefined>();
  const [internalWarning, setInternalWarning] = useState<string | undefined>();
  const [touched, setTouched] = useState(false);

  const error = externalError ?? internalError;
  const warning = externalWarning ?? internalWarning;

  let state: FieldState = externalState ?? "default";
  if (disabled) state = "disabled";
  else if (error) state = "error";
  else if (warning) state = "warning";
  else if (touched && !error && !warning && rest.value !== "" && rest.value !== undefined)
    state = "valid";

  const borderColor =
    state === "error"
      ? "var(--status-fail-tx)"
      : state === "warning"
        ? "#b45309"
        : state === "valid"
          ? "var(--status-pass-tx)"
          : "var(--border-default)";

  return (
    <FieldWrapper
      label={label}
      id={id}
      required={required}
      hint={hint}
      unit={unit}
      error={error}
      warning={warning}
      state={state}
    >
      <input
        {...rest}
        ref={ref}
        id={id}
        disabled={disabled}
        required={required}
        aria-invalid={state === "error" ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : warning ? `${id}-warning` : undefined}
        style={{
          width: "100%",
          height: 38,
          padding: state === "error" || state === "valid" || state === "warning"
            ? "0 36px 0 12px"
            : "0 12px",
          borderRadius: "var(--radius-base)",
          border: `1px solid ${borderColor}`,
          background: disabled ? "var(--color-alt, #eef0f1)" : "var(--surface-base)",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          color: disabled ? "var(--text-muted)" : "var(--text-primary)",
          outline: "none",
          transition: `border-color var(--dur-fast) var(--ease-state), box-shadow var(--dur-fast) var(--ease-state)`,
          cursor: disabled ? "not-allowed" : "text",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--accent-action)";
          e.currentTarget.style.boxShadow = "0 0 0 3px rgba(160,82,38,0.12)";
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "";
          e.currentTarget.style.boxShadow = "";
          setTouched(true);
          if (onValidate) {
            const result = onValidate(e.currentTarget.value);
            if (result) {
              setInternalError(result.error);
              setInternalWarning(result.warning);
            }
          }
          rest.onBlur?.(e);
        }}
      />
    </FieldWrapper>
  );
});

/* ------------------------------------------------------------------ */
/* Select                                                               */
/* ------------------------------------------------------------------ */

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  fieldState?: FieldState;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, id, hint, error, fieldState, disabled, required, children, ...rest },
  ref
) {
  const [focused, setFocused] = useState(false);

  let state: FieldState = fieldState ?? "default";
  if (disabled) state = "disabled";
  else if (error) state = "error";

  return (
    <FieldWrapper
      label={label}
      id={id}
      required={required}
      hint={hint}
      error={error}
      state={state}
    >
      <div style={{ position: "relative" }}>
        <select
          {...rest}
          ref={ref}
          id={id}
          disabled={disabled}
          required={required}
          aria-invalid={state === "error" ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          style={{
            width: "100%",
            height: 38,
            padding: "0 36px 0 12px",
            borderRadius: "var(--radius-base)",
            border: `1px solid ${state === "error" ? "var(--status-fail-tx)" : focused ? "var(--accent-action)" : "var(--border-default)"}`,
            background: disabled ? "var(--color-alt, #eef0f1)" : "var(--surface-base)",
            fontFamily: "var(--font-sans)",
            fontSize: 14,
            color: disabled ? "var(--text-muted)" : "var(--text-primary)",
            outline: "none",
            appearance: "none",
            cursor: disabled ? "not-allowed" : "pointer",
            boxShadow: focused ? "0 0 0 3px rgba(160,82,38,0.12)" : undefined,
            transition: `border-color var(--dur-fast) var(--ease-state), box-shadow var(--dur-fast) var(--ease-state)`,
          }}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        >
          {children}
        </select>
        {/* Chevron */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-muted)",
            display: "flex",
            pointerEvents: "none",
          }}
        >
          <ChevronDown size={16} strokeWidth={1.5} />
        </span>
      </div>
    </FieldWrapper>
  );
});

/* ------------------------------------------------------------------ */
/* Textarea                                                             */
/* ------------------------------------------------------------------ */

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  fieldState?: FieldState;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, id, hint, error, fieldState, disabled, required, ...rest },
  ref
) {
  const [focused, setFocused] = useState(false);

  let state: FieldState = fieldState ?? "default";
  if (disabled) state = "disabled";
  else if (error) state = "error";

  return (
    <FieldWrapper
      label={label}
      id={id}
      required={required}
      hint={hint}
      error={error}
      state={state}
    >
      <textarea
        {...rest}
        ref={ref}
        id={id}
        disabled={disabled}
        required={required}
        aria-invalid={state === "error" ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        style={{
          width: "100%",
          minHeight: 88,
          padding: "10px 12px",
          borderRadius: "var(--radius-base)",
          border: `1px solid ${state === "error" ? "var(--status-fail-tx)" : focused ? "var(--accent-action)" : "var(--border-default)"}`,
          background: disabled ? "var(--color-alt, #eef0f1)" : "var(--surface-base)",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          color: disabled ? "var(--text-muted)" : "var(--text-primary)",
          outline: "none",
          resize: "vertical",
          cursor: disabled ? "not-allowed" : "text",
          boxShadow: focused ? "0 0 0 3px rgba(160,82,38,0.12)" : undefined,
          transition: `border-color var(--dur-fast) var(--ease-state), box-shadow var(--dur-fast) var(--ease-state)`,
        }}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
      />
    </FieldWrapper>
  );
});

/* ------------------------------------------------------------------ */
/* Checkbox                                                             */
/* ------------------------------------------------------------------ */

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: string;
  id: string;
  indeterminate?: boolean;
  error?: string;
}

export function Checkbox({ label, id, indeterminate, error, disabled, ...rest }: CheckboxProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <input
        {...rest}
        type="checkbox"
        id={id}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate ?? false;
        }}
        style={{
          width: 16,
          height: 16,
          marginTop: 2,
          accentColor: "var(--accent-action)",
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      />
      <label
        htmlFor={id}
        style={{
          fontSize: 14,
          color: disabled ? "var(--text-muted)" : "var(--text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
          lineHeight: 1.5,
        }}
      >
        {label}
      </label>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          style={{ fontSize: 12, color: "var(--status-fail-tx)", margin: 0 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Radio                                                                */
/* ------------------------------------------------------------------ */

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: string;
  id: string;
}

export function Radio({ label, id, disabled, ...rest }: RadioProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input
        {...rest}
        type="radio"
        id={id}
        disabled={disabled}
        style={{
          width: 16,
          height: 16,
          accentColor: "var(--accent-action)",
          cursor: disabled ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      />
      <label
        htmlFor={id}
        style={{
          fontSize: 14,
          color: disabled ? "var(--text-muted)" : "var(--text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {label}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Switch                                                               */
/* ------------------------------------------------------------------ */

interface SwitchProps {
  label: string;
  id: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, id, checked = false, onChange, disabled }: SwitchProps) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10 }}
      role="group"
    >
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: 36,
          height: 20,
          borderRadius: 10,
          padding: "0 2px",
          border: "none",
          background: checked ? "var(--accent-action)" : "var(--border-default)",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: `background-color var(--dur-fast) var(--ease-state)`,
          opacity: disabled ? 0.55 : 1,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "block",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            transform: checked ? "translateX(16px)" : "translateX(0)",
            transition: `transform var(--dur-fast) var(--ease-state)`,
          }}
        />
      </button>
      <label
        htmlFor={id}
        style={{
          fontSize: 14,
          color: disabled ? "var(--text-muted)" : "var(--text-primary)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {label}
      </label>
    </div>
  );
}

/* Inject fade-in keyframe */
if (typeof document !== "undefined") {
  const id = "__rds-fade-in";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `@keyframes rds-fade-in{from{opacity:0}to{opacity:1}}`;
    document.head.appendChild(style);
  }
}
