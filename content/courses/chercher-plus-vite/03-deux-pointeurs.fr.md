---
practice:
  - serie-sans-faille
---

# Deux pointeurs

Dernier outil de la série, et le plus élégant : pour toutes les questions en
« la plus longue plage de valeurs **consécutives** telle que… », on peut
souvent remplacer les $O(n^2)$ fenêtres candidates par **une seule fenêtre
qui glisse**, en $O(n)$.

## L'idée

Deux indices délimitent une fenêtre $[g, d]$ sur le tableau. Le bord droit
avance d'un cran à chaque tour ; quand la fenêtre viole la contrainte (somme
trop grosse, trop de zéros…), le bord **gauche** avance pour la réparer. On
note la meilleure longueur vue en route.

```python
best = 0
total = 0          # le « coût » de la fenêtre courante
left = 0
for right, x in enumerate(v):
    total += x                 # le bord droit entre
    while total > budget:      # contrainte violée ?
        total -= v[left]       # le bord gauche sort
        left += 1
    best = max(best, right - left + 1)
```

Le `while` imbriqué ressemble à du $O(n^2)$, mais comptez autrement : chaque
élément *entre* une fois dans la fenêtre et en *sort* au plus une fois. Deux
fois $n$ pas en tout — c'est du $O(n)$ **amorti**.

## Pourquoi le bord gauche ne recule jamais

C'est le point qui rend la technique correcte, et il faut le vérifier à
chaque fois : **élargir la fenêtre ne doit jamais arranger la contrainte**.
Avec des valeurs $\ge 0$, agrandir ne fait qu'augmenter la somme ; donc si
$[g, d]$ déborde, tous les $[g, d']$ avec $d' > d$ débordent aussi, et $g$
peut avancer définitivement.

Contre-exemple immédiat : des valeurs *négatives*. Agrandir la fenêtre peut
alors faire **baisser** la somme, reculer le bord gauche redeviendrait
intéressant, et la fenêtre glissante donne des réponses fausses. La monotonie
n'est pas un détail d'implémentation, c'est l'hypothèse du théorème.

## Le « coût » est ce que vous voulez

La somme n'est qu'un exemple. La même boucle fonctionne avec :

- le **nombre de zéros** de la fenêtre (≤ $k$ rattrapages autorisés) ;
- le **nombre de valeurs distinctes** (maintenu dans un `Counter` — les
  outils de cette série se combinent) ;
- un maximum, un produit, un booléen « contient un doublon »…

Il faut juste savoir mettre à jour le coût quand un élément entre à droite et
quand un élément sort à gauche, et que le coût soit monotone en la taille de
la fenêtre.

## À vous

Le TP est le cas d'école (somme ≤ budget). Le problème d'entraînement change
le coût — comptez autre chose que la somme, la boucle ne change pas.

```tp
le-plus-long-sprint
```

## Où vous en êtes

Avec « Bien démarrer » et ce cours, vous savez lire un énoncé, estimer un
coût, et choisir entre tri, hachage, dichotomie et fenêtre glissante : de
quoi attaquer la grande majorité des problèmes faciles et moyens de la
plateforme — et les premiers contests. Bon entraînement !
