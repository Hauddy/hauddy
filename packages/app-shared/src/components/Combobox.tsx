import { useEffect, useRef, useState } from 'react';
import type { Presence } from '../api/types';
import { PresenceDot } from './Presence';

export interface ComboItem {
  /** The value handed back on select (e.g. a handle). */
  value: string;
  /** Primary display text (e.g. '@ada'). */
  label: string;
  description?: string | null;
  presence?: Presence;
}

interface Props {
  items: ComboItem[];
  onSelect: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Clear the input after a select — right for "add" pickers, wrong for a
   *  sticky recipient field. */
  clearOnSelect?: boolean;
  /** Preseed the input text (e.g. a preselected recipient). */
  initialQuery?: string;
  disabled?: boolean;
}

const bare = (s: string) => s.trim().toLowerCase().replace(/^@+/, '');

/** Type-to-filter autocomplete over a handle list: the input filters `items` as
 *  you type; ↑/↓ move, Enter/click select, Esc closes. Shared by the desktop
 *  add-to-book picker and the dashboard's Messages recipient field. */
export default function Combobox({
  items,
  onSelect,
  placeholder,
  ariaLabel,
  clearOnSelect,
  initialQuery = '',
  disabled,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const q = bare(query);
  const filtered = q
    ? items.filter((it) => bare(it.label).includes(q) || (it.description ?? '').toLowerCase().includes(q))
    : items;

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const choose = (value: string) => {
    onSelect(value);
    setQuery(clearOnSelect ? '' : value);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        choose(filtered[active].value);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="combobox" ref={rootRef}>
      <input
        className="input mono combobox-input"
        value={query}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKey}
      />
      {open && !disabled && (
        <div className="combobox-menu" role="listbox">
          {filtered.length === 0 ? (
            <div className="combobox-empty">No matches</div>
          ) : (
            filtered.map((it, i) => (
              <button
                type="button"
                key={it.value}
                role="option"
                aria-selected={i === active}
                className={`combobox-option${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(it.value)}
              >
                {it.presence && <PresenceDot state={it.presence} />}
                <span className="combobox-option-label">{it.label}</span>
                {it.description && <span className="combobox-option-desc">{it.description}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
