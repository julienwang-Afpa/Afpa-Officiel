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
