//! `/admin potcommun [simulation]` : un pot commun hors calendrier, ou la simulation du prochain.
//! L'échéance hebdomadaire ne bouge pas : un pot forcé s'ajoute, il ne remplace pas.
//!
//! Le récapitulatif reste éphémère, comme tout `/admin` : le prélèvement est invisible pour les
//! joueurs, l'afficher publiquement le trahirait. Textes de la v1.

use std::fmt::Write as _;

use pcr_app::{
    App,
    redistribution::{self, Outcome, PotError},
};
use pcr_core::format::number;
use twilight_interactions::command::{CommandModel, CreateCommand};
use twilight_model::{channel::message::Component, id::Id};
use twilight_util::builder::message::{ContainerBuilder, TextDisplayBuilder};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    members::DiscordMembers,
};

const GOLD: u32 = 0xf1_c4_0f;
const FAILED: &str = "❌ Erreur pendant `/admin potcommun`, voir les logs.";
/// Les cotisations nommées dans le récapitulatif.
const TOP: usize = 3;

#[derive(Debug, CommandModel, CreateCommand)]
#[command(
    name = "potcommun",
    desc = "Déclenche un pot commun immédiatement, ou simule le prochain"
)]
pub struct PotcommunCommand {
    #[command(desc = "Calcule et affiche le résultat sans toucher aux soldes")]
    pub simulation: Option<bool>,
}

/// Différé : le pot se calcule sur la liste complète des membres.
pub fn run(ctx: &Ctx, command: &PotcommunCommand, admin: u64) -> Reply {
    let ctx = ctx.clone();
    let dry_run = command.simulation.unwrap_or(false);
    Reply::later(true, async move { Ok(pot(&ctx, dry_run, admin).await) })
}

async fn pot(ctx: &Ctx, dry_run: bool, admin: u64) -> Edit {
    let port = DiscordMembers {
        http: ctx.http.clone(),
        guild: Id::new(ctx.app.instance.discord.guild_id),
    };
    let members = match redistribution::default_members(&ctx.app, &port).await {
        Ok(Ok(members)) => members,
        Ok(Err(refusal)) => return Edit::Text(format!("❌ {refusal}")),
        Err(error) => {
            tracing::error!(%error, "listing members for /admin potcommun failed");
            return Edit::Text(FAILED.to_owned());
        }
    };
    let mut rng = App::rng();
    let admin_id = i64::try_from(admin).unwrap_or(i64::MAX);
    let result = if dry_run {
        redistribution::simulate(&ctx.app, &members, &mut rng).await
    } else {
        redistribution::force(&ctx.app, &members, admin_id, &mut rng).await
    };
    let outcome = match result {
        Ok(outcome) => outcome,
        Err(PotError::Refused(refusal)) => return Edit::Text(format!("❌ {refusal}")),
        Err(PotError::Db(error)) => {
            tracing::error!(?error, "/admin potcommun failed");
            return Edit::Text(FAILED.to_owned());
        }
    };
    // L'échéance illisible est tue, pas annoncée absente.
    let next = match redistribution::next_due(&ctx.app).await {
        Ok(0) => "\n⚠️ Aucune échéance automatique n'est encore posée.".to_owned(),
        Ok(at) => format!("\nProchain pot automatique : <t:{}:R>.", at / 1000),
        Err(_) => String::new(),
    };
    let head = if dry_run {
        format!("🔎 Simulation — **aucun solde n'a bougé**.{next}")
    } else {
        tracing::info!(admin, pot = outcome.plan.pot, "/admin potcommun");
        format!(
            "✅ Pot commun déclenché, sans un mot aux joueurs.\nL'échéance hebdomadaire n'a pas bougé.{next}"
        )
    };
    Edit::Panel(vec![
        TextDisplayBuilder::new(head).build().into(),
        summary(&outcome, dry_run),
    ])
}

/// Le récapitulatif du pot, réservé à l'administration.
fn summary(outcome: &Outcome, dry_run: bool) -> Component {
    let plan = &outcome.plan;
    let title = if dry_run {
        "🍯 Pot commun — simulation"
    } else {
        "🍯 Pot commun"
    };
    // Un taux fractionnaire s'écrit à la française : « 2,5 % ».
    let percent = outcome.percent.to_string().replace('.', ",");
    let mut text = format!(
        "### {title}\n**{percent} %** de la fortune de chacun sont partis au pot, \
         puis la cagnotte est revenue en parts égales.\n\n\
         Cagnotte : **{}** points\nPart de chacun : **{}** points\nBénéficiaires : **{}** ({})",
        number(plan.pot),
        number(plan.share),
        number(plan.participants),
        outcome.role_name
    );
    let top = plan.top_contributors(TOP);
    if !top.is_empty() {
        text.push_str("\n\n**Plus grosses cotisations**");
        for entry in top {
            let _ = write!(
                text,
                "\n• <@{}> — **{}** points",
                entry.user,
                number(entry.contribution)
            );
        }
    }
    let gainers = plan.gainers();
    let _ = write!(
        text,
        "\n-# {gainers} membre(s) y gagnent, {} y perdent ou font jeu égal",
        plan.participants - gainers
    );
    ContainerBuilder::new()
        .accent_color(Some(GOLD))
        .component(TextDisplayBuilder::new(text).build())
        .build()
        .into()
}
