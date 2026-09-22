import { log } from "../../modules/utils.js";
import {
  consumeItem,
  getItem,
  getItemCount,
  getItems,
  grantItem,
} from "../../modules/pokemon/items.js";

// Donne — ou retire — un objet à un dresseur. Tant qu'aucun trésor ne tombe
// tout seul, c'est la seule porte d'entrée du sac : elle sert à tester les
// effets et à dédommager à la main.
//
// Contrairement à /admin points, le retrait a un plancher : un solde négatif est
// un état de jeu voulu, un sac à -2 tickets n'est rien du tout. On retire donc
// par consumeItem, qui refuse plutôt que de creuser.
export default {
  describe: (sub) =>
    sub
      .setName("item")
      .setDescription("Donne (ou retire) un objet à un dresseur")
      .addUserOption((option) =>
        option.setName("membre").setDescription("Le dresseur concerné").setRequired(true)
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
    const target = interaction.options.getUser("membre");
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

    const before = await new Promise((resolve, reject) =>
      getItemCount(target.id, key, (err, count) => (err ? reject(err) : resolve(count)))
    );

    // Les helpers sont à callbacks ; les erreurs remontent au routeur, qui les
    // journalise et répond, plutôt que d'être avalées ici.
    if (quantity < 0) {
      const removed = await new Promise((resolve, reject) =>
        consumeItem(
          target.id,
          key,
          -quantity,
          { source: `admin:${interaction.user.id}` },
          (err, done) => (err ? reject(err) : resolve(done))
        )
      );
      if (!removed) {
        return interaction.editReply({
          content:
            `❌ **${target.username}** n'a que **${before}** ${item.emoji} ${item.label}, ` +
            `impossible d'en retirer **${-quantity}**.`,
        });
      }
    } else {
      await new Promise((resolve, reject) =>
        grantItem(
          target.id,
          key,
          quantity,
          { source: `admin:${interaction.user.id}` },
          (err) => (err ? reject(err) : resolve())
        )
      );
    }

    const after = before + quantity;
    log(
      `/admin item par ${interaction.user.username} : ${quantity > 0 ? "+" : ""}${quantity} ` +
        `${item.label} à ${target.username} (${before} → ${after})`
    );
    await interaction
      .editReply({
        content:
          `✅ **${quantity > 0 ? "+" : ""}${quantity}** ${item.emoji} **${item.label}** ` +
          `pour **${target.username}**.\nIl en a maintenant **${after}**.`,
      })
      .catch(() => {});
  },
};
