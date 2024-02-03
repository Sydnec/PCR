# PCR.bot

## Description
Le PCR.bot est un bot Discord qui offre plusieurs fonctionnalités pour améliorer l'expérience des utilisateurs.

## Installation
1. Clonez le dépôt : `git clone https://github.com/sydnec/pcr`
2. Accédez au répertoire du bot : `cd pcr`
3. Installez les dépendances : `npm install`

## Configuration
1. Copiez le fichier `.env.example` et renommez-le en `.env`.
2. Remplissez les valeurs nécessaires dans le fichier `.env` (par exemple, le token du bot).

## Utilisation
Lancez le bot en exécutant la commande : `npm start`

## Commandes

- `/safe-place`: Permet de se libérer de manière anonyme dans le channel adapté.
  - Utilisation : `/safe-place [votre message]`

- `/poll`: Crée un sondage dans le channel adapté.
  - Utilisation : `/poll "Question du sondage" option1 option2 ...`

- `/color`: Change la couleur du pseudo de l'utilisateur.
  - Utilisation : `/color #codeCouleur`
  - Exemple : `/color #FF0000` (pour rouge)

## Auteur
Sydnec - https://github.com/sydnec


# Gestionnaire d'Entités avec Java, Gradle et HSQLDB

Ce projet propose une implémentation simple d'un gestionnaire d'entités en Java, utilisant la réflexion et le framework Gradle. Il intègre également une base de données HSQLDB en mémoire pour la persistance des entités.

## Configuration

Assure-toi d'avoir Gradle installé sur ta machine.

### Base de données HSQLDB

Le gestionnaire d'entités utilise une base de données HSQLDB en mémoire. Aucune configuration supplémentaire n'est requise.

## Utilisation

1. Clône le projet sur ta machine locale.
2. Ouvre le projet dans ton environnement de développement préféré.
3. Exécute les tâches Gradle nécessaires.

## Tâches Gradle Disponibles

- `build` : Compile le projet.
- `test` : Exécute les tests unitaires.
- `run` : Exécute l'application principale.

## Fonctionnalités

- Recherche d'entité par clé primaire.
- Fusion d'entité pour mettre à jour les modifications dans la base de données.
- Persistance d'entité dans la base de données.

## Exemple d'utilisation

Voici un exemple d'utilisation du gestionnaire d'entités dans un contexte d'application Java :

```java
// Initialisation du gestionnaire d'entités
EntityManagerImpl entityManager = new EntityManagerImpl();

// Recherche d'une entité par clé primaire
Club club = entityManager.find(Club.class, 1L);

// Modification de l'entité
club.setName("Nouveau Nom");

// Fusion de l'entité pour mettre à jour la base de données
Club mergedClub = entityManager.merge(club);

// Persistance d'une nouvelle entité
Club newClub = new Club();
newClub.setName("Club Nouveau");
entityManager.persist(newClub);

// Fermeture de la connexion à la base de données
entityManager.closeConnection();
```
