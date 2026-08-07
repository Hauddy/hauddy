import { IconSearch } from './icons';

/** A plain filter box: an icon + input that narrows a list already on screen.
 *  (Distinct from Combobox, which is a dropdown that *selects* one value.) */
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="search-input">
      <IconSearch size={15} />
      <input
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
