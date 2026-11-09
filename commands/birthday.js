// /birthday : ajout, liste et suppression de sa propre date d'anniversaire.
// La date vit dans points.db (persistante) : elle doit survivre au changement
// d'année, contrairement aux tables de botdata-<ANNÉE>.db.
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { handleException } from "../modules/utils.js";
import { pseudo } from "../modules/pseudo.js";
import {
  parseBirthday,
  formatBirthday,
  daysUntil,
  nextOccurrence,
} from "../modules/birthdays.js";

// DB de points : ouverte par points-db.js. On l'importe et non db.js, dont la
// base repart de zéro chaque 1er janvier — un anniversaire déclaré en décembre
// ne doit pas disparaître en janvier. L'export default de points-db.js est la
// même instance sqlite3 que celle des tables Pokémon.
import pointsDb from "../modules/points-db.js";

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    pointsDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    pointsDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// points-db.js crée la table au démarrage du bot ; l'INSERT OR IGNORE fait de
// « /birthday add » une écriture idempotente : changer sa date ne duplique pas
// la ligne. last_wished_year est le garde anti-doublon du message de fête.
const SET_BIRTHDAY = `
  INSERT INTO birthdays (user_id, day, month, year, last_wished_year)
  VALUES (?, ?, ?, ?, NULL)
  ON CONFLICT(user_id) DO UPDATE SET
    day = excluded.day,
    month = excluded.month,
    year = excluded.year,
    last_wished_year = NULL`;

export default {
  data: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Gère ta date d'anniversaire")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Enregistre (ou modifie) ta date d'anniversaire")
        .addStringOption((option) =>
          option
            .setName("date")
            .setDescription("Ton anniversaire : JJ/MM ou JJ/MM/AAAA si tu donnes ton âge")
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Affiche les 10 prochains anniversaires du serveur")
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Supprime ta date d'anniversaire")
    ),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") return await handleAdd(interaction);
      if (sub === "list") return await handleList(interaction);
      if (sub === "remove") return await handleRemove(interaction);
    } catch (error) {
      handleException("Erreur /birthday :", error);
      await interaction
        .editReply({ content: "❌ Une erreur est survenue, réessaie plus tard." })
        .catch(() => {});
    }
  },
};

async function handleAdd(interaction) {
  const raw = interaction.options.getString("date");
  const parsed = parseBirthday(raw);
  // Refus éphémère et tutoyé, avec la raison exacte : la convention du projet
  // est de nommer le problème plutôt que de le généraliser.
  if (!parsed) {
    return interaction.reply({
      content:
        "❌ `" + raw + "` n'est pas une date valable. Utilise le format `JJ/MM` (ex : `24/07`)" +
        " ou `JJ/MM/AAAA` (ex : `24/07/1998`).",
      ephemeral: true,
    });
  }

  await run(SET_BIRTHDAY, [
    interaction.user.id,
    parsed.day,
    parsed.month,
    parsed.year,
  ]);

  await interaction
    .reply({
      content:
        "✅ Anniversaire enregistré : **" + formatBirthday(parsed) + "**." +
        (parsed.year === null ? " (sans ton âge)" : ""),
      ephemeral: true,
    })
    .catch(() => {});
}

async function handleList(interaction) {
  const rows = await all("SELECT * FROM birthdays");
  if (rows.length === 0) {
    return interaction.reply({
      content:
        "Aucun anniversaire enregistré pour l'instant. Ajoute le tien avec `/birthday add` !",
      ephemeral: true,
    });
  }

  const now = new Date();
  // Le tri complet se fait sur la distance au prochain anniversaire ; on
  // écrete à 10 après, pas avant, pour ne pas exclure un proche mal servi par
  // un tri partiel.
  const upcoming = rows
    .map((row) => ({ row, days: daysUntil(row, now), next: nextOccurrence(row, now) }))
    .sort((a, b) => a.days - b.days || a.next - b.next)
    .slice(0, 10);

  const lines = await Promise.all(
    upcoming.map(async ({ row, days }) => {
      const name = await pseudo(row.user_id).catch(() => "<@" + row.user_id + ">");
      // L'âge n'est calculé que si l'année existe : afficher 0 ou un calcul
      // faux mentrait — on omet, conformément à la convention du projet.
      const age =
        row.year === null ? "" : " (" + (nextOccurrence(row, now).getFullYear() - row.year) + " ans)";
      const when = "<t:" + Math.floor(nextOccurrence(row, now).getTime() / 1000) + ":d>";
      const label = days === 0 ? "🎉 **aujourd'hui**" : "dans " + days + " jour" + (days > 1 ? "s" : "");
      return "**" + formatBirthday(row) + "** — " + name + age + " — " + label + " (" + when + ")";
    })
  );

  const embed = new EmbedBuilder()
    .setColor("#FFD700")
    .setTitle("🎂 Prochains anniversaires")
    .setDescription(lines.join("\n"))
    .setTimestamp(now.getTime());

  await interaction.reply({ embeds: [embed] }).catch(() => {});
}

async function handleRemove(interaction) {
  // La clause WHERE sur user_id verrouille la suppression sur soi : personne
  // ne peut effacer la date d'un autre, la commande ne le permet pas.
  const result = await run("DELETE FROM birthdays WHERE user_id = ?", [interaction.user.id]);
  if (result.changes === 0) {
    return interaction.reply({
      content: "Tu n'as pas d'anniversaire enregistré. Ajoute-le avec `/birthday add` !",
      ephemeral: true,
    });
  }
  await interaction
    .reply({ content: "✅ Ton anniversaire a bien été supprimé.", ephemeral: true })
    .catch(() => {});
}
