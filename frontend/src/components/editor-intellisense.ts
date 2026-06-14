import type { Monaco } from '@monaco-editor/react';
import type { editor, Position } from 'monaco-editor';
import type { SubmissionLanguage } from '../api';

/* Auto-complétion « légère » pour l'éditeur Monaco.

   Monaco n'embarque de la vraie IntelliSense sémantique que pour TS/JS. Pour
   C++/C/Python/Java on n'a que la coloration + l'auto-complétion par mots du
   buffer. On enrichit ça avec des fournisseurs de complétion curés : les
   snippets et symboles de stdlib les plus utiles en programmation compétitive.

   C'est statique (ça ne suit pas les variables de l'utilisateur, le word-based
   s'en charge en parallèle) mais zéro infra et 100 % navigateur. Pour du
   sémantique complet, voir l'intégration Pyright (Python) dans Workbench. */

type Item = {
  label: string;
  insert: string;
  detail?: string;
  doc?: string;
  /** « snippet » accepte les tabulations ${1:...} ; sinon insertion brute. */
  snippet?: boolean;
  /** function | keyword | class | constant — pilote l'icône. Défaut: function. */
  kind?: 'function' | 'keyword' | 'class' | 'constant' | 'module';
};

const CPP: Item[] = [
  {
    label: 'bits',
    insert: '#include <bits/stdc++.h>',
    detail: 'En-tête tout-en-un',
    doc: 'Inclut toute la bibliothèque standard d’un coup. Pratique en compétition (non portable hors GCC).',
    kind: 'keyword',
  },
  {
    label: 'main',
    insert: 'int main() {\n\t$0\n\treturn 0;\n}',
    detail: 'Fonction principale',
    doc: 'Point d’entrée du programme. Retourne `0` en cas de succès.',
    snippet: true,
    kind: 'keyword',
  },
  {
    label: 'fastio',
    insert: 'ios::sync_with_stdio(false);\ncin.tie(nullptr);',
    detail: 'Entrées/sorties rapides',
    doc: 'Désynchronise les flux C++ du C et délie `cin`/`cout`. Accélère nettement les gros volumes de lecture/écriture.',
    kind: 'keyword',
  },
  {
    label: 'forn',
    insert: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}',
    detail: 'Boucle for de 0 à n',
    doc: 'Itère `i` de `0` à `n-1`.',
    snippet: true,
    kind: 'keyword',
  },
  {
    label: 'vec',
    insert: 'vector<${1:int}> ${2:v}(${3:n});',
    detail: 'Déclaration de vector',
    doc: 'Tableau dynamique de taille `n`, initialisé à zéro.',
    snippet: true,
    kind: 'class',
  },
  {
    label: 'readvec',
    insert: 'for (auto& ${1:x} : ${2:v}) cin >> ${1:x};',
    detail: 'Lire un vector entier',
    doc: 'Remplit le vector `v` depuis l’entrée standard.',
    snippet: true,
    kind: 'keyword',
  },
  { label: 'cin', insert: 'cin >> ', detail: 'std::cin', doc: 'Flux d’entrée standard. `cin >> x` lit la prochaine valeur.', kind: 'function' },
  { label: 'cout', insert: 'cout << ', detail: 'std::cout', doc: 'Flux de sortie standard. `cout << x` écrit une valeur.', kind: 'function' },
  { label: 'endl', insert: 'endl', detail: 'Fin de ligne (flush)', doc: 'Insère `\\n` **et** vide le tampon. Préférer `"\\n"` en boucle serrée pour la vitesse.', kind: 'constant' },
  { label: 'sort', insert: 'sort(${1:v}.begin(), ${1:v}.end());', detail: 'Tri croissant', doc: 'Trie l’intervalle en place, en `O(n log n)`.', snippet: true, kind: 'function' },
  { label: 'vector', insert: 'vector', detail: 'std::vector<T>', doc: 'Tableau dynamique contigu à accès aléatoire `O(1)`.', kind: 'class' },
  { label: 'string', insert: 'string', detail: 'std::string', doc: 'Chaîne de caractères mutable.', kind: 'class' },
  { label: 'pair', insert: 'pair<${1:int}, ${2:int}>', detail: 'std::pair<A, B>', doc: 'Couple de valeurs (`.first`, `.second`).', snippet: true, kind: 'class' },
  { label: 'map', insert: 'map<${1:int}, ${2:int}>', detail: 'std::map<K, V>', doc: 'Dictionnaire trié (arbre). Accès en `O(log n)`.', snippet: true, kind: 'class' },
  { label: 'set', insert: 'set<${1:int}>', detail: 'std::set<T>', doc: 'Ensemble trié sans doublons. Opérations en `O(log n)`.', snippet: true, kind: 'class' },
  { label: 'queue', insert: 'queue<${1:int}>', detail: 'std::queue<T>', doc: 'File FIFO (`push`, `front`, `pop`).', snippet: true, kind: 'class' },
  { label: 'priority_queue', insert: 'priority_queue<${1:int}>', detail: 'Tas (max-heap)', doc: 'File de priorité ; `top()` renvoie le plus grand. `O(log n)` par opération.', snippet: true, kind: 'class' },
  { label: 'push_back', insert: 'push_back(', detail: 'vector::push_back', doc: 'Ajoute un élément en fin de vector, en `O(1)` amorti.', kind: 'function' },
  { label: 'long long', insert: 'long long', detail: 'Entier 64 bits', doc: 'Entier signé sur 64 bits (≈ ±9.2·10¹⁸). À utiliser dès qu’un `int` peut déborder.', kind: 'keyword' },
];

const C: Item[] = [
  { label: 'stdio', insert: '#include <stdio.h>', detail: 'Entrées/sorties', doc: 'Fournit `printf`, `scanf`, `getchar`…', kind: 'keyword' },
  { label: 'stdlib', insert: '#include <stdlib.h>', detail: 'Utilitaires', doc: 'Fournit `malloc`, `free`, `qsort`, `atoi`…', kind: 'keyword' },
  {
    label: 'main',
    insert: 'int main(void) {\n\t$0\n\treturn 0;\n}',
    detail: 'Fonction principale',
    doc: 'Point d’entrée du programme.',
    snippet: true,
    kind: 'keyword',
  },
  {
    label: 'forn',
    insert: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}',
    detail: 'Boucle for de 0 à n',
    doc: 'Itère `i` de `0` à `n-1`.',
    snippet: true,
    kind: 'keyword',
  },
  { label: 'scanf', insert: 'scanf("%${1:d}", &${2:x});', detail: 'Lecture formatée', doc: 'Lit depuis l’entrée selon un format. **Penser au `&`** sur la variable.', snippet: true, kind: 'function' },
  { label: 'printf', insert: 'printf("%${1:d}\\n", ${2:x});', detail: 'Écriture formatée', doc: 'Écrit sur la sortie selon un format (`%d`, `%lld`, `%s`…).', snippet: true, kind: 'function' },
];

const PYTHON: Item[] = [
  {
    label: 'forr',
    insert: 'for ${1:i} in range(${2:n}):\n\t$0',
    detail: 'Boucle for range',
    doc: 'Itère `i` de `0` à `n-1`.',
    snippet: true,
    kind: 'keyword',
  },
  {
    label: 'readint',
    insert: '${1:n} = int(input())',
    detail: 'Lire un entier',
    doc: 'Lit une ligne et la convertit en entier.',
    snippet: true,
    kind: 'function',
  },
  {
    label: 'readints',
    insert: '${1:a} = list(map(int, input().split()))',
    detail: 'Lire une ligne d’entiers',
    doc: 'Lit une ligne d’entiers séparés par des espaces dans une liste.',
    snippet: true,
    kind: 'function',
  },
  {
    label: 'fastin',
    insert: 'import sys\ninput = sys.stdin.readline',
    detail: 'Entrée rapide',
    doc: 'Remplace `input` par `sys.stdin.readline`, bien plus rapide sur beaucoup de lignes.',
    kind: 'module',
  },
  { label: 'defaultdict', insert: 'defaultdict(${1:int})', detail: 'collections.defaultdict', doc: 'Dictionnaire avec valeur par défaut automatique (ex. `int` → `0`).', snippet: true, kind: 'class' },
  // NB: les builtins (print, range, len…) sont fournis par Pyright quand il est
  // chargé (cf. pyright-setup) et par le word-based ; on ne garde ici que les
  // snippets compétitifs que Pyright ne propose pas.
];

const JAVA: Item[] = [
  {
    label: 'main',
    insert: 'public static void main(String[] args) {\n\t$0\n}',
    detail: 'Fonction principale',
    doc: 'Point d’entrée d’une classe Java exécutable.',
    snippet: true,
    kind: 'keyword',
  },
  {
    label: 'scanner',
    insert: 'Scanner ${1:sc} = new Scanner(System.in);',
    detail: 'Lecture au clavier',
    doc: 'Lit l’entrée standard (`nextInt`, `next`, `nextLine`…).',
    snippet: true,
    kind: 'class',
  },
  {
    label: 'forn',
    insert: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}',
    detail: 'Boucle for de 0 à n',
    doc: 'Itère `i` de `0` à `n-1`.',
    snippet: true,
    kind: 'keyword',
  },
  { label: 'sout', insert: 'System.out.println(', detail: 'Affichage', doc: 'Écrit une ligne sur la sortie standard.', kind: 'function' },
  { label: 'nextInt', insert: 'nextInt()', detail: 'Scanner.nextInt', doc: 'Lit le prochain entier de l’entrée.', kind: 'function' },
  { label: 'ArrayList', insert: 'ArrayList<${1:Integer}>', detail: 'java.util.ArrayList', doc: 'Liste dynamique à accès aléatoire `O(1)`.', snippet: true, kind: 'class' },
  { label: 'HashMap', insert: 'HashMap<${1:Integer}, ${2:Integer}>', detail: 'java.util.HashMap', doc: 'Dictionnaire à accès moyen `O(1)`.', snippet: true, kind: 'class' },
];

const ITEMS: Record<SubmissionLanguage, Item[]> = {
  cpp: CPP,
  c: C,
  python: PYTHON,
  java: JAVA,
};

// Évite de réenregistrer les fournisseurs si Monaco est monté plusieurs fois
// (plusieurs Workbench sur une page de cours partagent la même instance).
const registered = new WeakSet<Monaco>();

export function registerIntellisense(monaco: Monaco): void {
  if (registered.has(monaco)) return;
  registered.add(monaco);

  const Kind = monaco.languages.CompletionItemKind;
  const kindMap = {
    function: Kind.Function,
    keyword: Kind.Keyword,
    class: Kind.Class,
    constant: Kind.Constant,
    module: Kind.Module,
  } as const;

  for (const [lang, items] of Object.entries(ITEMS) as [SubmissionLanguage, Item[]][]) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems(model: editor.ITextModel, position: Position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: items.map((it) => ({
            label: it.label,
            kind: kindMap[it.kind ?? 'function'],
            insertText: it.insert,
            insertTextRules: it.snippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            detail: it.detail,
            // Panneau de doc à droite de la suggestion, façon VS Code (markdown).
            documentation: it.doc ? { value: it.doc } : undefined,
            range,
          })),
        };
      },
    });
  }
}
