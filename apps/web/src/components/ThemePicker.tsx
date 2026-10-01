import { Check, MonitorCog } from 'lucide-react';
import { SONALIT_THEMES } from '../stores/theme.js';
import { useUIStore } from '../stores/ui.js';

export function ThemePicker() {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);

  return (
    <div className="sonalit-theme-picker" aria-label="Sonalit appearance themes">
      <div className="sonalit-theme-picker__intro">
        <p className="text-sm font-semibold">Control-room theme</p>
        <p className="text-xs text-slate-400">
          Presentation only. Fleet state, telemetry, permissions and operational workflows remain unchanged.
        </p>
      </div>

      <div className="sonalit-theme-picker__grid" role="radiogroup" aria-label="Sonalit interface theme">
        {SONALIT_THEMES.map((option) => {
          const active = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.name}
              data-active={active}
              className="sonalit-theme-option"
              onClick={() => setTheme(option.id)}
            >
              <span className="sonalit-theme-option__preview" aria-hidden="true">
                {option.preview.map((swatch) => <span key={swatch} className="sonalit-theme-option__swatch" style={{ backgroundColor: swatch }} />)}
              </span>
              <span className="sonalit-theme-option__copy">
                <span className="sonalit-theme-option__name">{option.name}</span>
                <span className="sonalit-theme-option__description">{option.description}</span>
              </span>
              <span className="sonalit-theme-option__check" aria-hidden="true">
                {active && <Check size={14} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sonalit-theme-picker__status" aria-live="polite">
        <MonitorCog size={15} aria-hidden="true" />
        <span>Active: {SONALIT_THEMES.find((option) => option.id === theme)?.name ?? 'Obsidian Command'} · saved on this device</span>
      </div>
    </div>
  );
}
