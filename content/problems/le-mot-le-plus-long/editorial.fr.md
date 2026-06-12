Un parcours avec un « champion courant » : le motif le plus fréquent de toute
la programmation, ici dans sa version la plus simple.

## La solution

On découpe la ligne en mots, puis on les parcourt en gardant le plus long vu
jusqu'ici. La seule subtilité est l'égalité : l'énoncé demande le **premier**
des mots les plus longs, donc on ne remplace le champion que sur une longueur
**strictement** supérieure.

En Python, `max` avec une clé fait exactement ça (il renvoie le premier
élément maximal) :

```python
print(max(input().split(), key=len))
```

En C++ :

```cpp
#include <iostream>
#include <string>

int main() {
    std::string mot, champion;
    while (std::cin >> mot)
        if (mot.size() > champion.size()) champion = mot;
    std::cout << champion << '\n';
}
```

## Le piège du `>=`

Avec `mot.size() >= champion.size()`, on garderait le **dernier** des mots les
plus longs — et le test 2 (trois mots de même longueur) le détecte. C'est un
grand classique : quand un énoncé précise quoi faire en cas d'égalité, c'est
presque toujours que la comparaison stricte ou large change la réponse.

À retenir : le motif « champion courant » (initialiser, parcourir, remplacer
si meilleur) reviendra partout — maximum d'un tableau, meilleur score, plus
proche voisin. Autant l'écrire proprement dès maintenant.
