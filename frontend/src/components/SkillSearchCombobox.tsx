import { useState, useEffect, useRef, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import type { SkillNode } from '../api';
import type { fr } from '../i18n/fr';

interface SkillSearchComboboxProps {
  nodes: SkillNode[];
  selectedSlug: string | null;
  onSelect: (node: SkillNode) => void;
  lang: 'fr' | 'en';
  t: typeof fr;
}

export function SkillSearchCombobox({
  nodes,
  selectedSlug,
  onSelect,
  lang,
  t,
}: SkillSearchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.slug === selectedSlug);
  }, [nodes, selectedSlug]);

  const name = (n: SkillNode) => (lang === 'en' && n.name_en ? n.name_en : n.name_fr);

  const filteredNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter((node) => {
      const nameFr = (node.name_fr || '').toLowerCase();
      const nameEn = (node.name_en || '').toLowerCase();
      const descFr = (node.description_fr || '').toLowerCase();
      const descEn = (node.description_en || '').toLowerCase();
      return (
        nameFr.includes(q) ||
        nameEn.includes(q) ||
        descFr.includes(q) ||
        descEn.includes(q)
      );
    });
  }, [nodes, query]);

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

  const handleSelect = (node: SkillNode) => {
    onSelect(node);
    setIsOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        setIsOpen(true);
        setFocusedIndex(0);
      }
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filteredNodes.length) {
          handleSelect(filteredNodes[focusedIndex]);
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1 < filteredNodes.length ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : prev));
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setFocusedIndex(-1);
        setQuery('');
        inputRef.current?.blur();
        break;
      case 'Tab':
        setIsOpen(false);
        setFocusedIndex(-1);
        setQuery('');
        break;
      default:
        break;
    }
  };

  const inputValue = isOpen ? query : (selectedNode ? name(selectedNode) : '');

  return (
    <div
      ref={containerRef}
      className={`skill-search-container ${isOpen ? 'is-open' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <div className="skill-search-input-wrapper">
        <svg
          className="skill-search-icon"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="skill-search-input"
          placeholder={t.skills.search_placeholder}
          value={inputValue}
          onFocus={() => {
            setIsOpen(true);
            setFocusedIndex(selectedNode ? filteredNodes.findIndex((n) => n.slug === selectedNode.slug) : 0);
            // Select text to allow easy overwrite
            setTimeout(() => inputRef.current?.select(), 0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusedIndex(0);
          }}
          aria-label={t.skills.search_placeholder}
          aria-expanded={isOpen}
          role="combobox"
          aria-controls="skill-search-list"
          aria-autocomplete="list"
        />
        {(query || selectedNode) && (
          <button
            type="button"
            className="skill-search-clear-btn"
            onClick={() => {
              setQuery('');
              if (isOpen) {
                inputRef.current?.focus();
              } else {
                inputRef.current?.focus();
              }
            }}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && (
        <ul
          ref={listRef}
          id="skill-search-list"
          className="skill-search-dropdown"
          role="listbox"
        >
          {filteredNodes.length === 0 ? (
            <li className="skill-search-no-results mono-label">
              {t.skills.search_empty}
            </li>
          ) : (
            filteredNodes.map((node, index) => {
              const isSelected = node.slug === selectedSlug;
              const isFocused = index === focusedIndex;
              const nodeName = name(node);

              return (
                <li
                  key={node.slug}
                  className={`skill-search-option is-${node.state} ${isSelected ? 'is-selected' : ''} ${
                    isFocused ? 'is-focused' : ''
                  }`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(node)}
                  onMouseEnter={() => setFocusedIndex(index)}
                >
                  <span className={`skill-search-option-dot is-${node.state}`} aria-hidden="true" />
                  <span className="skill-search-option-name">{nodeName}</span>
                  <span className="skill-search-option-progress">
                    {node.state === 'mastered' ? '✓' : `${node.solved_count}/${node.mastery_threshold}`}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
