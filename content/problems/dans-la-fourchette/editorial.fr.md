Beaucoup de questions sur des données qui ne changent pas : c'est la
signature d'un problème de **prétraitement**. On paie une fois pour organiser
les données, chaque question devient ensuite presque gratuite.

## Pourquoi la force brute échoue

Parcourir les $n$ prix pour chacune des $q$ questions coûte $O(nq)$, jusqu'à
$10^{10}$ opérations. Chaque question seule est triviale — c'est leur nombre
qui tue.

## Trier, puis compter par dichotomie

Une fois les prix **triés**, les snacks de prix dans $[a, b]$ forment un
segment contigu du tableau. Compter, c'est localiser les deux bouts du
segment :

$$\#\{p_i \in [a, b]\} = \#\{p_i \le b\} - \#\{p_i < a\}$$

et chacun des deux comptes est une **dichotomie** en $O(\log n)$. La
bibliothèque standard la fournit — avec la même subtilité de bornes dans les
deux langages :

```python
import bisect
import sys

data = sys.stdin.buffer.read().split()
n, q = int(data[0]), int(data[1])
prices = sorted(map(int, data[2 : 2 + n]))
out = []
pos = 2 + n
for _ in range(q):
    a, b = int(data[pos]), int(data[pos + 1])
    pos += 2
    out.append(bisect.bisect_right(prices, b) - bisect.bisect_left(prices, a))
sys.stdout.write("\n".join(map(str, out)) + "\n")
```

`bisect_left(p, a)` = nombre de valeurs $< a$ ; `bisect_right(p, b)` = nombre
de valeurs $\le b$. En C++, ce sont `lower_bound` et `upper_bound` :

```cpp
auto lo = std::lower_bound(prices.begin(), prices.end(), a);
auto hi = std::upper_bound(prices.begin(), prices.end(), b);
std::printf("%lld\n", (long long)(hi - lo));
```

Coût total : $O(n \log n)$ pour le tri, $O(\log n)$ par question.

## Les pièges

- **Confondre left/right** (ou lower/upper) : avec des doublons, prendre
  `bisect_left(b)` raterait les snacks au prix exactement $b$. Le test 2 y
  veille.
- **La lecture lente** : $3 \times 10^5$ nombres à lire — en Python, un
  `input()` par ligne de question est limite ; `sys.stdin.buffer.read()` met
  à l'abri (voir l'article « Entrées et sorties »).

À retenir : *trier + dichotomie* transforme « combien de valeurs dans un
intervalle ? » en deux recherches logarithmiques. Et plus généralement :
quand les questions sont nombreuses et les données figées, cherchez le
prétraitement.
