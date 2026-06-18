/**
 * Gide-on wordmark — pure CSS, scalable, theme-aware.
 *
 * Brand: Gide [⬤——] on    (pomlčka = UI switch v poloze ON)
 *
 * Použití:
 *   <GideonWordmark size="md" />          // default = ink/cream dle tématu
 *   <GideonWordmark size="lg" variant="signal" />
 *   <GideonWordmark size="xs" variant="reverse" />   // pro tmavé bg
 *
 * Anatomie (z brandbook.css):
 *   font:           Space Grotesk Bold 700
 *   letter-spacing: −0.038em
 *   switch.height = cap-height (0.72 × font-size)
 *   switch.width  = 1.85 × switch.height
 *   knob:           0.72 × switch.height (kruh vpravo)
 *
 * Zdroj: brand book /docs/03-LOGO.md
 */

type Size = "tiny" | "xs" | "sm" | "md" | "lg" | "xl" | "hero" | "cover";
type Variant = "primary" | "reverse" | "signal" | "mono-ink" | "mono-cream";

const SIZE_PX: Record<Size, number> = {
  tiny: 14,
  xs: 20,
  sm: 32,
  md: 64,
  lg: 96,
  xl: 120,
  hero: 180,
  cover: 260,
};

interface Props {
  size?: Size;
  variant?: Variant;
  className?: string;
  /** Pokud true, wordmark se chová jako link na /start. */
  asLink?: boolean;
  /** Aria label — defaultně „Gide-on, průvodce zapnutý". */
  ariaLabel?: string;
}

export default function GideonWordmark({
  size = "md",
  variant = "primary",
  className = "",
  asLink = false,
  ariaLabel = "Gide-on",
}: Props) {
  const fontSize = SIZE_PX[size];

  // Variant → CSS proměnné pro text barvu + toggle track/knob.
  // Primary = auto z theme (foreground text, signal toggle).
  // Reverse = inverted (cream text, signal toggle) — pro tmavé bg manuálně.
  // Signal = celé wordmark v Signal Coral (expressivní použití).
  // Mono = jedna barva (ink nebo cream).
  let textColor = "var(--foreground)";
  let trackColor = "var(--c-signal)";
  let knobColor = "var(--c-cream)";

  if (variant === "reverse") {
    textColor = "var(--c-cream)";
    trackColor = "var(--c-signal)";
    knobColor = "var(--c-cream)";
  } else if (variant === "signal") {
    textColor = "var(--c-signal)";
    trackColor = "var(--c-signal)";
    knobColor = "var(--c-cream)";
  } else if (variant === "mono-ink") {
    textColor = "var(--c-ink)";
    trackColor = "var(--c-ink)";
    knobColor = "var(--c-cream)";
  } else if (variant === "mono-cream") {
    textColor = "var(--c-cream)";
    trackColor = "var(--c-cream)";
    knobColor = "var(--c-ink)";
  }

  const wordmarkStyle: React.CSSProperties = {
    fontSize: `${fontSize}px`,
    color: textColor,
    fontFamily: "var(--font-sans)",
    fontWeight: 700,
    letterSpacing: "-0.038em",
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "baseline",
    gap: "0.12em",
    whiteSpace: "nowrap",
  };

  // Switch — sedí na cap-height (0.72em)
  const toggleStyle: React.CSSProperties = {
    display: "inline-block",
    width: `${0.72 * 1.85}em`,
    height: "0.72em",
    borderRadius: "999px",
    position: "relative",
    background: trackColor,
    flex: "none",
  };
  // Knob — vpravo (ON pozice)
  const knobStyle: React.CSSProperties = {
    content: '""',
    position: "absolute",
    width: `${0.72 * 0.72}em`,
    height: `${0.72 * 0.72}em`,
    borderRadius: "50%",
    right: `${0.72 * 0.14}em`,
    top: `${0.72 * 0.14}em`,
    background: knobColor,
  };

  const content = (
    <span
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={wordmarkStyle}
    >
      <span>Gide</span>
      <span style={toggleStyle}>
        <span style={knobStyle} aria-hidden="true" />
      </span>
      <span>on</span>
    </span>
  );

  if (asLink) {
    return (
      <a href="/start" className="inline-block transition-opacity hover:opacity-80">
        {content}
      </a>
    );
  }
  return content;
}
