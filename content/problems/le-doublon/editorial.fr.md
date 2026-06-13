Ce problème tient en une question : « ai-je déjà vu cette valeur ? ». Toute la
solution consiste à y répondre vite.

## La force brute

Pour chaque $a_j$, re-parcourir $a_1, \dots, a_{j-1}$ : c'est $O(n^2)$, soit
jusqu'à $2 \times 10^{10}$ comparaisons — TLE garanti. Le doublon du gros test
est d'ailleurs placé tout à la fin, exprès.

## L'ensemble

Un **ensemble** basé sur une table de hachage (`set` Python,
`std::unordered_set` C++) teste l'appartenance et insère en $O(1)$ en moyenne.
On parcourt les numéros une seule fois :

```python
input()
seen = set()
for x in map(int, input().split()):
    if x in seen:
        print(x)
        break
    seen.add(x)
else:
    print(-1)
```

Le `else` d'une boucle `for` en Python s'exécute si la boucle se termine sans
`break` — exactement le cas « aucun doublon ».

```cpp
#include <cstdio>
#include <unordered_set>

int main() {
    int n;
    std::scanf("%d", &n);
    std::unordered_set<long long> seen;
    for (int i = 0; i < n; i++) {
        long long a;
        std::scanf("%lld", &a);
        if (seen.count(a)) {
            std::printf("%lld\n", a);
            return 0;
        }
        seen.insert(a);
    }
    std::printf("-1\n");
}
```

Coût total : $O(n)$ en moyenne.

## Les pièges

- **Tester l'appartenance dans une liste** (`x in liste` en Python) parcourt
  toute la liste : c'est la force brute déguisée en une ligne élégante.
- **Confondre « premier doublon » et « plus petite valeur en double »** : on
  veut la première valeur dont la *deuxième* apparition arrive le plus tôt.

À retenir : dès qu'un problème demande « déjà vu ? », « combien de valeurs
distinctes ? » ou « y a-t-il un doublon ? », pensez ensemble. C'est l'outil le
plus simple pour échanger un facteur $n$ contre un facteur constant.
