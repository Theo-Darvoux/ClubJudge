import { useState, useRef, useMemo, useId } from 'react';
import type { KeyboardEvent } from 'react';
import type { SelectOption } from './select-types';
import { useSelectDropdown } from './useSelectDropdown';

interface CustomSelectProps<T> {
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  className?: string;
  searchable?: boolean;
  noResultsText?: string;
}

export function CustomSelect<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  className = '',
  searchable = false,
  noResultsText = 'Aucun résultat',
}: CustomSelectProps<T>) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const { isOpen, setIsOpen, focusedIndex, setFocusedIndex, containerRef, listRef } =
    useSelectDropdown(() => {
      if (searchable) setQuery('');
    });

  const selectedOption = options.find((o) => o.value === value);
  const fallbackLabel = value !== undefined && value !== null && value !== '' ? String(value) : '';

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const getOptionId = (index: number) => `${listId}-option-${index}`;

  const openDropdown = () => {
    setIsOpen(true);
    if (searchable) {
      setQuery('');
    }
    const idx = options.findIndex((o) => o.value === value);
    setFocusedIndex(idx !== -1 ? idx : 0);
  };

  const closeDropdown = (shouldBlurInput = true) => {
    setIsOpen(false);
    setFocusedIndex(-1);
    if (searchable) {
      setQuery('');
      if (shouldBlurInput) {
        inputRef.current?.blur();
      }
    } else {
      // Focus the trigger button back
      containerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  };

  const handleToggle = () => {
    if (isOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  };

  const handleSelect = (val: T) => {
    onChange(val);
    closeDropdown();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (searchable) {
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
          closeDropdown(false);
          break;
        default:
          break;
      }
    } else {
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (!isOpen) {
            openDropdown();
          } else if (focusedIndex >= 0 && focusedIndex < options.length) {
            handleSelect(options[focusedIndex].value);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen) {
            openDropdown();
          } else {
            setFocusedIndex((prev) => (prev + 1 < options.length ? prev + 1 : prev));
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen) {
            openDropdown();
          } else {
            setFocusedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : prev));
          }
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
    }
  };

  const prefix = searchable ? 'searchable-select' : 'custom-select';
  const displayValue = isOpen ? query : (selectedOption ? selectedOption.label : fallbackLabel);

  const activeDescendantId = isOpen && focusedIndex >= 0 && focusedIndex < filteredOptions.length
    ? getOptionId(focusedIndex)
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`${prefix}-container ${isOpen ? 'is-open' : ''} ${className}`}
      onKeyDown={handleKeyDown}
    >
      {searchable ? (
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
            placeholder={selectedOption ? selectedOption.label : fallbackLabel}
            aria-label={ariaLabel}
            aria-expanded={isOpen}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={isOpen ? listId : undefined}
            aria-activedescendant={activeDescendantId}
          />
          <span className="searchable-select-arrow" aria-hidden="true" />
        </div>
      ) : (
        <button
          type="button"
          className="custom-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          onClick={handleToggle}
        >
          <span>{selectedOption ? selectedOption.label : ''}</span>
          <span className="custom-select-arrow" aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <ul
          ref={listRef}
          id={listId}
          className={`${prefix}-options`}
          role="listbox"
          tabIndex={-1}
        >
          {searchable && filteredOptions.length === 0 ? (
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
                  id={getOptionId(index)}
                  className={`${prefix}-option ${isSelected ? 'is-selected' : ''} ${
                    isFocused ? 'is-focused' : ''
                  }`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  onMouseEnter={() => setFocusedIndex(index)}
                >
                  <span>{opt.label}</span>
                  {isSelected && (
                    <span className={`${prefix}-option-checkmark`} aria-hidden="true">
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

interface SearchableSelectProps<T> {
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  noResultsText?: string;
}

export function SearchableSelect<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  noResultsText,
}: SearchableSelectProps<T>) {
  return (
    <CustomSelect
      value={value}
      onChange={onChange}
      options={options}
      ariaLabel={ariaLabel}
      noResultsText={noResultsText}
      searchable
    />
  );
}
