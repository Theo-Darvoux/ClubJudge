import { useState, useEffect, useRef, useMemo } from 'react';
import type { KeyboardEvent } from 'react';

export interface SelectOption<T> {
  value: T;
  label: string;
}

interface SearchableSelectProps<T> {
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  noResultsText?: string;
}

export function SearchableSelect<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = '',
  className = '',
  noResultsText = 'Aucun résultat',
}: SearchableSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selectedOption = options.find((o) => o.value === value);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Close when clicking outside the component
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keep focused option scrolled into view within the custom dropdown list
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[focusedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex]);

  const openDropdown = () => {
    setIsOpen(true);
    setQuery('');
    const idx = filteredOptions.findIndex((o) => o.value === value);
    setFocusedIndex(idx !== -1 ? idx : 0);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setFocusedIndex(-1);
    setQuery('');
    inputRef.current?.blur();
  };

  const handleSelect = (val: T) => {
    onChange(val);
    closeDropdown();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          handleSelect(filteredOptions[focusedIndex].value);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1 < filteredOptions.length ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : prev));
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;
      case 'Tab':
        closeDropdown();
        break;
      default:
        break;
    }
  };

  const displayValue = isOpen ? query : (selectedOption ? selectedOption.label : '');

  return (
    <div
      ref={containerRef}
      className={`searchable-select-container ${isOpen ? 'is-open' : ''} ${className}`}
      onKeyDown={handleKeyDown}
    >
      <div className="searchable-select-trigger-wrapper">
        <input
          ref={inputRef}
          type="text"
          className="searchable-select-input"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIndex(0);
          }}
          onFocus={openDropdown}
          placeholder={placeholder || (selectedOption ? selectedOption.label : '')}
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          role="combobox"
          aria-autocomplete="list"
        />
        <span className="searchable-select-arrow" aria-hidden="true" />
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          className="searchable-select-options"
          role="listbox"
          tabIndex={-1}
        >
          {filteredOptions.length === 0 ? (
            <li className="searchable-select-no-results mono-label">
              {noResultsText}
            </li>
          ) : (
            filteredOptions.map((opt, index) => {
              const isSelected = opt.value === value;
              const isFocused = index === focusedIndex;
              return (
                <li
                  key={String(opt.value)}
                  className={`searchable-select-option ${isSelected ? 'is-selected' : ''} ${
                    isFocused ? 'is-focused' : ''
                  }`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  onMouseEnter={() => setFocusedIndex(index)}
                >
                  <span>{opt.label}</span>
                  {isSelected && (
                    <span className="searchable-select-option-checkmark" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
