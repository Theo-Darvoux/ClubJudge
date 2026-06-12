Un problème de tri où tout l'enjeu est de **ne pas écrire de tri** : la
bibliothèque standard le fait mieux que nous.

## La solution

Lire les $n$ dossards, les trier avec le tri de la bibliothèque standard
($O(n \log n)$), puis les afficher séparés par des espaces.

En Python, tout tient en une ligne :

```python
input()
print(" ".join(map(str, sorted(map(int, input().split())))))
```

En C++ :

```cpp
#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n;
    std::scanf("%d", &n);
    std::vector<long long> d(n);
    for (auto &x : d) std::scanf("%lld", &x);
    std::sort(d.begin(), d.end());
    for (int i = 0; i < n; i++) std::printf("%lld%c", d[i], i + 1 < n ? ' ' : '\n');
}
```

## Pourquoi pas un tri maison ?

Un tri par bulles ou par insertion fait environ $n^2 = 10^{10}$ opérations
pour $n = 10^5$ : plusieurs minutes, donc TLE garanti. Les tris de
bibliothèque (`sorted`, `std::sort`, `Arrays.sort`) sont en $O(n \log n)$,
soit environ $1{,}7 \times 10^6$ comparaisons — instantané.

À retenir : **connaître sa bibliothèque standard est une compétence
algorithmique** à part entière. Savoir qu'un tri existe, ce qu'il coûte et
quand il suffit, c'est souvent toute la différence entre 5 minutes et une
heure sur un problème.

Dernier détail : les doublons. Les tris standards sont stables ou s'en
moquent — deux dossards identiques restent simplement côte à côte, aucune
précaution particulière à prendre.
