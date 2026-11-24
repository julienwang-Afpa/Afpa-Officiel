// Mot mélangé : deux niveaux, environ 1 200 mots français courants, de thèmes variés.
// Facile = mots de 4 à 7 lettres de la vie courante ; difficile = mots de 8 lettres et plus.
// Les doublons sont retirés automatiquement, et un mot facile n'apparaît jamais dans la liste difficile.
// Mots composés à trait d'union exclus (ils s'écrivent mal en lettres mélangées).
const banned = new Set('chauvesouris sousmarin arcenciel croquemonsieur lavevaisselle grillepain pontlevis hautparleur porteclés mardigras dessinanimé taillecrayon ouvrebouteille reineclaude tirebouchon rond'.split(' '));
const clean = (text, min, max) => text.trim().split(/\s+/).map(w => w.toLowerCase())
  .filter((w, i, a) => /^[a-zàâäçéèêëîïôöùûüœ]+$/.test(w) && !banned.has(w) && w.length >= min && w.length <= max && a.indexOf(w) === i);

export const easyWords = clean(`
raisin vigne verre table chaise lampe livre crayon cahier école maison jardin cheval lapin canard poisson
orange banane citron cerise pomme poire fraise carotte tomate salade gâteau bougie cadeau voiture train avion
bateau plage nuage étoile hiver automne chanson danse couteau famille village moulin panier cave bouchon grappe
tonneau fromage soleil musique colline forêt rivière nappe tarte crêpe pain beurre
sucre farine poivre olive melon prune noix café thé lait miel fenêtre porte tulipe rose
oiseau chien chat souris renard hibou ballon vélo guitare piano tambour fanfare fête ruban
abeille agneau aigle âne baleine biche bison bouc brebis castor chameau chèvre cochon colombe corbeau coq
cygne dauphin dinde écureuil éléphant faucon fourmi gazelle girafe gorille grenouille guêpe hérisson
homard jaguar koala lézard lion loup lynx marmotte merle moineau mouche mouton panda panthère paon
perroquet phoque pieuvre pigeon pingouin poney poule poulain puce requin renne sardine serpent singe
taupe taureau tigre tortue truite vache vautour zèbre crabe moule huître crevette chenille papillon
abricot amande ananas avocat cassis coing datte figue goyave kiwi litchi mangue mûre myrtille noisette
pêche raisin rhubarbe ail aubergine betterave brocoli céleri chou concombre courge courgette endive
épinard fenouil haricot laitue lentille maïs navet oignon oseille panais persil piment poireau pois
radis échalote ciboule menthe thym laurier basilic cumin safran vanille cannelle muscade sel
baguette brioche croissant galette gaufre beignet biscuit bonbon caramel chocolat crème flan glace
madeleine meringue nougat praline sorbet yaourt omelette pizza quiche soupe potage purée ragoût
gratin rôti steak jambon poulet canard saucisse pâté terrine bouillon sauce moutarde vinaigre huile
cidre bière jus sirop eau limonade tisane soda apéritif dessert entrée menu repas dîner goûter
assiette bol tasse verre carafe cruche théière poêle casserole marmite louche passoire fouet
four frigo évier robinet placard tiroir étagère buffet canapé fauteuil tabouret banc lit matelas
oreiller couette drap tapis rideau miroir horloge réveil coussin vase cadre bougeoir lustre
balai éponge seau savon serviette peigne brosse rasoir parfum ciseaux aiguille bouton fil
clé serrure verrou sonnette escalier grenier cave garage balcon terrasse toit mur plafond sol
couloir salon cuisine chambre bureau douche baignoire lavabo cheminée volet portail clôture
pelouse potager verger serre haie allée bassin fontaine puits cabane grange étable ferme hangar
manteau veste pull gilet chemise jupe robe short pantalon jean chaussette chaussure botte sandale
bonnet écharpe gant casquette chapeau ceinture cravate bijou collier bague bracelet montre lunettes
sac valise parapluie portefeuille poche manche col capuche foulard tablier pyjama maillot
tête cheveux front sourcil oreille joue nez bouche lèvre langue dent menton cou épaule bras
coude poignet main doigt pouce ongle ventre dos hanche jambe genou cheville pied orteil cœur
docteur infirmier dentiste pompier policier facteur boulanger boucher fermier pêcheur peintre maçon
plombier menuisier jardinier coiffeur cuisinier serveur vendeur caissier pilote marin soldat juge
avocat acteur chanteur danseur musicien écrivain poète artiste sculpteur architecte ingénieur
football tennis rugby basket handball golf boxe judo karaté escrime natation plongée surf voile
course marathon sprint relais saut lancer cyclisme patinage ski luge bobsleigh hockey cricket
arbitre joueur équipe stade terrain piscine piste filet raquette balle but médaille coupe trophée
match tournoi champion record podium sifflet maillot entraîneur supporter victoire défaite
ville rue avenue boulevard place pont quai port gare métro bus tramway taxi camion moto
autoroute route chemin sentier carrefour rond feu trottoir parking station péage tunnel
église mairie musée théâtre cinéma château palais tour phare cathédrale chapelle marché boutique
pharmacie banque poste hôpital école collège lycée université bibliothèque librairie usine magasin
montagne vallée colline plaine plateau falaise rocher grotte volcan désert océan mer lac étang
ruisseau source cascade glacier île presqu’île côte rivage dune marais prairie champ bois jungle
pluie neige grêle orage tonnerre éclair brouillard vent tempête arc chaleur froid gel givre
printemps été automne hiver matin midi soir nuit aube aurore crépuscule minuit semaine mois année
lundi mardi mercredi jeudi vendredi samedi dimanche janvier février mars avril mai juin juillet
août septembre octobre novembre décembre heure minute seconde siècle saison journée veille
rouge bleu vert jaune orange violet rose blanc noir gris marron beige doré argenté turquoise
cercle carré triangle losange rectangle ovale étoile spirale ligne point angle courbe flèche
chiffre nombre calcul somme total moitié tiers quart double triple dizaine centaine millier
papier carton stylo gomme règle compas classeur agenda carnet enveloppe timbre lettre colis
journal revue roman conte poème fable histoire légende récit chapitre page titre auteur lecteur
photo image dessin tableau affiche carte plan globe atlas boussole loupe jumelles appareil
radio télé écran clavier souris ordinateur tablette téléphone câble prise batterie chargeur
jouet poupée peluche toupie puzzle domino dé carte échecs dames billes cerceau corde balançoire
toboggan manège cirque clown jongleur magicien acrobate dompteur parade défilé carnaval masque
costume déguisement perruque maquillage confetti guirlande lampion pétard feu fusée sapin crèche
anniversaire mariage baptême noël pâques bal soirée concert spectacle festival kermesse foire
amour amitié joie rire sourire bonheur colère peur surprise tristesse fierté courage patience
calme douceur force vitesse silence bruit secret mystère rêve idée souvenir espoir chance
voyage vacances séjour visite balade randonnée camping tente sac duvet lampe carte guide
avion billet passeport bagage hôtel auberge chambre clé accueil plage parasol serviette crème
vigneron cuve pressoir barrique cave cellier cépage vendange grappe sarment tonnelle bouchon
nez robe arôme bouquet tanin cru gamay primeur caviste verre carafe tirebouchon dégustation
roi reine prince princesse chevalier dragon fée sorcière géant lutin ogre château trésor épée
bouclier armure couronne trône royaume pirate navire capitaine boussole île coffre carte perle
planète comète lune soleil fusée astronaute satellite galaxie orbite cratère étoile météore
atome cellule énergie aimant moteur machine robot levier roue poulie ressort piston vapeur
santé repos sommeil sport régime vitamine remède sirop pansement plâtre bandage pommade
`, 4, 8);

export const hardWords = clean(`
vendange vigneron sommelier barrique pressoir terroir cépage millésime dégustation carafe magnum
bouteille tonnelier vinification fermentation macération cuverie viticulture
beaujolais primeur gamay grappillon sarment échalas coteau vignoble appellation étiquette
charcuterie saucisson rillettes quenelle cervelas andouillette fromagerie boulangerie pâtisserie
guinguette lampion confettis serpentin farandole accordéon orchestre ritournelle chanteur trinquer
convivial célébration festivité réjouissance anniversaire invitation banquet ripaille
automnal novembre récolte vendangeur hotte sécateur cuvée assemblage décantation arôme bouquet
framboise groseille myrtille châtaigne champignon citrouille potiron clémentine mandarine
hippopotame rhinocéros crocodile alligator chimpanzé kangourou orangoutan chauvesouris salamandre
hirondelle rossignol mésange pivert flamant cormoran albatros pélican autruche toucan perruche
coccinelle sauterelle libellule scarabée araignée moustique escargot limace lombric méduse
étoile hippocampe espadon cachalot dromadaire antilope chevreuil sanglier blaireau belette
pamplemousse grenadine nectarine mirabelle reineclaude cornichon artichaut asperge topinambour
ciboulette coriandre estragon romarin gingembre cardamome paprika curcuma cerfeuil
bouillabaisse cassoulet choucroute ratatouille tartiflette raclette blanquette pissaladière
croquemonsieur profiterole millefeuille éclair religieuse financier clafoutis tiramisu
confiserie chocolaterie crêperie brasserie restaurant épicerie poissonnerie boucherie
casserole cocotte saladière soupière plateau bouilloire grillepain cafetière mixeur
réfrigérateur congélateur lavevaisselle aspirateur ventilateur radiateur climatiseur
bibliothèque commode armoire penderie paravent lampadaire chandelier escabeau
salle véranda mansarde vestibule buanderie débarras cellier dépendance
imperméable salopette combinaison survêtement pardessus redingote chemisier cardigan
espadrille escarpin mocassin pantoufle chaussure bottine sandalette
anesthésiste chirurgien pharmacien vétérinaire kinésithérapeute ophtalmologue
électricien carrossier mécanicien chauffagiste charpentier couvreur forgeron
journaliste photographe illustrateur dessinateur comédien réalisateur producteur
professeur instituteur directeur secrétaire comptable bibliothécaire informaticien
astronaute astronome géologue biologiste chimiste physicien mathématicien archéologue
basketball volleyball badminton athlétisme gymnastique équitation alpinisme escalade
parachutisme planche skateboard pétanque billard bowling triathlon pentathlon
olympique championnat compétition entraînement échauffement performance classement
gendarmerie préfecture ambassade tribunal aéroport hippodrome patinoire gymnase
autoroute périphérique carrefour embouteillage stationnement signalisation
locomotive tramway hélicoptère montgolfière sousmarin paquebot catamaran trottinette
motocyclette camionnette ambulance dépanneuse corbillard limousine décapotable
archipel cordillère péninsule estuaire marécage mangrove savane toundra banquise
avalanche tremblement inondation sécheresse ouragan tourbillon arcenciel
température atmosphère thermomètre baromètre girouette anémomètre pluviomètre
mathématique géographie grammaire orthographe conjugaison vocabulaire dictionnaire
encyclopédie calendrier calculatrice ordinateur imprimante photocopieuse
téléphone smartphone télévision magnétoscope projecteur hautparleur microphone
électricité magnétisme gravitation photosynthèse respiration digestion circulation
dinosaure ptérodactyle mammouth fossile squelette préhistoire civilisation
pyramide pharaon cathédrale monastère forteresse citadelle donjon pontlevis
chevalerie tournoi seigneur vassal troubadour ménestrel jongleur saltimbanque
révolution république démocratie monarchie constitution parlement assemblée
aventurier explorateur navigateur conquérant voyageur pèlerin randonneur
imagination inspiration création invention découverte innovation expérience
gentillesse générosité politesse honnêteté solidarité fraternité tendresse
enthousiasme admiration étonnement curiosité impatience inquiétude nostalgie
magnifique merveilleux formidable extraordinaire incroyable spectaculaire
délicieux savoureux croustillant fondant moelleux pétillant rafraîchissant
mystérieux silencieux courageux généreux chaleureux joyeux heureux malicieux
chandeleur épiphanie toussaint ascension pentecôte réveillon carnaval mardigras
feuilleton dessinanimé documentaire comédie tragédie opérette symphonie
violoncelle contrebasse clarinette trompette saxophone harmonica mandoline
xylophone synthétiseur castagnettes cornemuse accordéoniste violoniste pianiste
architecture sculpture peinture aquarelle gravure tapisserie mosaïque vitrail
marionnette prestidigitateur funambule trapéziste ventriloque illusionniste
parapluie portemanteau portefeuille porteclés tirebouchon ouvrebouteille
cartable trousse surligneur taillecrayon agrafeuse perforatrice
bricolage jardinage tricotage couture broderie menuiserie poterie
arrosoir brouette râteau binette tondeuse débroussailleuse
tournesol coquelicot marguerite pâquerette jonquille chrysanthème hortensia
orchidée géranium lavande muguet glycine magnolia camélia bougainvillier
peuplier platane châtaignier marronnier noisetier bouleau sapin mélèze cyprès
`, 8, 14).filter(w => !easyWords.includes(w));
