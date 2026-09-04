import { SlashCommandBuilder } from "discord.js";
import { handleException } from "../modules/utils.js";
import dotenv from "dotenv";
dotenv.config(); // process.env.CONSTANT
import db from '../modules/db.js';

export default {
  data: new SlashCommandBuilder()
    .setName("randomizabaise")
    .setDescription(`Depuis le temps que vous l'attendiez celle là`),

  async execute(interaction) {
    try {
      await interaction.deferReply();
      const guild = interaction.guild;
      if (!guild) {
        handleException("La commande doit être utilisée dans un serveur.");
        return;
      }

      // Récupère le rôle via l'ID depuis .env
      const defaultRole = guild.roles.cache.get(process.env.DEFAULT_ROLE_ID);
      if (!defaultRole) {
        handleException("Le rôle par défaut spécifié est introuvable.");
        return;
      }

      // Récupère les membres ayant le rôle par défaut
      await guild.members.fetch(); // Assure que tous les membres sont en cache
      const eligibleMembers = guild.members.cache
        .filter((member) => member.roles.cache.has(defaultRole.id))
        .map((member) => member);

      if (eligibleMembers.length < 2) {
        await interaction.editReply({
          content: "Pas assez de membres éligibles pour faire un ship !",
        });
        return;
      }

      // Choisit 2 ou 3 membres au hasard (1/1024 de chance shiny = 3 personnes).
      // Le tirage shiny n'est retenu que s'il y a assez de monde : avec
      // exactement deux membres éligibles, selectedMembers[2] était undefined et
      // la commande levait une TypeError en laissant la réponse en attente.
      const isShiny =
        Math.random() < 1 / 1024 && eligibleMembers.length >= 3;
      const memberCount = isShiny ? 3 : 2;

      // Mélange de Fisher-Yates : `sort(() => 0.5 - Math.random())` s'appuie sur
      // un comparateur incohérent, dont le résultat n'est ni uniforme ni
      // spécifié — certains membres sortaient bien plus souvent que d'autres.
      const shuffled = [...eligibleMembers];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const selectedMembers = shuffled.slice(0, memberCount);

      let content = isShiny
        ? `✨ **SHINY RANDOMIZABAISE!** ✨\n💞 Aujourd'hui, je ship <@${selectedMembers[0].id}>, <@${selectedMembers[1].id}> et <@${selectedMembers[2].id}> !`
        : `💞 Aujourd'hui, je ship <@${selectedMembers[0].id}> et <@${selectedMembers[1].id}> !`;

      await interaction.editReply({
        content: content,
      });
      // Enregistrer en base la stat randomizabaise
      try {
        // messageId non disponible avant l'envoi ; on récupère le message envoyé par editReply
        const sent = await interaction.fetchReply();
        // Use INSERT OR IGNORE to avoid overwriting an existing row (idempotence)
        db.run(
          `INSERT OR IGNORE INTO randomizabaise_stats (message_id, user_a, user_b, user_c, reaction_count, is_shiny) VALUES (?, ?, ?, ?, ?, ?)`,
          [sent.id, selectedMembers[0].id, selectedMembers[1].id, selectedMembers[2]?.id || null, 0, isShiny ? 1 : 0]
        );
      } catch (err) {
        handleException(err);
      }
    } catch (error) {
      handleException(error);
    }
  },
};
