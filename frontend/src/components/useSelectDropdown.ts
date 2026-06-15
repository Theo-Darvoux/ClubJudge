import { useEffect, useRef, useState } from 'react';

/**
 * Logique commune aux menus déroulants personnalisés (CustomSelect,
 * SearchableSelect) : état ouvert/fermé + option survolée, fermeture au clic
 * extérieur, et maintien de l'option active dans la zone visible de la liste.
 *
 * `onClose` est appelé à la fermeture par clic extérieur (ex. réinitialiser la
 * recherche) ; il est lu via une ref pour ne pas réabonner l'écouteur à chaque
 * rendu même si l'appelant passe une fonction inline.
 */
export function useSelectDropdown(onClose?: () => void) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Ferme au clic en dehors du composant.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
        onCloseRef.current?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Garde l'option survolée visible dans la liste déroulante.
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[focusedIndex] as HTMLElement | undefined;
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  return { isOpen, setIsOpen, focusedIndex, setFocusedIndex, containerRef, listRef };
}
