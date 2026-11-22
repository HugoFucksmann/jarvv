import type React from "react";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";

export const INPUT_BASE =
  "w-full bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent-500/70 focus:ring-2 focus:ring-accent-500/20 transition-colors text-xs";

export const SectionHeader: React.FC<{
  title: string;
  description?: string;
}> = ({ title, description }) => (
  <div className="flex flex-col gap-0.5 pb-3 border-b border-slate-800/80">
    <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
    {description && <p className="text-xs text-slate-400 leading-relaxed">{description}</p>}
  </div>
);

export const GroupHeading: React.FC<{
  title: string;
  subtitle?: string;
}> = ({ title, subtitle }) => (
  <div className="flex items-baseline justify-between gap-2 pt-1">
    <span className="text-xs font-semibold text-slate-200">{title}</span>
    {subtitle && <span className="text-[11px] text-slate-500">{subtitle}</span>}
  </div>
);

export type ToggleTone = "accent" | "emerald" | "yellow";

const TONE_TRACK: Record<ToggleTone, string> = {
  accent: "bg-accent-500 border-accent-400",
  emerald: "bg-emerald-500 border-emerald-400",
  yellow: "bg-yellow-500 border-yellow-400",
};

const TONE_LABEL: Record<ToggleTone, string> = {
  accent: "text-accent-300",
  emerald: "text-emerald-300",
  yellow: "text-yellow-300",
};

interface ToggleRowProps {
  id: string;
  title: string;
  codeKey?: string;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  tone?: ToggleTone;
  statusText?: { on: string; off: string };
}

export const ToggleRow: React.FC<ToggleRowProps> = ({
  id,
  title,
  codeKey,
  description,
  checked,
  onChange,
  tone = "accent",
  statusText,
}) => (
  <div className="flex items-start justify-between gap-4 p-3 rounded-lg bg-slate-950/70 border border-slate-800/90 hover:border-slate-700/80 transition-colors">
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor={id} className="text-xs font-semibold text-slate-100 cursor-pointer">
          {title}
        </label>
        {codeKey && <span className="text-[11px] font-mono text-slate-500">({codeKey})</span>}
        {statusText && (
          <span
            className={`text-[11px] font-medium ${checked ? TONE_LABEL[tone] : "text-slate-500"}`}
          >
            · {checked ? statusText.on : statusText.off}
          </span>
        )}
      </div>
      {description && <p className="text-xs text-slate-400 leading-relaxed">{description}</p>}
    </div>

    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors cursor-pointer mt-0.5 ${
        checked ? TONE_TRACK[tone] : "bg-slate-800 border-slate-700"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 rounded-full bg-slate-950 transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  </div>
);

interface TextFieldProps {
  id: string;
  label: string;
  value?: string;
  placeholder: string;
  hint?: string;
  mono?: boolean;
  onChange: (value: string) => void;
}

export const TextField: React.FC<TextFieldProps> = ({
  id,
  label,
  value,
  placeholder,
  hint,
  mono = true,
  onChange,
}) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-xs font-medium text-slate-300">
      {label}
    </label>
    <input
      id={id}
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`px-3 py-2 ${INPUT_BASE} ${mono ? "font-mono" : ""}`}
    />
    {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
  </div>
);

interface UrlFieldProps {
  id: string;
  label: string;
  value?: string;
  placeholder: string;
  onChange: (value: string) => void;
}

export const UrlField: React.FC<UrlFieldProps> = ({ id, label, value, placeholder, onChange }) => {
  const configured = Boolean(value && value.trim());
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">
          {label}
        </label>
        <span className={`text-[11px] ${configured ? "text-emerald-400" : "text-yellow-400"}`}>
          {configured ? "Configurado" : "Pendiente"}
        </span>
      </div>
      <input
        id={id}
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`px-3 py-2 ${INPUT_BASE} font-mono`}
      />
    </div>
  );
};

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min?: number;
  unit?: string;
  hint?: string;
  onChange: (value: number) => void;
  onValidityChange?: (id: string, isValid: boolean) => void;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  id,
  label,
  value,
  min = 1,
  unit,
  hint,
  onChange,
  onValidityChange,
}) => {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText((current) => {
      const parsed = Number(current);
      return current.trim() !== "" && Number.isInteger(parsed) && parsed === value
        ? current
        : String(value);
    });
  }, [value]);

  const trimmed = text.trim();
  const parsed = Number(trimmed);
  const isValid = trimmed !== "" && Number.isInteger(parsed) && parsed >= min;

  useEffect(() => {
    onValidityChange?.(id, isValid);
  }, [id, isValid, onValidityChange]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-1.5">
        <label htmlFor={id} className="text-xs text-slate-300 truncate" title={label}>
          {label}
        </label>
        {unit && <span className="text-[11px] font-mono text-slate-500 shrink-0">{unit}</span>}
      </div>
      <input
        id={id}
        type="number"
        min={min}
        step={1}
        inputMode="numeric"
        value={text}
        onChange={(e) => {
          const nextText = e.target.value;
          setText(nextText);
          const n = Number(nextText.trim());
          if (nextText.trim() !== "" && Number.isInteger(n) && n >= min) {
            onChange(n);
          }
        }}
        aria-invalid={!isValid}
        className={`px-2.5 py-1.5 ${INPUT_BASE} font-mono tabular-nums ${
          isValid ? "" : "border-rose-700 focus:border-rose-500 focus:ring-rose-500/20"
        }`}
      />
      {!isValid ? (
        <span className="text-[11px] text-rose-400">
          Ingresa un entero {min === 0 ? "≥ 0" : `≥ ${min}`}
        </span>
      ) : hint ? (
        <span className="text-[11px] text-slate-500">{hint}</span>
      ) : null}
    </div>
  );
};

export const ReadOnlyField: React.FC<{
  id: string;
  label: string;
  value: string;
  placeholder?: string;
}> = ({ id, label, value, placeholder }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-xs text-slate-400">
        {label}
      </label>
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Lock className="w-2.5 h-2.5" />
        Solo lectura
      </span>
    </div>
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      readOnly
      className="w-full px-2.5 py-1.5 bg-slate-950/50 border border-slate-800/80 rounded-lg text-slate-400 font-mono text-xs focus:outline-none select-all"
    />
  </div>
);

export const CollapsibleGroup: React.FC<{
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, defaultOpen = false, forceOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = forceOpen || open;

  return (
    <div className="rounded-lg border border-slate-800/90 bg-slate-950/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-900/60 rounded-lg transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <span className="text-xs font-semibold text-slate-200">{title}</span>
          {subtitle && <span className="text-[11px] text-slate-500">· {subtitle}</span>}
        </div>
        <span className="text-[11px] text-slate-500 shrink-0">
          {isOpen ? "Ocultar" : "Mostrar"}
        </span>
      </button>
      {isOpen && <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-800/80 flex flex-col gap-3">{children}</div>}
    </div>
  );
};
