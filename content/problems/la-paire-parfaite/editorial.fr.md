Comme pour « Le doublon », la force brute sur les paires coûte $O(n^2)$ et
explose. La sortie de secours est la même famille d'outils : le hachage —
cette fois avec un **dictionnaire**, car il faut compter.

## Retourner la question

Plutôt que « quelles paires somment à $t$ ? », demandez pour chaque membre :
« le partenaire qu'il me faut, l'ai-je déjà croisé, et combien de fois ? ».
Le membre de niveau $v$ veut un partenaire de niveau exactement $t - v$.

Un dictionnaire `niveau → nombre d'occurrences déjà vues` répond en $O(1)$.
Un seul passage suffit :

```python
from collections import Counter

_, t = map(int, input().split())
seen = Counter()
pairs = 0
for v in map(int, input().split()):
    pairs += seen[t - v]
    seen[v] += 1
print(pairs)
```

Chaque paire $\{i, j\}$ ($i < j$) est comptée exactement une fois : au moment
où l'on traite $j$, le compteur contient $i$. L'ordre des deux lignes du corps
de boucle est crucial — compter *avant* d'insérer, sinon le cas $t = 2v$
compterait le membre en binôme avec lui-même.

```cpp
#include <cstdio>
#include <unordered_map>

int main() {
    int n;
    long long t;
    std::scanf("%d %lld", &n, &t);
    std::unordered_map<long long, long long> seen;
    long long pairs = 0;
    for (int i = 0; i < n; i++) {
        long long v;
        std::scanf("%lld", &v);
        auto it = seen.find(t - v);
        if (it != seen.end()) pairs += it->second;
        seen[v]++;
    }
    std::printf("%lld\n", pairs);
}
```

## Les pièges

- **Le débordement** : $2 \times 10^5$ valeurs égales donnent
  $\binom{2 \times 10^5}{2} \approx 2 \times 10^{10}$ paires — au-delà d'un
  `int` 32 bits. Le gros test le vérifie. (En Python, aucun risque.)
- **Compter après avoir inséré** : avec $t = 2v$, on appairerait chaque membre
  avec lui-même.
- **Trier puis chercher en dichotomie** marche aussi ($O(n \log n)$), mais le
  comptage des doublons y est plus délicat — le dictionnaire est plus direct.

À retenir : « pour chaque élément, existe-t-il (combien de fois) son
complément ? » est le schéma d'usage numéro un du dictionnaire. Le calcul du
complément change ($t - v$, $-v$, le mot inversé…), la structure reste.
