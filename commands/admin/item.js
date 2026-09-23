import { handleException, log } from "../../modules/utils.js";
import { resolveTarget } from "../../modules/members.js";
import {
  consumeItem,
  getItem,
  getItemCount,
  getItems,
  grantItem,
} from "../../modules/pokemon/items.js";

const signed = (quantity) => `${quantity > 0 ? "+" : ""}${quantity}`;

// Les helpers d'inventaire sont à callbacks. Rendus en promesses, leurs erreurs
// remontent au routeur, qui les journalise et répond, plutôt que d'être avalées
// ici. `retirer` rend false quand le sac n'en contient pas assez : ce n'est pas
// une panne, c'est une réponse.
const lire = (userId, key) =>
  new Promise((resolve, reject) =>
    getItemCount(userId, key, (err, count) => (err ? reject(err) : resolve(count)))
  );
const donner = (userId, key, quantity, source) =>
  new Promise((resolve, reject) =>
    grantItem(userId, key, quantity, { source }, (err) => (err ? reject(err) : resolve(true)))
  );
const retirer = (userId, key, quantity, source) =>
  new Promise((resolve, reject) =>
    consumeItem(userId, key, quantity, { source }, (err, done) =>
      err ? reject(err) : resolve(done)
    )
  );

// Donne — ou retire — un objet à un dresseur, ou à tous les porteurs d'un rôle.
// Elle sert à tester les effets, à dédommager à la main, et à offrir un lot à
// tout le serveur pour un événement.
//
// Contrairement à /admin points, le retrait a un plancher : un solde négatif est
// un état de jeu voulu, un sac à -2 tickets n'est rien du tout. On retire donc
// par consumeItem, qui refuse plutôt que de creuser.
export default {
  describe: (sub) =>
    sub
      .setName("item")
      .setDescription("Donne (ou retire) un objet à un dresseur ou à tout un rôle")
      .addMentionableOption((option) =>
        option
          .setName("cible")
          .setDescription("Un dresseur, ou un rôle pour servir tous ceux qui le portent")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("objet")
          .setDescription("L'objet à donner ou retirer")
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("quantite")
          .setDescription("Positif pour donner, négatif pour retirer (1 par défaut)")
          .setRequired(false)
      ),

  async autocomplete(interaction) {
    const query = String(interaction.options.getFocused() || "").toLowerCase();
    await interaction
      .respond(
        getItems()
          .filter(
            (item) =>
              item.key.toLowerCase().includes(query) ||
              item.label.toLowerCase().includes(query)
          )
          .slice(0, 25)
          .map((item) => ({ name: `${item.emoji} ${item.label}`, value: item.key }))
      )
      .catch(() => {});
  },

  async execute(interaction) {
    const key = interaction.options.getString("objet");
    const quantity = interaction.options.getInteger("quantite") ?? 1;

    const item = getItem(key);
    if (!item) {
      return interaction.editReply({
        content: `❌ \`${key}\` n'est pas un objet du catalogue.`,
      });
    }
    if (quantity === 0) {
      return interaction.editReply({ content: "❌ Une quantité de 0 ne changerait rien." });
    }

    const { user, role, members, reason } = await resolveTarget(interaction);
    if (reason) return interaction.editReply({ content: `❌ ${reason}` });

    const source = `admin:${interaction.user.id}`;
    const what = `${item.emoji} **${item.label}**`;

    if (role) {
      // Un membre après l'autre : chaque crédit est une écriture SQLite, les
      // lancer ensemble ne ferait que les mettre en file. Ni un retrait refusé
      // — sac trop léger — ni une erreur n'arrêtent les suivants : laisser
      // remonter la première aurait servi la moitié du rôle sans dire laquelle.
      let served = 0;
      let short = 0;
      let failures = 0;
      for (const member of members) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const ok = await (quantity > 0
            ? donner(member.id, key, quantity, source)
            : retirer(member.id, key, -quantity, source));
          if (ok) served++;
          else short++;
        } catch (err) {
          failures++;
          handleException(`/admin item : ${item.label} pour ${member.id} :`, err);
        }
      }
      log(
        `/admin item par ${interaction.user.username} : ${signed(quantity)} ${item.label} ` +
          `à ${served} membre(s) du rôle ${role.name}` +
          (short ? `, ${short} sans assez d'exemplaires` : "") +
          (failures ? `, ${failures} échec(s)` : "")
      );
      return interaction
        .editReply({
          content:
            `✅ **${signed(quantity)}** ${what} pour **${served}** membre(s) du rôle ` +
            `**${role.name}**.` +
            (short
              ? `\n⚠️ **${short}** n'en avai${short > 1 ? "ent" : "t"} pas **${-quantity}** : ` +
                `rien ne ${short > 1 ? "leur" : "lui"} a été retiré.`
              : "") +
            (failures ? `\n⚠️ ${failures} échec(s), voir les logs.` : ""),
        })
        .catch(() => {});
    }

    const before = await lire(user.id, key);
    if (quantity < 0 && !(await retirer(user.id, key, -quantity, source))) {
      return interaction.editReply({
        content:
          `❌ **${user.username}** n'a que **${before}** ${item.emoji} ${item.label}, ` +
          `impossible d'en retirer **${-quantity}**.`,
      });
    }
    if (quantity > 0) await donner(user.id, key, quantity, source);

    // Relecture plutôt qu'addition : grantItem et consumeItem font leur
    // arithmétique en SQL, et deux administrateurs servant le même dresseur au
    // même instant liraient tous deux l'ancien compteur. Annoncer un total qui
    // n'a jamais existé, et le journaliser, vaut moins qu'une requête de plus.
    const after = await lire(user.id, key);
    log(
      `/admin item par ${interaction.user.username} : ${signed(quantity)} ` +
        `${item.label} à ${user.username} (${before} → ${after})`
    );
    await interaction
      .editReply({
        content:
          `✅ **${signed(quantity)}** ${what} pour **${user.username}**.\n` +
          `Il en a maintenant **${after}**.`,
      })
      .catch(() => {});
  },
};
