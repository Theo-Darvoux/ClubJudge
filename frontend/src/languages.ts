import type { SubmissionLanguage } from './api';

/** Source unique des langages soumissibles : libellé affiché, mode Monaco et
 *  extension de fichier. Partagée par l'éditeur (Workbench) et l'affichage des
 *  solutions (ProblemTabs) — un seul endroit à toucher pour ajouter un langage. */
export interface LanguageDescriptor {
  id: SubmissionLanguage;
  label: string;
  monaco: string;
  ext: string;
}

export const LANGUAGES: LanguageDescriptor[] = [
  { id: 'python', label: 'Python', monaco: 'python', ext: 'py' },
  { id: 'cpp', label: 'C++', monaco: 'cpp', ext: 'cpp' },
  { id: 'c', label: 'C', monaco: 'c', ext: 'c' },
  { id: 'java', label: 'Java', monaco: 'java', ext: 'java' },
  { id: 'ocaml', label: 'OCaml', monaco: 'ocaml', ext: 'ml' },
];

// Index par id : un seul scan au chargement du module, puis des accès O(1)
// partout (libellé, mode Monaco, extension) au lieu d'un LANGUAGES.find répété.
export const LANGUAGE_BY_ID: Record<SubmissionLanguage, LanguageDescriptor> = Object.fromEntries(
  LANGUAGES.map((l) => [l.id, l]),
) as Record<SubmissionLanguage, LanguageDescriptor>;

// Index inverse par extension de fichier (import depuis le disque).
const LANGUAGE_BY_EXT = new Map(LANGUAGES.map((l) => [l.ext, l]));

export function languageLabel(id: SubmissionLanguage): string {
  return LANGUAGE_BY_ID[id]?.label ?? id;
}

/** Langage déduit d'une extension de fichier (minuscule), ou undefined. */
export function languageForExt(ext: string | undefined): LanguageDescriptor | undefined {
  return ext ? LANGUAGE_BY_EXT.get(ext) : undefined;
}
