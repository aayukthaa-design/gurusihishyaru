/**
 * BrandLogo — uses the exact uploaded Guru Shishyaru Tutorials logo image.
 * The image must be placed at: public/logo.png
 *
 * Props:
 *   height        — pixel height of the logo image (width is auto)
 *   showName      — show "GURU SHISHYARU TUTORIALS" text beside the logo
 *   showTagline   — show the tagline below the name (requires showName)
 *   layout        — 'row' (default) | 'column'
 *   className     — wrapper class
 *   invertForDark — apply brightness invert on dark backgrounds (default false)
 */

interface BrandLogoProps {
  height?: number;
  showName?: boolean;
  showTagline?: boolean;
  layout?: 'row' | 'column';
  className?: string;
  /** Set to true when the logo is placed on a dark/colored background */
  lightMode?: boolean;
}

export function BrandLogo({
  height = 40,
  showName = false,
  showTagline = false,
  layout = 'row',
  className = '',
  lightMode = false,
}: BrandLogoProps) {
  const isRow = layout === 'row';

  return (
    <div
      className={`flex ${
        isRow ? 'flex-row items-center' : 'flex-col items-center'
      } gap-3 ${className}`}
    >
      {/* ── Official Logo Image ── */}
      <img
        src="/logo.jpeg"
        alt="Guru Shishyaru Tutorials Logo"
        height={height}
        style={{
          height: `${height}px`,
          width: 'auto',
          objectFit: 'contain',
          display: 'block',
          // Apply slight brightness boost on dark backgrounds so the logo reads clearly
          filter: lightMode ? 'brightness(1.05)' : undefined,
        }}
        draggable={false}
      />

      {/* ── Brand Name ── */}
      {showName && (
        <div className={isRow ? 'text-left' : 'text-center'}>
          <p
            className="font-bold leading-tight tracking-tight text-foreground"
            style={{ fontSize: Math.max(height * 0.32, 11) }}
          >
            GURU SHISHYARU
          </p>
          <p
            className="font-semibold leading-none tracking-widest text-foreground opacity-75"
            style={{ fontSize: Math.max(height * 0.22, 9) }}
          >
            TUTORIALS
          </p>
          {showTagline && (
            <p
              className="mt-1 leading-snug text-muted-foreground"
              style={{ fontSize: Math.max(height * 0.16, 8), maxWidth: height * 5 }}
            >
              Rooted in Knowledge, Growing Towards Excellence
            </p>
          )}
        </div>
      )}
    </div>
  );
}
