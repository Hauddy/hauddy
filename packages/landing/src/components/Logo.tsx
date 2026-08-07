/** Hauddy mark: two contacts linked by an arc. The arc dash-draws itself in
 *  when `drawn` flips true (caller gates it on mount + reduced-motion).
 *  Canonical asset: @hauddy/web-tokens/logo.svg. */
export default function Logo({ size = 24, drawn = true }: { size?: number; drawn?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="hauddy"
      style={{ flex: 'none', display: 'block' }}
    >
      <circle cx="10" cy="27" r="6.5" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
      <circle cx="38" cy="27" r="6.5" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
      <path
        d="M14.2 22 Q24 12 33.8 22"
        fill="none"
        stroke="#6FA06A"
        strokeWidth="3.5"
        strokeLinecap="round"
        className={`logo-arc${drawn ? ' drawn' : ''}`}
      />
    </svg>
  );
}
