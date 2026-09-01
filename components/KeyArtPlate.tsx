/*
 * Key art is a typographic plate: letterforms drawn from the repository name, rules,
 * and printers ornaments, emitted as static SVG. Never photography and never
 * illustration — the subjects of these articles are real maintainers, and a generated
 * face beside a story about them is a claim the pipeline cannot verify.
 */

/** Ornament positions along the plate edge, fixed so the SVG is byte-stable per repo. */
const ORNAMENT_OFFSETS = [0.25, 0.5, 0.75] as const

/**
 * The initials a plate is set from: the owner's and the repository's first letters.
 * @param nameWithOwner - `owner/name`
 * @returns one or two uppercase letters
 * @example initialsOf('vitejs/vite') // => 'VV'
 */
export function initialsOf(nameWithOwner: string): string {
  return nameWithOwner
    .split('/')
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase())
    .filter((letter) => letter !== '')
    .join('')
}

/**
 * A build-time typographic plate for one repository. Decorative by role: the letters
 * repeat the repo name printed in the dateline, so a screen reader gains nothing.
 * @param nameWithOwner - `owner/name` from the fact-set
 * @example <KeyArtPlate nameWithOwner="vitejs/vite" />
 */
export function KeyArtPlate({ nameWithOwner }: { nameWithOwner: string }) {
  const initials = initialsOf(nameWithOwner)
  return (
    <svg
      viewBox="0 0 200 200"
      role="presentation"
      aria-hidden="true"
      className="h-auto w-full max-w-[220px] border border-rule"
    >
      <rect x="0" y="0" width="200" height="200" fill="var(--paper)" />
      <rect x="8" y="8" width="184" height="184" fill="none" stroke="var(--rule)" strokeWidth="1" />
      <text
        x="100"
        y="118"
        textAnchor="middle"
        fill="var(--ink)"
        style={{ fontFamily: 'var(--font-display)', fontSize: '86px', letterSpacing: '-2px' }}
      >
        {initials}
      </text>
      <line x1="24" y1="150" x2="176" y2="150" stroke="var(--rule)" strokeWidth="1" />
      {ORNAMENT_OFFSETS.map((offset) => (
        <circle key={offset} cx={24 + 152 * offset} cy="162" r="2" fill="var(--rule)" />
      ))}
    </svg>
  )
}
