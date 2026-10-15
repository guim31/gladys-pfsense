# pfSense

Suivez votre pare-feu [pfSense](https://www.pfsense.org) (CE ou Plus) depuis
Gladys, sur votre réseau local : sachez qui est à la maison grâce aux
appareils que pfSense voit, surveillez la santé du pare-feu et l'état de vos
passerelles internet, soyez prévenu quand une passerelle tombe ou quand un
appareil inconnu se connecte et, si vous l'autorisez, coupez internet sur la
tablette des enfants depuis une scène.

> **Développée sans le matériel : vos retours sont bienvenus.** Cette
> intégration a été construite et testée sur les réponses documentées du
> paquet REST API de pfSense, pas sur un vrai pare-feu. Si quelque chose ne
> marche pas comme décrit, dites-le sur le
> [forum Gladys](https://community.gladysassistant.com) ou dans les
> [issues](https://github.com/guim31/gladys-pfsense/issues).

Cette intégration n'est pas affiliée à Netgate. pfSense est une marque
d'Electric Sheep Fencing LLC (Netgate).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un pare-feu pfSense CE ou pfSense Plus joignable depuis Gladys.
- Le **paquet REST API** libre (`pfSense-pkg-RESTAPI`, API v2, de Jared
  Hendrickson) installé dessus. pfSense n'a pas d'API REST à lui : ce paquet
  en ajoute une. Il n'est pas dans le gestionnaire de paquets de pfSense : il
  s'installe en ligne de commande (voir plus bas).
- Une clé d'API, idéalement pour un utilisateur dédié aux privilèges de
  lecture seule.

## Mise en place

### Installer le paquet REST API

Dans un shell de pfSense (**Diagnostics** → **Command Prompt**, ou SSH),
lancez la commande donnée par la
[documentation du paquet](https://pfrest.org/INSTALL_AND_CONFIG/) pour votre
version, par exemple sur pfSense CE :

```
pkg-static add https://github.com/pfrest/pfSense-pkg-RESTAPI/releases/latest/download/pfSense-2.8.1-pkg-RESTAPI.pkg
```

Ouvrez ensuite **System** → **REST API** et vérifiez que l'API est activée et
que **API Key** fait partie des méthodes d'authentification.

pfSense supprime les paquets qui ne sont pas les siens quand il se met à
jour : **réinstallez le paquet après chaque mise à jour de pfSense**, sinon
Gladys perd le pare-feu.

### Un utilisateur en lecture seule et sa clé d'API

Créez un utilisateur pour Gladys plutôt que d'utiliser `admin` (**System** →
**User Manager** → **Add**). Donnez-lui seulement les privilèges des points
d'accès de l'API REST que l'intégration lit, méthode GET :

- `/api/v2/status/system`, `/api/v2/status/gateways`,
  `/api/v2/status/interfaces` : santé, passerelles, débits ;
- `/api/v2/status/dhcp_server/leases`, `/api/v2/diagnostics/arp_table` :
  présence et déclencheur « Appareil inconnu connecté » ;
- `/api/v2/system/version`, `/api/v2/system/hostname`,
  `/api/v2/routing/gateways`, `/api/v2/system/packages` : version, nom,
  interface de chaque passerelle, mises à jour de paquets ;
- `/api/v2/firewall/rules` : l'état des règles suivies.

Un privilège manquant n'est pas une erreur : les mesures correspondantes sont
sautées, et **Tester la connexion** liste ce que la clé ne peut pas lire. Les
commandes en demandent deux de plus : `/api/v2/firewall/rule` méthode PATCH
et `/api/v2/diagnostics/reboot` méthode POST.

Connectez-vous ensuite à pfSense **avec cet utilisateur**, ouvrez **System** →
**REST API** → **Keys** → **Add**, et copiez la clé : pfSense ne l'affiche
qu'une fois. Une clé a les privilèges de l'utilisateur qui l'a créée.

### La configuration

Ouvrez **Intégrations** → **pfSense** → **Configuration** :

- **Adresse du pare-feu** : l'adresse du webConfigurator, par exemple
  `https://192.168.1.1`, avec `:port` s'il n'utilise pas le 443. Sans schéma,
  HTTPS est utilisé.
- **Clé d'API** : la clé créée plus haut.
- **Accepter un certificat auto-signé** : pfSense sert son webConfigurator
  avec un certificat auto-signé si vous n'en avez pas installé d'autre. À
  cocher pour votre propre pare-feu.
- **Intervalle de rafraîchissement** : de 10 secondes à 1 minute (30 secondes
  par défaut).
- **Passerelles à suivre** : les noms des passerelles de **System** →
  **Routing** (par exemple `WAN_DHCP`), quatre au plus, séparés par des
  virgules. Vide : toutes les passerelles que pfSense surveille, quatre au
  plus.
- **Délai de départ (minutes)** : voir les capteurs de présence.
- **Règles de pare-feu à suivre** et **Autoriser les commandes** : voir les
  règles de pare-feu.
- **Langue des noms** : la langue des noms d'appareils et de
  fonctionnalités.

Cliquez ensuite sur **Tester la connexion** : le rapport nomme le pare-feu, sa
version, les passerelles et leur état, les clients vus, les règles suivies,
et ce que la clé ne peut pas lire.

## Les appareils

Ouvrez l'onglet **Découverte** de l'intégration et ajoutez ce que vous voulez
suivre.

### Le pare-feu

Un appareil pour le pare-feu, nommé d'après son nom d'hôte (ou sa plateforme
quand le nom d'hôte est celui par défaut). Ses fonctionnalités :

- **Charge du processeur**, **Mémoire utilisée** et **Disque utilisé**, en
  pourcentage ;
- **Température**, quand pfSense lit une sonde (la plupart des boîtiers
  Netgate ; pas dans une machine virtuelle) ;
- **Temps de fonctionnement**, en heures ;
- **Version de pfSense** (par exemple `2.8.1-RELEASE`) ;
- **Mise à jour de paquet disponible** : 1 quand un paquet installé a une
  version plus récente (lu toutes les heures) ;
- pour chaque passerelle suivie : **Passerelle WAN_DHCP en ligne** (1 en
  ligne, 0 coupée), **Latence WAN_DHCP** en millisecondes et **Perte de
  paquets WAN_DHCP** en pourcentage, mesurées par dpinger, le moniteur de
  passerelles de pfSense ;
- pour chaque interface WAN de ces passerelles : **Débit descendant WAN** et
  **Débit montant WAN**, en Mbit/s, moyennés sur l'intervalle de
  rafraîchissement.

### Capteurs de présence

L'onglet Découverte liste les appareils de votre réseau que pfSense voit (sa
table ARP et ses baux DHCP), nommés d'après la description de leur
réservation statique, sinon leur nom d'hôte. Chaque appareil ajouté devient un
capteur de présence avec une fonctionnalité, **Présence** : 1 tant que pfSense
le voit, 0 quand il n'a plus été vu depuis le **Délai de départ (minutes)**
(5 par défaut).

pfSense garde une entrée de sa table ARP jusqu'à 20 minutes après le dernier
échange avec un appareil : un départ apparaît jusqu'à 20 minutes, plus le
délai, après que l'appareil est parti. Un téléphone en veille reste dans la
table tant qu'il garde sa connexion Wi-Fi. Quand le pare-feu ne peut pas être
lu, aucune présence ne change : une panne n'envoie jamais toute la maison au
loin.

### Règles de pare-feu

Pour piloter une règle depuis Gladys, donnez-lui une description dans pfSense
(**Firewall** → **Rules** → modifier → **Description**), par exemple
« Bloquer tablette enfants », et saisissez-la dans **Règles de pare-feu à
suivre** (dix au plus, séparées par des virgules). **Lister les règles de
pare-feu** affiche les règles qui ont une description.

Chaque règle suivie est un appareil avec une fonctionnalité, **Règle
activée** : 1 quand la règle est activée (quand plusieurs règles partagent la
description, 1 dès que l'une l'est). Elle est en lecture seule exprès : une
règle n'est jamais un interrupteur qu'un assistant vocal pourrait basculer.
L'activer ou la désactiver passe par les actions de scène et le widget, et
seulement quand **Autoriser les commandes** est coché.

## Tableau de bord

Trois widgets :

- **Pare-feu pfSense** : processeur, mémoire, température, débits du premier
  WAN, une ligne par passerelle avec sa latence et sa perte (orange quand elle
  se dégrade, rouge quand elle est coupée), le temps de fonctionnement, la
  version et les paquets à mettre à jour. Avec **Autoriser les commandes**, un
  bouton **Redémarrer**, avec confirmation.
- **Appareils présents** : les appareils suivis, présents d'abord, avec depuis
  combien de temps chacun est absent. Un réglage n'affiche que les présents.
- **Règles de pare-feu** : les règles suivies et leur état. Avec **Autoriser
  les commandes**, un bouton par règle (quatre au plus), avec confirmation :
  l'icône montre l'état actuel, un appui le bascule.

## Scènes

### Déclencheurs

- **Passerelle coupée** : pfSense déclare une passerelle coupée (pas de
  réponse, ou perte ou latence au-delà de ses seuils). Filtre : le nom de la
  passerelle (vide : toutes). Variables : la passerelle, et la raison donnée
  par pfSense (`down`, `highloss`, `highdelay`, `force_down`).
- **Passerelle rétablie** : une passerelle coupée est de nouveau en ligne.
  Variables : la passerelle et la durée de la coupure en minutes.
- **Appareil inconnu connecté** : une adresse MAC jamais vue a obtenu un bail
  DHCP dynamique de pfSense. La première lecture apprend le réseau tel qu'il
  est, sans déclencher ; les adresses vues sont mémorisées d'un redémarrage à
  l'autre. Filtre : l'interface, telle que pfSense la nomme (par exemple
  `INVITES`). Variables : l'adresse MAC, l'adresse IP, le nom d'hôte et
  l'interface.

### Actions

Elles demandent **Autoriser les commandes**.

- **Activer une règle de pare-feu** et **Désactiver une règle de pare-feu** :
  toutes les règles de la description de l'appareil choisi, puis le pare-feu
  applique le changement. Sortie : la règle est-elle maintenant activée.
- **Redémarrer le pare-feu pfSense** : le réseau et internet sont coupés
  quelques minutes.

### Idées de scènes

- À 21 h les jours d'école, **Activer une règle de pare-feu** « Bloquer
  tablette enfants » ; à 7 h, la désactiver.
- Quand **Passerelle coupée** se déclenche, envoyer un message sur votre
  téléphone par le réseau mobile (Telegram, Gladys Plus), et la durée de la
  coupure quand **Passerelle rétablie** se déclenche.
- Quand **Appareil inconnu connecté** se déclenche sur l'interface invités,
  prévenir la maison avec le nom d'hôte de l'appareil.
- Quand tous les téléphones sont absents, baisser le chauffage.

## À quelle fréquence le pare-feu est lu

À chaque intervalle de rafraîchissement, l'intégration lit l'état du
système, l'état des passerelles, les interfaces, les baux DHCP, la table ARP
et, quand des règles sont suivies, la liste des règles : six courtes
requêtes HTTPS. La version, le nom d'hôte et la liste des passerelles sont lus
toutes les 10 minutes, la liste des paquets toutes les heures (pfSense
interroge ses serveurs de paquets, avec un cache). Une clé refusée n'est
réessayée que toutes les 5 minutes : la protection de connexion de pfSense
bloque une adresse après quelques échecs. Les valeurs inchangées ne sont
renvoyées à Gladys que toutes les 6 heures, un appareil présent toutes les
2 minutes.

## Dépannage

- **« pas d'API REST ici »** : le paquet n'est pas installé (ou une mise à
  jour de pfSense l'a supprimé), ou l'adresse n'est pas celle du
  webConfigurator. Réinstallez le paquet.
- **« certificat refusé »** : cochez **Accepter un certificat auto-signé**.
- **« clé d'API refusée »** : la clé a été révoquée ou mal copiée, ou
  **API Key** ne fait pas partie des méthodes d'authentification de
  **System** → **REST API**. Après quelques refus, pfSense bloque l'adresse de
  Gladys un moment (**System** → **Advanced** → **Login Protection**).
- **Une mesure manque** : **Tester la connexion** liste les points d'accès
  que la clé ne peut pas lire ; ajoutez le privilège à l'utilisateur.
- **Une commande de règle est refusée** : l'utilisateur a besoin du privilège
  PATCH de `/api/v2/firewall/rule` ; le redémarrage, du privilège POST de
  `/api/v2/diagnostics/reboot`.
- **Un appareil reste présent après son départ** : pfSense garde l'entrée ARP
  jusqu'à 20 minutes.
- Journaux : passez le `LOG_LEVEL` de l'intégration à `debug` pour voir
  chaque requête. La clé d'API n'est jamais écrite.

## Limites

- Développée sans le matériel, sur les réponses documentées du paquet REST
  API v2 : les premiers utilisateurs sont les testeurs.
- Le paquet REST API n'est pas un paquet officiel de pfSense ; il faut le
  réinstaller après chaque mise à jour de pfSense. Ses versions 32 bits
  (SG-3100) ne sont pas prises en charge par son auteur.
- La mise à jour du système (« une nouvelle version de pfSense est
  disponible ») n'est pas lisible par l'API REST sans lancer la mise à jour :
  seules les mises à jour de paquets sont affichées.
- Les états des baux DHCP sont des textes que pfSense peut traduire : avec un
  webConfigurator dans une autre langue que l'anglais, le déclencheur
  « Appareil inconnu connecté » peut rester muet ; la présence marche toujours
  par la table ARP.
- Un pare-feu par installation de l'intégration ; pas de paire CARP, pas de
  tunnels VPN, pas de trafic par client.
- Les commandes ne changent rien d'autre que l'état activé des règles que vous
  avez listées, et redémarrent le pare-feu. Rien d'autre n'est jamais modifié
  dans pfSense.
