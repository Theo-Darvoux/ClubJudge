import type { Lang } from './context';

/**
 * Choisit la variante anglaise d'un champ si la langue est l'anglais ET que la
 * traduction existe, sinon retombe sur le français. Centralise la règle de
 * repli i18n recopiée pour les noms de nœuds, titres d'articles, etc.
 */
export function localized(fr: string, en: string | null | undefined, lang: Lang): string {
  return lang === 'en' && en ? en : fr;
}
