Une fois l'histoire dépliée, l'énoncé devient : **la plus longue fenêtre
contenant au plus $k$ zéros**. C'est « Le plus long sprint » avec un autre
budget — non plus une somme d'énergies, mais un *quota* de zéros.

## La même monotonie, donc la même technique

Élargir une fenêtre ne fait jamais baisser son nombre de zéros. Si $[g, d]$
contient déjà trop de zéros, toute extension à droite aussi : quand le bord
droit avance, le bord gauche n'a jamais besoin de reculer. La fenêtre
glissante s'applique telle quelle — seul le compteur change :

```python
import sys

data = sys.stdin.buffer.read().split()
k = int(data[1])
sessions = list(map(int, data[2:]))
best = 0
zeros = 0
left = 0
for right, s in enumerate(sessions):
    zeros += s == 0
    while zeros > k:
        zeros -= sessions[left] == 0
        left += 1
    best = max(best, right - left + 1)
print(best)
```

```cpp
int best = 0, left = 0, zeros = 0;
for (int right = 0; right < n; right++) {
    zeros += sessions[right] == 0;
    while (zeros > k) zeros -= sessions[left++] == 0;
    best = std::max(best, right - left + 1);
}
```

Chaque bord avance au plus $n$ fois : $O(n)$.

## Les pièges

- **$k = 0$** : le code gère le cas sans modification — la fenêtre ne tolère
  aucun zéro, on retrouve « la plus longue série de $1$ consécutifs ».
- **Moins de zéros que $k$ dans tout l'historique** : la fenêtre ne se
  resserre jamais et la réponse est $n$ — là encore, aucun cas particulier.
- **Chercher quels zéros rattraper** : fausse piste. On ne choisit pas $k$
  zéros dans l'absolu, on choisit une *fenêtre* ; les zéros à rattraper sont
  simplement ceux qu'elle contient.

À retenir : la fenêtre glissante ne dépend pas de la nature du « coût » —
somme, nombre de zéros, taille d'un ensemble de valeurs distinctes… Ce qui
compte, c'est que le coût ne diminue jamais quand la fenêtre grandit. Repérez
cette monotonie et la technique suit.
