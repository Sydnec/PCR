import sqlite3 from "sqlite3";
import path from "path";
import { handleException } from "./utils.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Persistent DB for points (does not reset yearly)
const dbPath = path.join(__dirname, "../points.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    handleException("Erreur lors de l'ouverture de la base de données points :", err);
  } else {
    // Table des points utilisateurs
    db.run(
      `CREATE TABLE IF NOT EXISTS points (
        user_id TEXT PRIMARY KEY, 
        balance INTEGER DEFAULT 0,
        last_message_at INTEGER DEFAULT 0,
        messages_today_count INTEGER DEFAULT 0,
        last_reset_date TEXT
      )`,
      (err) => {
        if (err) handleException("Erreur création table points :", err);
        else {
            // Migration (add columns if not exists for old DBs)
            const addColumn = (colName, colType) => {
                db.run(`ALTER TABLE points ADD COLUMN ${colName} ${colType}`, () => {
                    // Ignore duplicate column error
                });
            }
            addColumn("last_message_at", "INTEGER DEFAULT 0");
            addColumn("messages_today_count", "INTEGER DEFAULT 0");
            addColumn("last_reset_date", "TEXT");
        }
      }
    );

    // ================== POT COMMUN ==================

    // État de l'économie : une seule ligne, qui porte l'échéance du prochain
    // pot commun. C'est elle qui sert de verrou — l'UPDATE gardé de
    // claimRedistribution ne peut réussir qu'une fois par échéance, même si
    // deux ticks se chevauchent.
    //
    // 0 signifie « jamais planifié » : le premier tick pose l'échéance sans
    // rien redistribuer, sinon une installation neuve prélèverait tout le monde
    // dès sa première heure.
    db.run(
      `CREATE TABLE IF NOT EXISTS economy_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        next_redistribution_at INTEGER NOT NULL DEFAULT 0,
        redistribution_since INTEGER NOT NULL DEFAULT 0
      )`,
      (err) => {
        if (err) return handleException("Erreur création table economy_state :", err);
        // Bail d'exécution : empêche deux pots de tourner en même temps, ce que
        // l'échéance seule ne garantit pas puisque /admin potcommun la
        // contourne. Sa péremption évite qu'un arrêt en plein pot ne bloque
        // tous les suivants.
        db.run(
          "ALTER TABLE economy_state ADD COLUMN redistribution_since INTEGER NOT NULL DEFAULT 0",
          (err) => {
            if (err && !err.message.includes("duplicate column")) {
              handleException("Erreur lors de l'ajout de redistribution_since :", err);
            }
            db.run("INSERT OR IGNORE INTO economy_state (id) VALUES (1)", (err) => {
              if (err) handleException("Erreur initialisation economy_state :", err);
            });
          }
        );
      }
    );

    // Journal des pots communs : piste d'audit d'un mouvement qui touche tous
    // les soldes d'un coup, et source du « depuis le dernier pot ».
    db.run(
      `CREATE TABLE IF NOT EXISTS points_redistributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ran_at INTEGER NOT NULL,
        triggered_by TEXT,
        rate REAL NOT NULL,
        participants INTEGER NOT NULL,
        contributors INTEGER NOT NULL,
        pot INTEGER NOT NULL,
        share INTEGER NOT NULL,
        failures INTEGER NOT NULL DEFAULT 0
      )`,
      (err) => {
        if (err) return handleException("Erreur création table points_redistributions :", err);
        db.run(
          "ALTER TABLE points_redistributions ADD COLUMN failures INTEGER NOT NULL DEFAULT 0",
          (err) => {
            if (err && !err.message.includes("duplicate column")) {
              handleException("Erreur lors de l'ajout de failures :", err);
            }
          }
        );
      }
    );

    // Table des paris
    db.run(
      `CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creator_id TEXT,
        title TEXT,
        status TEXT DEFAULT 'OPEN',
        winning_option_index INTEGER,
        is_estimation INTEGER DEFAULT 0
      )`,
      (err) => {
        if (err) handleException("Erreur création table bets :", err);
        else {
             // Migration for type
             db.run(`ALTER TABLE bets ADD COLUMN is_estimation INTEGER DEFAULT 0`, () => {});
        }
      }
    );

    // Table des options de paris
    db.run(
      `CREATE TABLE IF NOT EXISTS bet_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bet_id INTEGER,
        option_index INTEGER,
        label TEXT,
        FOREIGN KEY(bet_id) REFERENCES bets(id)
      )`,
      (err) => {
        if (err) handleException("Erreur création table bet_options :", err);
      }
    );

    // Table des participations aux paris
    db.run(
      `CREATE TABLE IF NOT EXISTS bet_participations (
        bet_id INTEGER,
        user_id TEXT,
        option_index INTEGER,
        amount INTEGER,
        prediction_value INTEGER,
        PRIMARY KEY(bet_id, user_id),
        FOREIGN KEY(bet_id) REFERENCES bets(id)
      )`,
      (err) => {
        if (err) handleException("Erreur création table bet_participations :", err);
        else {
             // Migration for prediction_value
             db.run(`ALTER TABLE bet_participations ADD COLUMN prediction_value INTEGER`, () => {});
        }
      }
    );

    // ================== SYSTÈME POKÉMON ==================
    // Ces tables vivent dans points.db (persistante) et surtout pas dans
    // modules/db.js, dont le fichier change chaque 1er janvier : les
    // collections des dresseurs seraient effacées tous les ans.

    // État global du système. Une seule ligne, qui sert de point de
    // sérialisation au déclenchement des spawns (cf. pokemon/spawn.js).
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        message_count INTEGER NOT NULL DEFAULT 0,
        last_spawn_at INTEGER NOT NULL DEFAULT 0,
        spawning INTEGER NOT NULL DEFAULT 0,
        total_spawns INTEGER NOT NULL DEFAULT 0,
        spawn_paused_until INTEGER NOT NULL DEFAULT 0
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_state :", err);
        // Pause des apparitions pendant un parc safari. Vit ici plutôt que dans
        // pokemon_safari_parks pour tenir dans l'UPDATE gardé qui revendique un
        // spawn : une garde de plus, aucune requête supplémentaire, aucune course.
        db.run(
          "ALTER TABLE pokemon_state ADD COLUMN spawn_paused_until INTEGER NOT NULL DEFAULT 0",
          (err) => {
            if (err && !err.message.includes("duplicate column")) {
              handleException("Erreur lors de l'ajout de spawn_paused_until :", err);
            }
            db.run("INSERT OR IGNORE INTO pokemon_state (id) VALUES (1)", (err) => {
              if (err) handleException("Erreur initialisation pokemon_state :", err);
            });
          }
        );
      }
    );

    // Spawns. catch_rate est figé à l'apparition : régénérer le dataset ou
    // changer la config ne doit jamais modifier les chances d'un spawn en cours.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_spawns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        catch_rate INTEGER NOT NULL,
        rarity TEXT,
        channel_id TEXT,
        message_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        spawned_at INTEGER NOT NULL,
        throw_count INTEGER NOT NULL DEFAULT 0,
        caught_by TEXT,
        caught_at INTEGER,
        caught_ball TEXT,
        ended_at INTEGER
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_spawns :", err);
        // Garantie au niveau base : jamais deux spawns actifs en même temps.
        db.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_spawn_active
             ON pokemon_spawns(status) WHERE status = 'ACTIVE'`,
          (err) => {
            if (err) handleException("Erreur création index pokemon_spawn_active :", err);
          }
        );
        // Échéance de fuite autonome, tirée au sort à la création du spawn.
        // Migration pour les bases antérieures : l'erreur « duplicate column »
        // signifie simplement que la colonne est déjà là.
        // L'index doit être créé DANS le callback de l'ALTER : sqlite3
        // n'ordonne pas deux db.run successifs, et l'index référencerait une
        // colonne qui n'existe pas encore.
        db.run("ALTER TABLE pokemon_spawns ADD COLUMN flees_at INTEGER", (err) => {
          if (err && !err.message.includes("duplicate column")) {
            handleException("Erreur lors de l'ajout de flees_at :", err);
          }
          db.run(
            "CREATE INDEX IF NOT EXISTS idx_pokemon_spawns_flees ON pokemon_spawns(status, flees_at)",
            (err) => {
              if (err) handleException("Erreur création index pokemon_spawns_flees :", err);
            }
          );
          // L'objet que tient le Pokémon, tiré à l'apparition comme le shiny et
          // le taux de capture. Dans la ligne et pas ailleurs : ce qu'il porte
          // ne doit pas changer entre le moment où il apparaît et celui où
          // quelqu'un l'attrape, ni se rejouer à chaque lancer.
          db.run("ALTER TABLE pokemon_spawns ADD COLUMN held_item TEXT", (err) => {
            if (err && !err.message.includes("duplicate column")) {
              handleException("Erreur lors de l'ajout de held_item :", err);
            }
          });
          // Le sexe du Pokémon apparu, tiré à l'apparition pour que l'annonce
          // le montre — et c'est celui qu'aura l'individu capturé. NULL pour
          // une espèce asexuée, et pour les apparitions d'avant la colonne,
          // dont le sexe se tire à la capture comme autrefois.
          db.run("ALTER TABLE pokemon_spawns ADD COLUMN sex TEXT", (err) => {
            if (err && !err.message.includes("duplicate column")) {
              handleException("Erreur lors de l'ajout du sexe des apparitions :", err);
            }
          });
        });
      }
    );

    // Journal des lancers : alimente l'embed en direct, les statistiques, et
    // sert de piste d'audit pour les remboursements (result = 'VOID').
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_throws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spawn_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        ball TEXT NOT NULL,
        cost INTEGER NOT NULL,
        probability REAL,
        result TEXT NOT NULL,
        thrown_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_throws :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_throws_spawn ON pokemon_throws(spawn_id, id)",
          (err) => {
            if (err) handleException("Erreur création index pokemon_throws_spawn :", err);
          }
        );
      }
    );

    // Ancienne collection : un compteur par espèce. Elle n'est plus ni lue ni
    // écrite par le jeu — pokemon_owned l'a remplacée — et ne sert qu'une fois,
    // de source à la migration vers les individus. Gardée telle quelle : c'est
    // la sauvegarde de ce que chacun possédait avant la migration.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_collection (
        user_id TEXT NOT NULL,
        species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        count INTEGER NOT NULL DEFAULT 0,
        first_caught_at INTEGER,
        last_caught_at INTEGER,
        PRIMARY KEY (user_id, species_id, is_shiny)
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_collection :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_collection_user ON pokemon_collection(user_id)",
          (err) => {
            if (err) handleException("Erreur création index pokemon_collection_user :", err);
          }
        );
      }
    );

    // Les Pokémon eux-mêmes, un par ligne. Un compteur par espèce ne savait pas
    // dire qu'un Pikachu est une femelle, qu'il a été pris à l'Hyper Ball, ni
    // qu'il a déjà pondu : tout ce qui distingue deux individus vit ici.
    //
    // - `sex` : M, F, ou NULL pour une espèce asexuée des jeux (Magnéti,
    //   Métamorph, les légendaires…). La définition doit rester identique à
    //   celle que reconstruit migration.js.
    // - `ball` : la ball de capture (clé de la config, ou « safari »), NULL
    //   quand il n'y en a pas eu — éclos d'un œuf — ou qu'on ne la sait plus.
    // - `origin` : comment le dresseur actuel l'a obtenu (capture, safari,
    //   evolution, echange, oeuf, migration).
    // - `sterile` : un individu ne pond qu'un œuf dans sa vie.
    // - `obtained_at` : depuis quand ce dresseur le possède. Aucune revente,
    //   évolution ni échange ne peut prendre le dernier individu d'une espèce,
    //   shiny ou non : il en reste toujours au moins un.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_owned (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        sex TEXT CHECK (sex IN ('M', 'F')),
        ball TEXT,
        origin TEXT NOT NULL,
        sterile INTEGER NOT NULL DEFAULT 0,
        obtained_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_owned :", err);
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_pokemon_owned_entry
             ON pokemon_owned(user_id, species_id, is_shiny)`,
          (err) => {
            if (err) handleException("Erreur création index pokemon_owned_entry :", err);
            // Les migrations partent d'ici, une fois la table là. Import
            // dynamique : elles ont besoin de cette base, qui ne peut pas les
            // importer en tête sans cycle.
            import("./pokemon/migration.js")
              .then(({ runMigrations }) => runMigrations())
              .catch((error) => handleException("Migration de la collection :", error));
          }
        );
      }
    );

    // Œufs. Un seul en couvaison par dresseur, garanti en base comme la session
    // de safari. Le seuil de messages et l'échéance sont figés à la ponte :
    // retoucher la configuration ne doit pas changer la règle d'un œuf déjà pondu.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_eggs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        species_id INTEGER NOT NULL,
        father_id INTEGER,
        mother_id INTEGER,
        father_species_id INTEGER NOT NULL,
        mother_species_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'INCUBATING',
        messages INTEGER NOT NULL DEFAULT 0,
        hatch_messages INTEGER NOT NULL,
        laid_at INTEGER NOT NULL,
        hatch_at INTEGER NOT NULL,
        hatched_at INTEGER,
        pokemon_id INTEGER
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_eggs :", err);
        // Combien de parents étaient shiny à la ponte : chacun multiplie les
        // chances de shiny du bébé, même s'il est parti avant l'éclosion.
        db.run(
          "ALTER TABLE pokemon_eggs ADD COLUMN shiny_parents INTEGER NOT NULL DEFAULT 0",
          (err) => {
            if (err && !err.message.includes("duplicate column")) {
              handleException("Erreur lors de l'ajout de shiny_parents :", err);
            }
          }
        );
        db.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_eggs_incubating
             ON pokemon_eggs(user_id) WHERE status = 'INCUBATING'`,
          (err) => {
            if (err) handleException("Erreur création index pokemon_eggs_incubating :", err);
          }
        );
      }
    );

    // Offres d'échange. expires_at permet une expiration paresseuse dans le
    // WHERE de l'acceptation : aucun cron n'est nécessaire à la correction.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        offer_species_id INTEGER NOT NULL,
        offer_is_shiny INTEGER NOT NULL DEFAULT 0,
        request_species_id INTEGER NOT NULL,
        request_is_shiny INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resolved_at INTEGER,
        channel_id TEXT,
        message_id TEXT
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_trades :", err);
        // Chaque côté désigne un groupe d'individus : espèce, variante, sexe et
        // fertilité. NULL — les offres d'avant les individus — veut dire
        // « n'importe lequel ».
        // Ou un individu précis, désigné par son identifiant (#123).
        const columns = [
          "offer_sex TEXT",
          "offer_fertile INTEGER",
          "request_sex TEXT",
          "request_fertile INTEGER",
          "offer_pokemon_id INTEGER",
          "request_pokemon_id INTEGER",
        ];
        for (const column of columns) {
          db.run(`ALTER TABLE pokemon_trades ADD COLUMN ${column}`, (err) => {
            if (err && !err.message.includes("duplicate column")) {
              handleException(`Erreur lors de l'ajout de ${column} :`, err);
            }
          });
        }
      }
    );

    // Journal des évolutions (audit et statistiques). La table garde son nom
    // d'avant, quand on parlait de fusion ; `duplicates_spent` compte les
    // sacrifices.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_fusions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        from_species_id INTEGER NOT NULL,
        to_species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        duplicates_spent INTEGER NOT NULL,
        points_spent INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) handleException("Erreur création table pokemon_fusions :", err);
      }
    );

    // ================== OBJETS ==================

    // Le sac des dresseurs. Un objet n'est rien d'autre qu'un compteur par clé :
    // c'est le catalogue, dans la configuration, qui lui donne un nom, une icône
    // et un sens — et le code qui lui donne un effet, s'il en a un.
    //
    // La ligne survit à count = 0, comme dans pokemon_collection et pour la même
    // raison : first_obtained_at raconte depuis quand le dresseur connaît
    // l'objet, et ça ne se retrouve pas après coup. TOUTE lecture filtre donc
    // sur count > 0.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_inventory (
        user_id TEXT NOT NULL,
        item_key TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        first_obtained_at INTEGER,
        last_obtained_at INTEGER,
        PRIMARY KEY (user_id, item_key)
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_inventory :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_inventory_user ON pokemon_inventory(user_id)",
          (err) => {
            if (err) handleException("Erreur création index pokemon_inventory_user :", err);
          }
        );
      }
    );

    // Journal des mouvements d'objets, sur le modèle de pokemon_fusions : le
    // compteur dit ce qu'on a, le journal dit d'où ça vient. Un objet consommé
    // disparaît du sac et ne laisserait aucune trace autrement — or c'est
    // précisément ce qu'on voudra relire le jour où un dresseur jure n'avoir
    // jamais reçu son ticket.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_item_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        item_key TEXT NOT NULL,
        delta INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_item_log :", err);
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_pokemon_item_log_user
             ON pokemon_item_log(user_id, id)`,
          (err) => {
            if (err) handleException("Erreur création index pokemon_item_log_user :", err);
          }
        );
      }
    );

    // Journal des reventes de doublons. Une vente détruit définitivement des
    // exemplaires : le compteur de la collection ne dira jamais qu'ils ont
    // existé, et c'est bien ce qu'on voudra relire. Les objets, eux, ont déjà
    // leur journal.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        quantity INTEGER NOT NULL,
        points INTEGER NOT NULL,
        sold_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_sales :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_sales_user ON pokemon_sales(user_id, id)",
          (err) => {
            if (err) handleException("Erreur création index pokemon_sales_user :", err);
          }
        );
      }
    );

    // Objets tombés par terre. Un Pokémon qui s'en va — capturé ou enfui — lâche
    // parfois ce qu'il tenait, et le premier à cliquer le ramasse. Une ligne par
    // objet au sol, avec le même verrou que partout ailleurs : un UPDATE gardé
    // sur le statut, donc exactement un cliqueur repart avec.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_drops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spawn_id INTEGER,
        item_key TEXT NOT NULL,
        species_id INTEGER,
        status TEXT NOT NULL DEFAULT 'OPEN',
        channel_id TEXT,
        message_id TEXT,
        dropped_at INTEGER NOT NULL,
        claimed_by TEXT,
        claimed_at INTEGER
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_drops :", err);
        db.run(
          "CREATE INDEX IF NOT EXISTS idx_pokemon_drops_open ON pokemon_drops(status, id)",
          (err) => {
            if (err) handleException("Erreur création index pokemon_drops_open :", err);
          }
        );
      }
    );

    // Loterie quotidienne. Une ligne par dresseur, et `last_day` porte à elle
    // seule la règle du « une fois par jour » : c'est la colonne que garde
    // l'écriture de pokemon/lottery.js, donc deux commandes lancées en même
    // temps ne peuvent pas tirer deux fois.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_lottery (
        user_id TEXT PRIMARY KEY,
        last_day TEXT NOT NULL DEFAULT '',
        last_draw_at INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0
      )`,
      (err) => {
        if (err) handleException("Erreur création table pokemon_lottery :", err);
      }
    );

    // ================== PARC SAFARI ==================

    // Un parc est l'événement public : le message à bouton, sa fenêtre
    // d'ouverture, et la pause de spawn qu'il déclenche. Une entrée payante
    // (/pk safari) n'en crée pas : elle ouvre directement une session.
    // reserved_for porte les parcs offerts à un dresseur précis par un
    // administrateur : même message, même bouton, mais un seul ayant droit.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_safari_parks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        opened_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        opened_by TEXT,
        reserved_for TEXT,
        channel_id TEXT,
        message_id TEXT,
        entries INTEGER NOT NULL DEFAULT 0,
        closed_at INTEGER
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_safari_parks :", err);
        // Jamais deux parcs PUBLICS ouverts à la fois, comme pour les spawns. Les
        // parcs réservés échappent à l'index : ils ne se marchent pas dessus,
        // chacun n'ayant qu'un seul ayant droit.
        db.run(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_safari_park_open
             ON pokemon_safari_parks(status) WHERE status = 'OPEN' AND reserved_for IS NULL`,
          (err) => {
            if (err) handleException("Erreur création index pokemon_safari_park_open :", err);
          }
        );
      }
    );

    // Sessions de chasse. La rencontre en cours vit dans la ligne : rien en
    // mémoire, donc les boutons répondent encore après un redémarrage.
    // encounter_catch_rate est figé à la rencontre, pour la même raison que sur
    // pokemon_spawns — régénérer le dataset ne doit pas changer une partie en cours.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_safari_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        park_id INTEGER,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        actions_left INTEGER NOT NULL,
        entry_cost INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ended_at INTEGER,
        balls_thrown INTEGER NOT NULL DEFAULT 0,
        baits_used INTEGER NOT NULL DEFAULT 0,
        flees INTEGER NOT NULL DEFAULT 0,
        catches INTEGER NOT NULL DEFAULT 0,
        encounter_no INTEGER NOT NULL DEFAULT 0,
        encounter_species_id INTEGER,
        encounter_is_shiny INTEGER NOT NULL DEFAULT 0,
        encounter_catch_rate INTEGER,
        encounter_bait INTEGER NOT NULL DEFAULT 0,
        shared_at INTEGER
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_safari_sessions :", err);
        // Partage du bilan : une seule fois par visite. La colonne sert de
        // verrou — un UPDATE gardé dessus, comme partout ailleurs ici — plutôt
        // que de compter sur la disparition du bouton côté client.
        //
        // La suite est DANS le callback, comme les autres migrations de ce
        // fichier : sqlite3 n'ordonne pas deux db.run successifs, et rien de ce
        // qui touche à la nouvelle colonne ne doit partir avant qu'elle existe.
        // Le sexe de la rencontre, comme celui d'une apparition : tiré quand
        // elle arrive, montré, puis donné à l'individu capturé.
        db.run("ALTER TABLE pokemon_safari_sessions ADD COLUMN encounter_sex TEXT", (err) => {
          if (err && !err.message.includes("duplicate column")) {
            handleException("Erreur lors de l'ajout du sexe des rencontres :", err);
          }
        });
        db.run("ALTER TABLE pokemon_safari_sessions ADD COLUMN shared_at INTEGER", (err) => {
          if (err && !err.message.includes("duplicate column")) {
            handleException("Erreur lors de l'ajout de shared_at :", err);
          }
          // Une seule session à la fois par dresseur, garanti en base.
          db.run(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_safari_session_active
               ON pokemon_safari_sessions(user_id) WHERE status = 'ACTIVE'`,
            (err) => {
              if (err) {
                return handleException(
                  "Erreur création index pokemon_safari_session_active :",
                  err
                );
              }
              // Une entrée gratuite par dresseur et par parc. park_id NULL (entrée
              // payante) échappe à l'index : SQLite traite chaque NULL comme distinct,
              // donc les /pk safari successifs restent possibles.
              db.run(
                `CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_safari_session_park
                   ON pokemon_safari_sessions(park_id, user_id) WHERE park_id IS NOT NULL`,
                (err) => {
                  if (err) {
                    handleException("Erreur création index pokemon_safari_session_park :", err);
                  }
                }
              );
            }
          );
        });
      }
    );

    // Captures du parc : alimente le bilan de fin de session.
    db.run(
      `CREATE TABLE IF NOT EXISTS pokemon_safari_catches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        species_id INTEGER NOT NULL,
        is_shiny INTEGER NOT NULL DEFAULT 0,
        caught_at INTEGER NOT NULL
      )`,
      (err) => {
        if (err) return handleException("Erreur création table pokemon_safari_catches :", err);
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_pokemon_safari_catches_session
             ON pokemon_safari_catches(session_id, id)`,
          (err) => {
            if (err) handleException("Erreur création index pokemon_safari_catches_session :", err);
          }
        );
      }
    );
  }
});

export default db;
