# Zammad

Votre helpdesk [Zammad](https://zammad.org) dans Gladys : le nombre de tickets
ouverts, nouveaux, en attente et en retard d’escalade, ceux non assignés, ceux
qui vous sont assignés et ceux créés aujourd'hui, pour toute l'instance et
pour les groupes de votre choix. Une scène réagit à un nouveau ticket ou à un
ticket qui a dépassé son délai d'escalade SLA, une autre ouvre un ticket
depuis un capteur ou un bouton, et le tableau de bord liste les derniers
tickets ouverts.

> **Vos retours sont les bienvenus.** Cette intégration a été testée contre un
> vrai serveur Zammad (image Docker `ghcr.io/zammad/zammad` 7.2.2, octobre
> 2026), pas encore en usage quotidien. Si quelque chose ne marche pas comme
> décrit, dites-le sur le [forum Gladys](https://community.gladysassistant.com)
> ou dans les [issues](https://github.com/guim31/gladys-zammad/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un **Zammad** joignable depuis Gladys : auto-hébergé, ou hébergé par Zammad
  (`*.zammad.com`). Testé avec Zammad 7.2 ; Elasticsearch n'est pas
  nécessaire.
- Un **jeton d'accès personnel** d'un agent Zammad. Dans Zammad : votre avatar
  → **Profil** → **Accès par jeton** → **Créer**, avec la permission
  **Tickets agent** (`ticket.agent`). Copiez-le : Zammad ne l'affiche qu'une
  fois. Si le menu manque, un administrateur active **Accès par jeton d'API**
  dans **Système** → **API**.

L'intégration voit les tickets des groupes auxquels cet agent a accès, et crée
les tickets **au nom de cet agent**. Un agent dédié, membre des groupes à
suivre, garde les choses claires.

## Configuration

1. Dans Gladys, **Intégrations** → installez **Zammad**.
2. Dans son écran **Configuration** :
   - **Adresse** : l'adresse de Zammad, comme dans le navigateur, ex.
     `https://helpdesk.example.org` (avec `:port` si besoin) ;
   - **Jeton d'accès** : le jeton créé plus haut ;
   - **Groupes suivis** (facultatif) : des noms de groupes séparés par des
     virgules, ex. `Users, Matériel`. Chacun a son propre appareil avec ses
     compteurs. Vide : l'appareil de l'instance seul ;
   - **Accepter les certificats auto-signés** : seulement pour votre propre
     serveur avec un certificat auto-signé ;
   - **Intervalle de rafraîchissement** : 1, 2 (par défaut), 5 ou 10 minutes ;
   - **Langue des noms de fonctionnalités** : les noms donnés aux
     fonctionnalités à l'ajout d'un appareil (français par défaut).
3. Cliquez sur **Tester la connexion** : elle indique combien de tickets sont
   ouverts et en retard d'escalade, et les groupes suivis qui n'existent pas.
4. Dans **Découverte**, ajoutez les appareils voulus.

Chaque lecture coûte cinq petites requêtes (l'utilisateur, les états, les
groupes, les tickets ouverts et ceux créés aujourd'hui), 1000 tickets au plus
par recherche.

## Appareils

- **Zammad** : toute l'instance (les groupes de l'agent).
- **Zammad <groupe>** : un par groupe suivi.

Fonctionnalités (compteurs, avec historique) :

| Fonctionnalité               | Sens                                                           |
| ---------------------------- | -------------------------------------------------------------- |
| Tickets ouverts              | état nouveau, ouvert, rappel en attente ou clôture en attente  |
| Nouveaux tickets             | état nouveau                                                   |
| Tickets en attente           | état rappel en attente ou clôture en attente                   |
| Tickets en retard d’escalade | ouverts, après l'heure d'escalade de leur SLA                  |
| Tickets non assignés         | ouverts, sans propriétaire                                     |
| Tickets qui me sont assignés | ouverts, au nom de l'agent du jeton (instance seulement)       |
| Tickets créés aujourd’hui    | créés depuis minuit (heure de Gladys), quel que soit leur état |

Les heures d'escalade viennent des **SLA** de Zammad : sans SLA, aucun ticket
n'est en retard. Les compteurs bougent à chaque lecture, à minuit et à la
prochaine heure d'escalade.

## Tableau de bord

Le widget **Tickets ouverts** affiche les 10 derniers tickets ouverts, avec
leur numéro, titre, état et groupe ; ceux en retard en rouge, les nouveaux en
orange. Au-dessus, deux tuiles : tickets ouverts et en retard.

Réglages : **Appareil** (vide : toute l'instance ; un appareil de groupe :
seulement ce groupe) et **Afficher les compteurs** (décochez pour ne garder
que la liste).

## Scènes

### Déclencheurs

- **Nouveau ticket Zammad** : un ticket a été créé dans un groupe de l'agent,
  vu à la lecture suivante (même s'il a été fermé entre-temps).
- **Ticket Zammad en retard d’escalade** : un ticket ouvert a dépassé son
  délai d'escalade SLA (première réponse, mise à jour ou résolution). Il part
  une fois par heure d'escalade : si une réponse fixe une nouvelle heure et
  qu'elle passe aussi, il repart.

Les deux se filtrent par **Groupe** (exactement comme dans Zammad) et
**Priorité** (les priorités par défaut `1 low`, `2 normal`, `3 high`). Ils
transmettent à la scène le titre, le numéro du ticket, l'identifiant du
ticket, le groupe, la priorité, l'état, le client et l'adresse du ticket ;
l'heure d'escalade aussi pour le second.

### Actions

- **Créer un ticket Zammad** : ouvre un ticket avec un **Titre**, dans un
  **Groupe** (nom ou numéro ; vide : le premier groupe suivi, sinon le premier
  groupe de l'agent), avec un **Texte** (vide : le titre), une **Priorité**
  (vide : celle par défaut de Zammad) et un **E-mail du client** (vide :
  l'agent du jeton ; une adresse inconnue crée le client). Les étapes
  suivantes reçoivent l'identifiant du ticket, son numéro, son titre, son
  groupe et son adresse.

### Idées de scènes

- Un détecteur de fuite dans la salle serveur : **Créer un ticket Zammad**
  « Eau détectée » dans le groupe `Matériel`, priorité `3 high`.
- **Ticket Zammad en retard d’escalade** dans le groupe `Support` : faire
  clignoter la lumière du bureau et envoyer un message avec le titre et
  l'adresse du ticket.
- **Nouveau ticket Zammad** de priorité `3 high` hors des heures de bureau :
  prévenir la personne d'astreinte.

## Dépannage

- **« jeton d'accès refusé »** : le jeton est erroné, expiré ou supprimé :
  créez-en un nouveau.
- **« le jeton n'a pas la permission tickets agent »** : recréez le jeton avec
  la permission **Tickets agent**.
- **« cette adresse ne répond pas comme Zammad »** : vérifiez l'adresse ;
  derrière un proxy inverse sous un chemin, indiquez ce chemin aussi
  (`https://example.org/zammad`).
- **« redirigé »** : indiquez directement l'adresse en `https://`.
- **« certificat refusé »** : cochez **Accepter les certificats auto-signés**
  (pour votre propre serveur seulement).
- **Jamais de ticket en retard** : Zammad ne fixe d'heure d'escalade que par
  une **SLA** (**Gérer** → **SLA**) avec un calendrier.
- Un groupe de **Groupes suivis** qui n'existe pas est ignoré : **Tester la
  connexion** le nomme.

## Limites

- Lecture toutes les 1 à 10 minutes : un nouveau ticket déclenche sa scène à
  la lecture suivante, pas à l'instant (les webhooks de Zammad ne servent
  pas).
- 1000 tickets au plus par recherche : au-delà, les compteurs s'arrêtent à 1000.
- Le filtre de priorité propose les priorités par défaut de Zammad ; une
  priorité renommée ne s'y choisit pas.
- Un ticket créé pendant un arrêt de plus d'une heure de l'intégration ou de
  Zammad ne déclenche pas sa scène.
- Sans lien avec Zammad GmbH ni la Zammad Foundation.
