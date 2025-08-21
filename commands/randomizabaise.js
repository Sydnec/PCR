import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleException } from '../modules/utils.js';
import dotenv from 'dotenv';
dotenv.config(); // process.env.CONSTANT

export default {
    data: new SlashCommandBuilder()
        .setName('randomizabaise')
        .setDescription(`Depuis le temps que vous l'attendiez celle là`),

    async execute(interaction) {
        try {
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
                .filter(member => member.roles.cache.has(defaultRole.id))
                .map(member => member);

            if (eligibleMembers.length < 2) {
                await interaction.reply({
                    content: "Pas assez de membres éligibles pour faire un ship !",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // Choisit 2 membres au hasard
            const shuffled = eligibleMembers.sort(() => 0.5 - Math.random());
            const [member1, member2] = shuffled;

            await interaction.reply({
                content: `💞 Aujourd'hui, je ship <@${member1.id}> et <@${member2.id}> !`,
                ephemeral: false,
            });
        } catch (error) {
            handleException(error);
        }
    },
};
