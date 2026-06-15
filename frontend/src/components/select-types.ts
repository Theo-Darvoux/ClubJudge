/** Option partagée par les deux sélecteurs (CustomSelect, SearchableSelect). */
export interface SelectOption<T> {
  value: T;
  label: string;
}
