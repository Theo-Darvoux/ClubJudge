Le premier réflexe — comparer toutes les paires — est correct mais trop lent.
Ce problème enseigne le réflexe suivant, l'un des plus rentables qui soit :
**trier d'abord, réfléchir ensuite**.

## Pourquoi la force brute échoue

Il y a $\binom{n}{2} \approx 5 \times 10^9$ paires pour $n = 10^5$ : plusieurs
dizaines de secondes, TLE garanti. Pourtant la réponse ne dépend que d'une
seule paire — tout l'enjeu est de la trouver sans regarder les autres.

## L'observation clé

Une fois le tableau trié, les deux valeurs les plus proches sont **voisines**.
En effet, si $v_a \le v_b \le v_c$, alors $v_b - v_a \le v_c - v_a$ : insérer
une valeur entre deux autres ne peut que produire des écarts plus petits que
l'écart extérieur. La paire optimale est donc l'une des $n - 1$ paires de
voisins du tableau trié.

D'où la solution en $O(n \log n)$ :

```python
input()
v = sorted(map(int, input().split()))
print(min(b - a for a, b in zip(v, v[1:])))
```

En C++ :

```cpp
#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n;
    std::scanf("%d", &n);
    std::vector<long long> v(n);
    for (auto &x : v) std::scanf("%lld", &x);
    std::sort(v.begin(), v.end());
    long long best = v[1] - v[0];
    for (int i = 2; i < n; i++) best = std::min(best, v[i] - v[i - 1]);
    std::printf("%lld\n", best);
}
```

## Les pièges

- **Les doublons** : deux niveaux égaux donnent un écart de $0$ — le tri les
  place côte à côte, le parcours des voisins les trouve naturellement (test 2).
- **Trier sans réfléchir à pourquoi** : l'argument « les plus proches sont
  voisins après tri » est la vraie solution ; le code n'en est que la
  transcription.

À retenir : quand un problème parle de proximité, d'écarts ou de paires de
valeurs, demandez-vous ce que donnerait le tableau trié. Le tri coûte
$O(n \log n)$ et **structure** les données — la réponse devient souvent
locale (voisins) au lieu de globale (toutes les paires).
