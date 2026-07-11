import { useState, useEffect } from 'react';

// ─── Greeting config ──────────────────────────────────────────────────────────

export interface Greeting {
  icon: string;
  text: string;
  /** 0–23 hour range this greeting covers */
  from: number;
  to: number;
  /** Tailwind gradient for the banner */
  gradient: string;
  /** Subtle glow color for the dot-grid overlay */
  glowColor: string;
}

const GREETINGS: Greeting[] = [
  {
    icon: '🌅',
    text: 'Good Morning',
    from: 5,
    to: 11,
    gradient: 'linear-gradient(135deg, #14532D 0%, #166534 50%, #854D0E 100%)',
    glowColor: '#86EFAC',
  },
  {
    icon: '☀️',
    text: 'Good Afternoon',
    from: 12,
    to: 16,
    gradient: 'linear-gradient(135deg, #78350F 0%, #B45309 45%, #14532D 100%)',
    glowColor: '#FDE68A',
  },
  {
    icon: '🌇',
    text: 'Good Evening',
    from: 17,
    to: 20,
    gradient: 'linear-gradient(135deg, #7C2D12 0%, #9A3412 45%, #1C1917 100%)',
    glowColor: '#FDBA74',
  },
  {
    icon: '🌙',
    text: 'Good Night',
    from: 21,
    to: 4,   // wraps midnight
    gradient: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F2720 100%)',
    glowColor: '#BAE6FD',
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function getGreetingForHour(hour: number): Greeting {
  // Night wraps midnight (21–04), handle it first
  const night = GREETINGS[3];
  if (hour >= night.from || hour <= night.to) return night;

  return (
    GREETINGS.find((g) => g.from !== 21 && hour >= g.from && hour <= g.to) ??
    GREETINGS[0]
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface GreetingState {
  greeting: Greeting;
  /** Current hour (0–23) from the user's local device clock */
  hour: number;
  /** e.g. "Friday, June 19, 2026" */
  dateLabel: string;
  /** e.g. "10:45 AM" */
  timeLabel: string;
}

export function useGreeting(): GreetingState {
  const getState = (): GreetingState => {
    const now  = new Date();
    const hour = now.getHours(); // uses browser local timezone automatically

    const dateLabel = now.toLocaleDateString(undefined, {
      weekday: 'long',
      year:    'numeric',
      month:   'long',
      day:     'numeric',
    });

    const timeLabel = now.toLocaleTimeString(undefined, {
      hour:   '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    return {
      greeting: getGreetingForHour(hour),
      hour,
      dateLabel,
      timeLabel,
    };
  };

  const [state, setState] = useState<GreetingState>(getState);

  // Re-evaluate every minute so greeting updates without reload
  useEffect(() => {
    const id = setInterval(() => setState(getState()), 60_000);
    return () => clearInterval(id);
  }, []);

  return state;
}
