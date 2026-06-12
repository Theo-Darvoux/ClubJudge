import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nContext } from './context';
import type { Lang } from './context';
import { en } from './en';
import { fr } from './fr';

const dictionaries = { fr, en } as const;

const STORAGE_KEY = 'clubjudge.lang';

function initialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'fr' || stored === 'en') return stored;
  return navigator.language.startsWith('fr') ? 'fr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    setLangState(next);
  }, []);

  const value = useMemo(
    () => ({ lang, t: dictionaries[lang], setLang }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
