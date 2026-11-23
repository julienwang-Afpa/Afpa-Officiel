# Reprise — mode équipes (en cours)
Fait : correctifs techniques de l'audit (relais animateur, plafonds de score, marge fin de manche, polling économe) ;
games.mjs : TEAMS (10 couleurs Or→Ivoire), TEAM_BONUS [2,1], teamLowerWins, perfLabel ; ×2 retiré du tirage.
À faire : serveur (pending.mode solo/team, actions mode / teams-draw avec rotation des coéquipiers / teams-set manuel / helper animateur renfort,
round.teams, bonus +2/+1 hors classement par jeu, st.history), écrans (salon, piste Course par équipe, résultats équipes, Récap 4 vues,
téléphone : team + TAPE ICI fixe), lot 1 de l'audit (rapport : https://claude.ai/artifact/3U8xYuYP9dKxG4aJAreLgU).
Décisions : 10 jeux ; Solo ou Équipes au choix pour chaque jeu ; score d'équipe = somme ; points individuels + bonus d'équipe ;
équipes inégales = avertissement avant lancement. Test local : PORT=4173 node local-test.mjs. Ne pas déployer avant validation.

## Design de référence
Les captures du dossier reference-design/ (salon, Vrai ou faux, Course) montrent la DA à garder.
Fond lie-de-vin, titres en or et en serif, cartes translucides avec un liseré doré, pastilles de couleur des joueurs.
On améliore cette interface, on ne la refait pas. Tout doit être responsive, sans défilement : grand écran 1366×768 et 1920×1080, téléphone à partir de 360×640.

## Méthode
Vérifie le code et signale les écarts avant de coder. Teste avec les robots et Playwright, puis envoie des captures.
Livre une version locale avec une checklist et un zip. Ne déploie rien.
Il n'y a plus de dossier /tmp/tests : écris un test serveur avec un magasin Blobs en mémoire.
La clôture d'une manche attend 3,5 s après sa fin (GRACE + SETTLE).
Lot 1 de l'audit, après le mode équipes :
- Bataille royale : 12 tours au maximum, personne n'est éliminé au tour 1.
- Calcul express et Mot mélangé : 1,5 s de blocage après une erreur.
- Bon tonneau : finale en 6 tours, avec de plus en plus de tonneaux piégés.
- Départage des ex æquo : victoires, puis podiums, puis duel.
- Vrai ou faux : corriger 4 affirmations, revenir à environ 50 % de « vrai », changer l'exemple de la règle.
- Messages d'erreur en français, accords (« 1 point »), règles de 20 mots au plus.
- Corriger le bug de la liste « En direct ».

## Détail du mode équipes
- **Salon :** Solo ou Équipes pour chacun des 10 jeux ; nombre d'équipes (2 à 10) ou taille cible (2, 3 ou 4 joueurs).
- **Composer les équipes :** tirage avec rotation des coéquipiers, à relancer ; placement à la main ou échange de deux joueurs ; affichage des non-placés.
- **Animateur en renfort :** il rejoint depuis son téléphone, compte pour son équipe et reste hors du classement individuel. Jamais ajouté automatiquement.
- **Équipes inégales :** avertissement avant le lancement.
- **Grand écran :**
  - avant la manche : une ligne par équipe (« Team Or : Erika, Jad… ») ;
  - Course : une piste, un tonneau par équipe ;
  - résultats : rang, performance brute, points et bonus, sur deux colonnes.
- **Téléphone :**
  - en-tête : nom de l'équipe et coéquipiers ;
  - zone d'action fixe : « TAPE ICI » dès le décompte, « STOP » en Feu rouge ;
  - résultat dans la même zone ;
  - règle suivante en haut.
- **Récap**, à côté de « Plein écran » : vues Général, Par jeu, Historique avec les équipes de l'époque, Détail joueur.
- **Bouton « Finale ×2 ».**
