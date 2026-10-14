import { EmbedBuilder, MessageFlags } from "discord.js";
import { handleException } from "../../modules/utils.js";
import { buyBalls, getShopView, openSpecialBalls } from "../../modules/pokemon/shop.js";
import { respondHint as hint } from "../../modules/pokemon/embeds.js";

const fr = (value) => value.toLocaleString("fr-FR");

// La boutique des balls spéciales. Sans option, le catalogue avec ton solde ; avec
// une ball, l'achat. Les emoji vont dans la description : Discord ne les rend pas
// dans un titre. Même fonction que sur le site (buyBalls) : mêmes règles, mêmes refus.
export default {
  describe: (sub) =>
    sub
      .setName("boutique")
      .setDescription("La boutique des balls spéciales : vois le catalogue, ou achète-les")
      .addStringOption((option) =>
        option
          .setName("ball")
          .setDescription("La ball à acheter")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addIntegerOption((option) =>
        option
          .setName("quantite")
          .setDescription("Combien (1 par défaut)")
          .setRequired(false)
          .setMinValue(1)
      ),

  async autocomplete(interaction) {
    const query = String(interaction.options.getFocused() ?? "").toLowerCase();
    const choices = openSpecialBalls()
      .map((ball) => ({ name: `${ball.label} — ${fr(ball.price)} points`, value: ball.key }))
      .filter((choice) => choice.name.toLowerCase().includes(query));
    if (!choices.length) return hint(interaction, "Aucune ball spéciale en vente");
    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const reply = (payload) =>
        interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
      const key = interaction.options.getString("ball");

      if (key) {
        // Une valeur tapée à la main ou périmée : buyBalls la revalide.
        const quantity = interaction.options.getInteger("quantite") ?? 1;
        return buyBalls(userId, key, quantity, (err, result) => {
          if (err) {
            handleException("Achat de balls spéciales :", err);
            return reply({ content: "❌ Erreur base de données : rien n'a été débité." });
          }
          if (!result.ok) return reply({ content: `❌ ${result.reason}` });
          const ball = openSpecialBalls().find((entry) => entry.key === key);
          reply({
            content:
              `✅ ${ball.emoji} **${fr(result.bought)}× ${ball.label}** pour **${fr(result.cost)}** points.` +
              (result.partial ? `\n⚠️ ${result.reason}` : "") +
              "\nElles servent aux Pokémon qui apparaîtront à partir de maintenant — pas à celui en cours.",
          });
        });
      }

      getShopView(userId, (err, view) => {
        if (err) {
          handleException("Lecture de la boutique :", err);
          return reply({ content: "❌ Impossible de lire la boutique." });
        }
        if (!view.balls.length) {
          return reply({ content: "La boutique n'a rien en vente pour l'instant." });
        }
        const lines = view.balls.map(
          (ball) =>
            `${ball.emoji} **${ball.label}** — **${fr(ball.price)}** points · tu en as ${fr(ball.held)}/${fr(view.limit)}\n` +
            `*${ball.effect}*`
        );
        reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("Boutique des balls spéciales")
              .setColor(0xf1c40f)
              .setDescription(
                `${lines.join("\n\n")}\n\nTon solde : **${fr(view.balance)}** points. ` +
                  "Une ball achetée ne sert qu'aux Pokémon qui apparaissent **après** son achat.\n" +
                  "`/pk boutique ball:<nom> quantite:<n>` pour acheter."
              ),
          ],
        });
      });
    } catch (error) {
      handleException(error);
    }
  },
};
