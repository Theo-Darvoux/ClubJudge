/**
 * Assemble une chaîne de classes en ignorant les valeurs vides/falsy — évite de
 * recopier partout l'idiome `[...].filter(Boolean).join(' ')`.
 *
 *   cx('card', isActive && 'is-active', isSolved ? 'is-solved' : null)
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
