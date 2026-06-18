import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Gide-on Switch — UI toggle pattern (Petr 2026-06-18 redesign · fáze C).
 *
 * Brand identita = The Switch. Ten samý vizuální pattern jako wordmark
 * pomlčka, ale interaktivní (klikatelný). Použij místo checkboxů na
 * boolean nastavení.
 *
 * Proporce (z brandbook.css):
 *   width = 1.85 × height
 *   knob = 0.72 × height
 *   knob.offset = 0.14 × height (od pravého kraje když ON, levého když OFF)
 *
 * Variants color:
 *   default → ON = Signal Coral, OFF = neutral (border-300)
 *   ink     → ON = Ink (subtler, pro VIP toggles)
 *
 * Použití:
 *   <Switch checked={x} onCheckedChange={setX} label="VIP firewall" />
 */

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label?: string;
  description?: string;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "ink";
}

const SIZE_PX = {
  sm: 18,
  md: 22,
  lg: 28,
};

export const Switch = forwardRef<HTMLButtonElement, Props>(
  (
    {
      checked,
      onCheckedChange,
      label,
      description,
      size = "md",
      variant = "default",
      disabled,
      className,
      ...props
    },
    ref,
  ) => {
    const h = SIZE_PX[size];
    const w = h * 1.85;
    const knob = h * 0.72;
    const offset = h * 0.14;

    // Track color
    const onColor =
      variant === "ink" ? "var(--c-ink)" : "var(--c-signal)";
    const offColor = "var(--g-300)";
    const knobOn = "var(--c-cream)";
    const knobOff = "var(--c-cream)";

    const toggle = (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange(!checked)}
        className={cn(
          "relative shrink-0 rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          disabled && "opacity-50 cursor-not-allowed",
          !disabled && "cursor-pointer",
          className,
        )}
        style={{
          width: `${w}px`,
          height: `${h}px`,
          background: checked ? onColor : offColor,
        }}
        {...props}
      >
        <span
          aria-hidden="true"
          className="absolute rounded-full transition-transform"
          style={{
            width: `${knob}px`,
            height: `${knob}px`,
            top: `${offset}px`,
            left: checked ? `${w - knob - offset}px` : `${offset}px`,
            background: checked ? knobOn : knobOff,
          }}
        />
      </button>
    );

    if (!label && !description) return toggle;

    return (
      <label
        className={cn(
          "flex items-start gap-3 cursor-pointer",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        {toggle}
        <span className="flex flex-col gap-0.5 leading-tight">
          {label && (
            <span className="text-sm font-medium text-foreground">{label}</span>
          )}
          {description && (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </span>
      </label>
    );
  },
);
Switch.displayName = "Switch";
