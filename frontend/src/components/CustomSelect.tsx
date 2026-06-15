import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface SelectOption<T> {
  value: T;
  label: string;
}

interface CustomSelectProps<T> {
  value: T;
  onChange: (val: T) => void;
  options: SelectOption<T>[];
  ariaLabel?: string;
  className?: string;
}

export function CustomSelect<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  className = '',
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selectedOption = options.find((o) => o.value === value);

  // Close when clicking outside the component
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
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
    const idx = options.findIndex((o) => o.value === value);
    setFocusedIndex(idx !== -1 ? idx : 0);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setFocusedIndex(-1);
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
        // Focus the trigger button back
        containerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        break;
      case 'Tab':
        closeDropdown();
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${isOpen ? 'is-open' : ''} ${className}`}
      onKeyDown={handleKeyDown}
    >
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

      {isOpen && (
        <ul
          ref={listRef}
          className="custom-select-options"
          role="listbox"
          tabIndex={-1}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isFocused = index === focusedIndex;
            return (
              <li
                key={opt.value}
                className={`custom-select-option ${isSelected ? 'is-selected' : ''} ${
                  isFocused ? 'is-focused' : ''
                }`}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(opt.value)}
                onMouseEnter={() => setFocusedIndex(index)}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <span className="custom-select-option-checkmark" aria-hidden="true">
                    ✓
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
