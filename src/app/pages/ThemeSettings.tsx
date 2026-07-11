import { Header } from '../components/Header';
import { Palette, Sun, Moon, Check } from 'lucide-react';
import { useTheme, ACCENT_PRESETS } from '../contexts/ThemeContext';

export function ThemeSettings() {
  const { theme, setTheme, accentColor, setAccentColor, fontSize, setFontSize } = useTheme();

  return (
    <div className="flex-1 bg-background">
      <Header title="Theme Settings" />

      <div className="max-w-2xl mx-auto p-6 space-y-6">

        {/* ── Appearance Mode ── */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <Palette className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Appearance Mode</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {([
              { mode: 'light' as const, icon: Sun,  label: 'Light Mode', desc: 'Clean & bright' },
              { mode: 'dark'  as const, icon: Moon, label: 'Dark Mode',  desc: 'Easy on eyes'  },
            ]).map(({ mode, icon: Icon, label, desc }) => (
              <button
                key={mode}
                onClick={() => setTheme(mode)}
                className={`flex flex-col items-center gap-2.5 rounded-2xl border-2 p-5 transition-all ${
                  theme === mode
                    ? 'border-primary bg-primary/8 shadow-sm'
                    : 'border-border bg-secondary hover:border-primary/40'
                }`}
              >
                <Icon className={`h-6 w-6 ${theme === mode ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="text-center">
                  <p className={`text-sm font-semibold ${theme === mode ? 'text-primary' : 'text-foreground'}`}>
                    {label}
                  </p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                {theme === mode && (
                  <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Accent Colour ── */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground mb-1">Accent Colour</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Applies immediately to buttons, sidebar highlights, links and rings.
            Saved automatically.
          </p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {ACCENT_PRESETS.map((preset) => {
              const isActive = accentColor === preset.value;
              return (
                <button
                  key={preset.value}
                  title={preset.name}
                  onClick={() => setAccentColor(preset.value)}
                  className={`relative flex h-12 w-full items-center justify-center rounded-xl transition-all hover:scale-105 active:scale-95 ${
                    isActive ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground/30' : ''
                  }`}
                  style={{ backgroundColor: preset.value }}
                >
                  {isActive && (
                    <Check className="h-5 w-5 text-white drop-shadow" strokeWidth={3} />
                  )}
                </button>
              );
            })}
          </div>
          {/* Current selection label */}
          <p className="mt-3 text-xs text-muted-foreground">
            Selected:{' '}
            <span className="font-semibold text-foreground">
              {ACCENT_PRESETS.find((p) => p.value === accentColor)?.name ?? accentColor}
            </span>
            {' '}
            <span className="font-mono text-muted-foreground">{accentColor}</span>
          </p>
        </div>

        {/* ── Font Size ── */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold text-foreground mb-1">Font Size</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Adjusts the base font size across the entire application. Saved automatically.
          </p>

          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground w-4 text-center">A</span>
            <input
              type="range"
              min={13}
              max={20}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="flex-1 accent-primary h-2 cursor-pointer rounded-full"
            />
            <span className="text-xl text-muted-foreground w-5 text-center">A</span>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Current size: <span className="font-semibold text-foreground">{fontSize}px</span>
            </p>
            {/* Quick size buttons */}
            <div className="flex gap-2">
              {([
                { label: 'Small',   value: 13 },
                { label: 'Default', value: 16 },
                { label: 'Large',   value: 18 },
              ]).map(({ label, value }) => (
                <button
                  key={label}
                  onClick={() => setFontSize(value)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    fontSize === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-secondary text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Live preview */}
          <div className="mt-5 rounded-xl border border-border bg-secondary/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Preview
            </p>
            <p style={{ fontSize: `${fontSize}px` }} className="text-foreground leading-relaxed">
              Guru Shishyaru Tutorials — Rooted in Knowledge, Growing Towards Excellence.
            </p>
          </div>
        </div>

        {/* ── Reset ── */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Reset to Defaults</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Restores brand green accent, 16px font size, and light mode.
              </p>
            </div>
            <button
              onClick={() => {
                setTheme('light');
                setAccentColor('#15803D');
                setFontSize(16);
              }}
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary active:scale-95"
            >
              Reset
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
