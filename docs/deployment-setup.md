# 🚀 Configuration du Déploiement Automatique

Ce guide explique comment configurer le déploiement automatique via GitHub Actions.

## 📋 Secrets GitHub Requis

Allez dans **Settings > Secrets and variables > Actions** de votre repository GitHub et ajoutez ces secrets :

### 🔑 PROD_SSH_KEY
La clé privée SSH pour se connecter au serveur de production.

```bash
# Générer une clé SSH (si pas déjà fait)
ssh-keygen -t rsa -b 4096 -C "github-actions@pcr-deploy"

# Copier la clé privée (contenu du fichier ~/.ssh/id_rsa)
cat ~/.ssh/id_rsa
```

### 🌐 PROD_SSH_HOST
L'adresse IP ou le nom d'hôte du serveur de production.

Exemple : `192.168.1.100` ou `mon-serveur.example.com`

### 👤 PROD_SSH_USER
L'utilisateur SSH sur le serveur de production.

Exemple : `sydnec` ou `ubuntu`

### 📁 PROD_PROJECT_PATH (optionnel)
Le chemin vers le projet PCR sur le serveur de production.

Par défaut : `/home/sydnec/PCR`

## 🔧 Configuration du Serveur

### 1. Autoriser la clé SSH
Sur votre serveur de production :

```bash
# Ajouter la clé publique aux authorized_keys
echo "your-public-key-here" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 2. Vérifier PM2
Assurez-vous que PM2 est installé et configuré :

```bash
# Installer PM2 globalement
npm install -g pm2

# Démarrer le bot si pas déjà fait
pm2 start index.js --name pcr
pm2 save
pm2 startup
```

### 3. Vérifier Git
Le projet doit être un repository Git avec origin configuré :

```bash
cd /home/sydnec/PCR
git remote -v  # Doit montrer l'origin GitHub
```

## 🚀 Workflow de Déploiement

1. **Développement** : Créer une feature avec `pcr feature` ou `pcr command`
2. **Finalisation** : `pcr finish` pour merger dans main
3. **Release** : `pcr release --type patch|minor|major`
4. **Déploiement** : GitHub Actions déploie automatiquement !

## 🔍 Vérification

Après configuration, le workflow :
1. ✅ Crée la release GitHub
2. ✅ Se connecte au serveur via SSH
3. ✅ Checkout le nouveau tag
4. ✅ Redémarre le bot PM2
5. ✅ Vérifie que le bot est en ligne

## 🆘 Dépannage

### Erreur de connexion SSH
- Vérifier les secrets GitHub
- Tester la connexion SSH manuellement
- Vérifier les permissions de la clé

### Erreur PM2
- Le bot doit exister dans PM2 : `pm2 list`
- Vérifier les logs : `pm2 logs pcr`

### Erreur Git
- Repository doit être configuré avec origin
- Pas de changements non committés

## 📞 Support

En cas de problème, vérifier les logs GitHub Actions dans l'onglet **Actions** du repository.
