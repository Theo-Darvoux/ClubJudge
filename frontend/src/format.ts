/** Conventions d'affichage partagées par la page problème (mémoire en Mo,
 *  temps en secondes) — un seul endroit pour la mise en forme des unités. */

export function fmtMemoryMo(kb: number, lang: 'fr' | 'en' = 'fr'): string {
  const mo = kb / 1024;
  const unit = lang === 'en' ? 'MB' : 'Mo';
  // En dessous de 10 Mo, un arrondi entier écrase la mesure (512 Ko → « 0/1 Mo ») :
  // on garde une décimale. Au-delà, l'entier suffit (limites type « 256 Mo »).
  return `${mo < 10 ? mo.toFixed(1) : Math.round(mo)} ${unit}`;
}

// La seconde s'écrit « s » dans les deux langues (symbole SI) : pas de paramètre
// `lang` ici, contrairement à `fmtMemoryMo` (Mo/MB).
export function fmtTimeS(s: number): string {
  return `${s.toFixed(2)} s`;
}
