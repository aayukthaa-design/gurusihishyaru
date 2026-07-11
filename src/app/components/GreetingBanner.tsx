import { useGreeting } from '../hooks/useGreeting';
import { BrandLogo } from './BrandLogo';

interface GreetingBannerProps {
  /** User's display name — first name shown in the greeting */
  name: string;
  /** Optional subtitle line (role, class, etc.) */
  subtitle?: string;
}

export function GreetingBanner({ name, subtitle }: GreetingBannerProps) {
  const { greeting, dateLabel, timeLabel } = useGreeting();

  const firstName = name.split(' ')[0];

  return (
    <div
      className="relative overflow-hidden rounded-2xl px-8 py-6 text-white"
      style={{
        background: greeting.gradient,
        // Fade-in animation on mount
        animation: 'greetingFadeIn 0.6s ease-out both',
      }}
    >
      {/* ── Dot-grid overlay ── */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `radial-gradient(circle, ${greeting.glowColor} 1.5px, transparent 1.5px)`,
          backgroundSize: '28px 28px',
        }}
      />

      {/* ── Logo watermark ── */}
      <div className="absolute -right-2 -top-2 opacity-[0.08] pointer-events-none select-none">
        <BrandLogo height={160} />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col gap-1">
        {/* Greeting line */}
        <div className="flex items-center gap-2">
          <span
            className="text-3xl leading-none"
            role="img"
            aria-label={greeting.text}
            style={{ animation: 'greetingIconBounce 0.7s ease-out 0.3s both' }}
          >
            {greeting.icon}
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {greeting.text}, {firstName}!
          </h1>
        </div>

        {/* Sub-line */}
        <p className="text-sm font-medium text-white/80 mt-0.5">
          Welcome back to Guru Shishyaru Tutorials
        </p>

        {/* Optional role/context line */}
        {subtitle && (
          <p className="text-xs text-white/60 mt-0.5">{subtitle}</p>
        )}

        {/* Date + time badge */}
        <div className="mt-3 flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}
          >
            📅 {dateLabel}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}
          >
            🕐 {timeLabel}
          </span>
        </div>
      </div>

      {/* ── Keyframe styles ── */}
      <style>{`
        @keyframes greetingFadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes greetingIconBounce {
          0%   { transform: scale(0.5) rotate(-10deg); opacity: 0; }
          60%  { transform: scale(1.2) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
