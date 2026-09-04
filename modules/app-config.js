// Lecture mise en cache de config.json.
//
// Le fichier doit rester modifiable à chaud (tous les nombres du jeu y vivent),
// mais il était relu à chaque message du serveur — et plusieurs fois par
// lancer de ball. On garde donc la relecture, conditionnée à la date de
// modification du fichier : un `mtime` inchangé sert le cache, un `mtime`
// différent recharge. Coût : un `statSync` au lieu d'un `readFileSync` + parse.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const configPath = path.join(__dirname, "../config.json");

let cached = null;
let cachedMtimeMs = -1;

// Renvoie l'objet config brut, ou null si le fichier est absent/invalide.
// Ne lève jamais : un config.json cassé ne doit pas arrêter le bot.
export function readAppConfig() {
  try {
    const { mtimeMs } = fs.statSync(configPath);
    if (cached !== null && mtimeMs === cachedMtimeMs) return cached;

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    cached = parsed;
    cachedMtimeMs = mtimeMs;
    return parsed;
  } catch (error) {
    // On conserve la dernière valeur valide : une écriture partielle du
    // fichier ne doit pas faire retomber le jeu sur les valeurs par défaut.
    if (cached !== null) return cached;
    return null;
  }
}
