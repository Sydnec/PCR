[← README](../README.md)

# Exploitation : VM, déploiement, sauvegardes

Deux VM Proxmox identiques :
- **prod** suit `main` et porte le bot de production ;
- **dev** suit `dev` et porte la 2ᵉ application Discord, sur le serveur de test.

Le flux de déploiement :

```
push main/dev ──► GitHub Actions (build.yml) : CI → binaire → signature cosign → release
                                                             │
VM (pcr-update.timer, chaque minute) ◄── manifest.json ──────┘
   vérifie la signature (workflow build.yml + bonne branche) → sauvegarde → bascule
   → /healthz → garde, ou revient en arrière + alerte webhook
```

Aucun runner ni jeton GitHub sur les VM, et aucun port entrant pour déployer ([ADR 0004](adr/0004-deploiement-pull.md)).

## 1. Créer les VM (Proxmox)

| | prod | dev |
|---|---|---|
| vCPU / RAM / disque | 2 / 2 Go / 20 Go | 1 / 1 Go / 10 Go |
| Système | Debian 13 (image cloud `debian-13-genericcloud-amd64`) | idem |

1. Importe l'image cloud Debian 13 dans un stockage, puis crée la VM avec `qm importdisk`, ou par l'interface (disque importé, contrôleur VirtIO SCSI).
2. Dans l'onglet **Cloud-Init** :
   - utilisateur d'admin ;
   - **clé SSH** (pas de mot de passe) ;
   - IP fixe sur ton LAN ;
   - DNS.
3. Options :
   - **QEMU Guest Agent** activé (`apt install qemu-guest-agent` dans la VM) ;
   - démarrage automatique.
4. **Sauvegarde Proxmox** (vzdump) planifiée pour les deux VM. Idéalement vers un Proxmox Backup Server ou un stockage hors de l'hôte.

> L'utilisateur cloud-init a `sudo` sans mot de passe : c'est ce que suppose `copy-prod-to-dev.sh`.

## 2. DNS et reverse proxy

- **DNS** : un nom par environnement, par exemple `pokepcr.<domaine>` (prod) et `dev.pokepcr.<domaine>` (dev).
- **Reverse proxy** (celui que tu as déjà). Il termine le HTTPS et transmet à `http://<IP de la VM>:8080`.
  - **En-têtes** : transmettre `Host`, `X-Forwarded-For` et `X-Forwarded-Proto`.
  - **SSE** : couper le buffering et allonger le délai de lecture sur `/api/events` (flux des mises à jour en direct, P6).
  - **HSTS** : l'activer.

Exemple nginx, à adapter (Nginx Proxy Manager : onglet *Advanced* du proxy host) :

```nginx
location / {
    proxy_pass http://192.168.1.50:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /api/events {
    proxy_pass http://192.168.1.50:8080;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
add_header Strict-Transport-Security "max-age=31536000" always;
```

L'IP du proxy vue par la VM est à reporter dans `--proxy-ip` (pare-feu) et dans `trusted_proxy` de `instance.toml`.

## 3. Applications Discord

La **prod** garde l'application actuelle : les boutons des messages déjà postés continuent de marcher, car seul l'auteur d'un message peut l'éditer.

Pour le **dev**, sur <https://discord.com/developers/applications> :
1. Crée l'application « PCR dev », puis son bot. Note l'**Application ID** et le **token**.
2. Dans l'onglet *Bot*, active les **Privileged Gateway Intents** *Server Members* et *Message Content*. Active-les aussi sur l'application de prod.
3. Dans l'onglet *OAuth2*, note le **Client Secret** et ajoute la redirection `https://dev.pokepcr.<domaine>/api/auth/callback`.
4. Crée le serveur de test, puis invite le bot. Dans *OAuth2 › URL Generator*, choisis les scopes `bot` et `applications.commands`, et la permission *Administrator*, ou les permissions fines quand elles seront listées.
5. En mode développeur, récupère les IDs utiles : serveur, ton compte, puis les salons et rôles au fil des phases.

## 4. Provisionner une VM

Sur la VM :

```bash
sudo apt-get install -y git
git clone --depth 1 -b dev https://github.com/Sydnec/PCR /tmp/pcr
sudo /tmp/pcr/deploy/provision.sh dev --proxy-ip 192.168.1.10 --admin-net 192.168.1.0/24
```

Le script installe :
- les paquets (`curl`, `jq`, `zstd`, `sqlite3`, `nftables`, `unattended-upgrades`) ;
- cosign, à une version épinglée avec sa somme de contrôle ;
- l'utilisateur système `pcr` et les dossiers ;
- les unités systemd et le pare-feu.

Il ne touche jamais aux fichiers existants de `/etc/pcr`. Pour la prod, remplace `dev` par `prod` et clone `main`.

Complète ensuite ces fichiers :

| Fichier | Contenu | Droits |
|---|---|---|
| `/etc/pcr/instance.toml` | IDs Discord (dont `default_role_id`, le rôle des membres : sans lui, le pot commun attend ; `bet_role_id`, facultatif, le rôle appelé à chaque nouveau pari), URL publique, `trusted_proxy`, `dm_allowlist` (dev : ton ID) | `root:pcr 0640` |
| `/etc/pcr/pcr.env` | `DISCORD_TOKEN`, `DISCORD_CLIENT_SECRET` | `root:pcr 0640` |
| `/etc/pcr/update.env` | branche suivie (déjà remplie), `PCR_OPS_WEBHOOK` (webhook d'un salon ops, facultatif) | `root 0600` |

Puis active les mises à jour automatiques :

```bash
sudo systemctl enable --now pcr-update.timer
```

> Si `--admin-net` est faux, les nouvelles connexions SSH sont refusées. La session en cours reste ouverte, et la console Proxmox permet toujours de corriger `/etc/nftables.conf`.

Les changements de `deploy/` (scripts, unités) arrivent sur une VM en relançant `provision.sh` depuis un clone à jour. Les mises à jour du binaire, elles, sont automatiques.

## 5. GitHub

- *Settings › Branches* :
  - `main` : PR obligatoire et checks requis (*fmt · clippy · test*, *cargo deny*, *shellcheck*) ;
  - `dev` : mêmes checks requis.
- *Settings › Actions › General* : laisse les workflows créer des releases. `build.yml` demande lui-même `contents: write` et `id-token: write`, uniquement dans son job de publication.

## 6. Vérifier un déploiement

```bash
systemctl list-timers 'pcr-*'          # prochaines vérifications et sauvegardes
journalctl -u pcr-update -n 50         # dernier déploiement : « déployé … » ou « ÉCHEC … »
journalctl -u pcr -f                   # journaux du bot
curl -s http://127.0.0.1:8080/healthz  # {"version":…,"commit":…,"database":true,"discord":true}
readlink /opt/pcr/current              # version active (releases/<commit>)
```

Sur Discord, `/version` affiche la version, le commit et l'environnement.

## 7. Retour arrière

**Automatique.** Si `/healthz` ne répond pas dans la minute, `pcr-update` :
1. remet la version précédente ;
2. restaure l'instantané de la base pris juste avant, si les migrations ont changé ;
3. note le commit dans `/opt/pcr/failed-commits`, pour ne pas le réessayer en boucle ;
4. prévient le webhook ops.

**Manuel**, vers une version encore présente :

```bash
ls -t /opt/pcr/releases/
sudo ln -sfn /opt/pcr/releases/<commit> /opt/pcr/current && sudo systemctl restart pcr
```

Pour réessayer un commit marqué en échec (une fois la cause corrigée côté VM), supprime sa ligne dans `/opt/pcr/failed-commits`.

**Test du retour arrière.** Sur dev, pousse un commit dont le binaire ne démarre pas, par exemple un `instance.toml` volontairement invalide dans un essai local. Tu dois voir ceci : `ÉCHEC … : retour à …` dans `journalctl -u pcr-update` et sur le webhook, puis `/healthz` de nouveau vert.

**Schéma modifié avant la bascule.** Jusqu'à la bascule v2, le schéma initial (`0001_init.sql`) se
modifie sur place. Une base créée par une version antérieure refuse alors de démarrer (« was previously
applied but has been modified ») et le déploiement revient en arrière. Après ce retour arrière, sur dev,
recrée la base et relance la mise à jour (`<commit>` : celui que nomme l'alerte) :

```bash
sudo systemctl stop pcr
sudo rm -f /var/lib/pcr/pcr.db /var/lib/pcr/pcr.db-wal /var/lib/pcr/pcr.db-shm
sudo sed -i '/^<commit>$/d' /opt/pcr/failed-commits
sudo systemctl start pcr-update
```

Une sauvegarde prise avant un tel changement ne se restaure plus avec le nouveau binaire.

## 8. Sauvegardes et restauration

- **Quotidienne, à 04 h 20** : `pcr-backup.timer` écrit `/var/backups/pcr/pcr-AAAA-MM-JJ.db.zst`, une copie cohérente prise bot en marche. Les sauvegardes sont gardées 14 jours.
- **Avant chaque déploiement** : `pre-deploy-<commit>.db`, les 3 dernières.
- **Hors site** : les vzdump Proxmox de la VM. Copie aussi `/var/backups/pcr` ailleurs (PBS, rclone…).

Restaurer à la main :

```bash
sudo systemctl stop pcr
zstd -d /var/backups/pcr/pcr-2026-12-01.db.zst -o /tmp/restore.db
sudo install -o pcr -g pcr -m 0640 /tmp/restore.db /var/lib/pcr/pcr.db
sudo rm -f /var/lib/pcr/pcr.db-wal /var/lib/pcr/pcr.db-shm
sudo systemctl start pcr
```

## 9. Copier la prod sur le dev

Depuis ta machine d'admin, avec un accès SSH aux deux VM :

```bash
deploy/copy-prod-to-dev.sh pcr-prod pcr-dev
```

La dernière sauvegarde quotidienne de prod transite par ta machine (les VM ne se parlent pas), puis `pcr-import-prod` l'importe sur dev :
1. il sauvegarde la base de dev ;
2. il arrête le bot ;
3. `pcr import-prod` valide le fichier, le migre et neutralise ce qui pointe vers la prod : messages
   publics marqués disparus (le dev ne les éditera jamais), rappels en attente marqués envoyés,
   brouillons d'échange et sessions du site supprimés ;
4. il redémarre le bot.

Chaque copie prouve au passage qu'une sauvegarde se restaure.

> `pcr import-prod` refuse de tourner sur une instance `env = "prod"`.

**Tant que la prod est en v1**, sa copie vers dev passe par `pcr migrate-v1`. Récupère sur ta machine
`points.db`, `botdata-<année>.db` et `config.json` (s'il existe) depuis le dossier de données v1, de
préférence bot v1 arrêté, copie-les sur dev, puis :

```bash
sudo install -d -o pcr -g pcr /var/lib/pcr/v1
sudo install -o pcr -g pcr -m 0640 points.db botdata-2026.db config.json /var/lib/pcr/v1/
sudo systemctl stop pcr
sudo mv /var/lib/pcr/pcr.db /var/lib/pcr/pcr.db.avant-migrate-v1
sudo rm -f /var/lib/pcr/pcr.db-wal /var/lib/pcr/pcr.db-shm /var/lib/pcr/stats-2026.db
sudo runuser -u pcr -- /opt/pcr/current/pcr --config /etc/pcr/instance.toml migrate-v1 /var/lib/pcr/v1
less /var/lib/pcr/migrate-v1-report.txt
sudo systemctl start pcr
```

- `migrate-v1` lit des copies des fichiers v1, refuse un schéma v1 qui n'est pas celui de la v1 gelée
  (v1.22.1) et ne remplace jamais une base v2 existante. En cas d'échec, rien n'est écrit ; l'erreur
  nomme la table et la contrainte qu'une ligne v1 viole. Une seule conversion à la fois (dossier de
  travail commun).
- Sur dev, il neutralise la copie comme `import-prod`.
- Le rapport liste, table par table, les lignes lues, écrites, écartées ou corrigées, puis des
  contrôles (soldes, collections, paris ouverts, rappels, totaux du serveur). Un `ÉCART` dit ce qui
  manque : à comprendre avant de démarrer le bot.

