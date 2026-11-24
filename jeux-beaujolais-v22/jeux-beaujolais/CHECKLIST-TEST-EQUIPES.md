# Checklist — mode Équipes (test en salle, non déployé)

## Avant la soirée
- [ ] `npm test` : 20 tests verts
- [ ] Lancer le serveur local, ouvrir l'écran de jeu sur le projecteur (1920×1080 et 1366×768 : pas de défilement)
- [ ] Tester au moins 2 téléphones réels (360×640 et un plus grand) : scan du QR code, pseudo, couleur

## Parcours équipes
- [ ] Salon : Solo / Équipes, taille « 3 joueurs », tirage automatique, pas de paires répétées
- [ ] Démarrage refusé tant qu'un joueur n'est pas placé
- [ ] Équipes inégales : confirmation demandée, puis lancement possible
- [ ] Renfort : n'est pas classé individuellement en manche d'équipes
- [ ] Manche Course des tonneaux : totaux d'équipe, bonus +2 / +1 (+1 seulement avec 3 équipes ou plus)
- [ ] Top départ : la plus petite somme de meilleurs temps gagne
- [ ] Récap (bouton 📋) : s'ouvre et se ferme ; il ne se rouvre pas après un rechargement
- [ ] Manche d'essai : aucun point ni bonus, pas d'entrée dans l'historique

## Choix d'interprétation à valider
- Score d'équipe = somme des performances des membres (une équipe plus grande peut avantager)
- Bonus d'équipe ajouté au classement général, pas au tableau de la manche
- Renfort : contribue à la somme, ne reçoit ni points individuels ni bonus
- Toutes les places doivent être remplies avant lancement
- « Finale ×2 » : variante active uniquement via son bouton

## Points restants (hors mode équipes)
- Audit lot 1 non traité (Bataille royale, délais d'erreur, Vrai ou faux, libellés en français)
- Zone « résultat » du téléphone non reprise à l'identique

## Quiz (banque de 3 000 questions)
- [ ] Les téléphones affichent le vote du thème ; le décompte apparaît sur l'écran organisateur
- [ ] Le thème le plus voté est joué (égalité ou aucun vote : tirage au sort)
- [ ] Un thème joué est grisé « Déjà joué » et n'est plus proposé au vote
- [ ] Les quatre choix sont dans le même ordre sur le grand écran et les téléphones, même après rechargement
- [ ] Les questions vont du facile au difficile, sans répétition dans la soirée

## Téléphone
- [ ] Plus de bloc de règles avant une manche : nom du jeu, variante et vote seulement
- [ ] En équipes : le résultat affiche « +N bonus d'équipe au général » et « Ne équipe sur M »

## v16
- [ ] Quiz : à la révélation, les 4 réponses restent affichées, mauvaises grisées, bonne en vert, ton choix marqué
- [ ] Course des tonneaux : même piste en solo et en équipes, tonneaux qui glissent et roulent, actualisation ~0,7 s
- [ ] En équipes : avancée de chaque membre sous la piste de son équipe
- [ ] Trouve l'intrus : 1 point par intrus, plus de « +2 »
- [ ] Top départ : un seul message « Attends le vert »
- [ ] Classement général : affiché tout de suite avec les bons points (plus de 0), regroupé par équipe
- [ ] Classement d'un jeu : score du jeu + (points apportés au général)
- [ ] En équipes : aucun point individuel, seul le bonus d'équipe ; ⭐ meilleur joueur de chaque équipe
- [ ] Mémoire Flash : 16 fruits, palette tirée au hasard à chaque suite (6, puis 8, puis 10 fruits)
- [ ] Mot mélangé : ~1 200 mots, pas de mot déjà vu par le joueur dans la soirée

## v17
- [ ] Quiz : « X / N ont répondu » sur le grand écran, réponse révélée dès que tout le monde a répondu
- [ ] Sons (écran organisateur) : tic-tac 3-2-1, top départ, révélation, jingle des résultats, dépassement ; bouton 🔊 / 🔇
- [ ] Salon : règle repliable, bouton « Lancer » toujours visible
- [ ] Équipes : ⇄ déplace, ✕ retire ; un joueur retiré apparaît dans « À placer » avec « + Or / + Argent »
- [ ] Récap → 🏆 Palmarès : podium, équipe championne, meilleur score par jeu
- [ ] Téléphone en équipes : ton équipe détaillée, les autres en une ligne

## v18
- [ ] Quiz : +1 à la bonne réponse la plus rapide (« ⚡ … réponse la plus rapide »), « +2 » sur le téléphone concerné
- [ ] Quiz : 5 thèmes tirés au sort pour le vote
- [ ] Urgence : 5 dernières secondes en rouge qui bat, bord de l'écran rouge, vibration 3-2-1 sur téléphone
- [ ] Classement général : ▲/▼ places gagnées ou perdues, « ex æquo », écart avec le joueur devant sur ta ligne
- [ ] Téléphone entre deux manches : carte « Ta position » avec l'écart
- [ ] Symbole par équipe (◆ Or, ▲ Argent, ■ Cuivre…) partout où une équipe est nommée
- [ ] Raccourcis : Espace lancer / revenir, R récap, S son, F plein écran, 1-2-3 vues des résultats

## v19
- [ ] Quiz : vote sur tous les thèmes encore jouables ; au lancement, une roulette tourne sur les thèmes votés (plus de votes = plus de chances) et s'arrête 2 s avant le départ
- [ ] Le thème reste caché sur les téléphones jusqu'à l'arrêt de la roulette ; un thème joué ne revient pas

## v21 (version finale)
- [ ] Bonneteau : choix du mode Classique (10 séries notées) ou Survie avant chaque manche
- [ ] Bonneteau survie : même mélange pour tous, choix sans chrono, révélation dès que tous les survivants ont choisi, 1 point par tour réussi, score figé à la 1re erreur (message « éliminé du classement… »), survivants à gauche et classement à droite
- [ ] Top départ en équipes : somme des meilleurs temps de chaque membre (le plus petit total gagne)
- [ ] Top départ : bouton « ⚔️ Duel final » (en équipes : le joueur le plus rapide de chacune des deux meilleures équipes) après la manche ; les deux duellistes jouent sur leur téléphone, les autres regardent le grand écran
- [ ] Le Bon Tonneau : 16 tonneaux, poseur tiré au sort sans répétition (puis parmi les éliminés), pièges 2 → 12 (équipes : par taille d'équipe), poseurs protégés, révélation poseur par poseur
- [ ] Ambiance : bulles en fond, transitions douces, boutons plus réactifs
