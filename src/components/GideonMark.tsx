/**
 * Gide-on square/circle mark — G + switch sloupcově.
 *
 * Pro avatar, favicon, sidebar collapsed state, social profile.
 * Wordmark (GideonWordmark.tsx) je horizontální.
 *
 * Brand book → docs/03-LOGO.md:
 *   Square mark: G na vrchu, switch dole, ink/cream variants
 *   Circle mark: stejné, kulatý kontejner
 */

type Shape = "square" | "circle";
type Variant = "ink" | "cream" | "signal" | "teal";

interface Props {
  size?: number; // px
  shape?: Shape;
  variant?: Variant;
  className?: string;
}

const VARIANTS: Record<Variant, { bg: string; fg: string; switchTrack: string; switchKnob: string }> = {
  ink:    { bg: "var(--c-ink)",    fg: "var(--c-cream)",  switchTrack: "var(--c-signal)", switchKnob: "var(--c-cream)" },
  cream:  { bg: "var(--c-cream)",  fg: "var(--c-ink)",    switchTrack: "var(--c-signal)", switchKnob: "var(--c-cream)" },
  signal: { bg: "var(--c-signal)", fg: "var(--c-ink)",    switchTrack: "var(--c-ink)",    switchKnob: "var(--c-cream)" },
  teal:   { bg: "var(--c-teal)",   fg: "var(--c-cream)",  switchTrack: "var(--c-signal)", switchKnob: "var(--c-cream)" },
};

export default function GideonMark({
  size = 40,
  shape = "square",
  variant = "ink",
  className = "",
}: Props) {
  const v = VARIANTS[variant];
  const radius = shape === "circle" ? "50%" : `${size * 0.18}px`;

  return (
    <div
      role="img"
      aria-label="Gide-on"
      className={className}
      style={{
        width: size,
        height: size,
        background: v.bg,
        color: v.fg,
        borderRadius: radius,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${size * 0.06}px`,
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        letterSpacing: "-0.04em",
        flex: "none",
      }}
    >
      <span style={{ fontSize: `${size * 0.46}px`, lineHeight: 1 }}>G</span>
      <span
        style={{
          display: "inline-block",
          width: `${size * 0.16 * 1.85}px`,
          height: `${size * 0.16}px`,
          borderRadius: "999px",
          position: "relative",
          background: v.switchTrack,
        }}
        aria-hidden="true"
      >
        <span
          style={{
            position: "absolute",
            width: `${size * 0.16 * 0.72}px`,
            height: `${size * 0.16 * 0.72}px`,
            borderRadius: "50%",
            right: `${size * 0.16 * 0.14}px`,
            top: `${size * 0.16 * 0.14}px`,
            background: v.switchKnob,
          }}
        />
      </span>
    </div>
  );
}
