import React from 'react';
import { playUi } from './uiSounds.js';

/**
 * Setup-menu controls skinned with the EvoUI pack (bracket frames, icons,
 * interaction sounds) — dark/gritty, amber accents. The dropdown replaces the
 * native <select> so it can animate (slide+fade) and carry the pack chrome.
 */

export interface EvoOption {
  value: string;
  label: string;
}

export function EvoSelect({ value, options, onChange, id }: {
  value: string;
  options: EvoOption[];
  onChange: (value: string) => void;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // When the panel closes, pull focus off any option inside it — an element
  // keeping focus under aria-hidden trips accessibility warnings.
  React.useEffect(() => {
    if (open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.querySelector('.evo-select-panel')?.contains(active)) {
      active.blur();
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value);

  return (
    <div className={`evo-select${open ? ' open' : ''}`} ref={rootRef} id={id}>
      <button
        type="button"
        className="evo-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          playUi('click');
          setOpen(o => !o);
        }}
      >
        <span>{current?.label ?? value}</span>
        <span className="evo-arrow" aria-hidden />
      </button>
      <div className="evo-select-panel" role="listbox" aria-hidden={!open}>
        {options.map(o => (
          <button
            type="button"
            key={o.value}
            role="option"
            aria-selected={o.value === value}
            className={`evo-option${o.value === value ? ' selected' : ''}`}
            tabIndex={open ? 0 : -1}
            onPointerEnter={() => playUi('hover', 0.15)}
            onClick={() => {
              playUi('click');
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EvoCheckbox({ checked, onChange, label, id }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <label className="evo-checkbox" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={e => {
          playUi('click');
          onChange(e.target.checked);
        }}
      />
      <span className="evo-checkbox-box" aria-hidden />
      <span className="evo-checkbox-label">{label}</span>
    </label>
  );
}

export function EvoButton({ children, onClick, primary }: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`evo-button${primary ? ' primary' : ''}`}
      onPointerEnter={() => playUi('hover', 0.15)}
      onClick={() => {
        playUi('click');
        onClick();
      }}
    >
      {children}
    </button>
  );
}
