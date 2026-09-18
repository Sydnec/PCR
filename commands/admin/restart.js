export default {
  describe: (sub) => sub.setName("restart").setDescription("Redémarre le bot"),

  async execute(interaction, bot) {
    await interaction.editReply({ content: "Redémarrage en cours..." });
    await bot.destroy();
    process.exit(0);
  },
};
