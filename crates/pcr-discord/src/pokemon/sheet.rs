//! La fiche d'une espèce en panneau : type, rareté, difficulté, sexes, lignée avec ce que le dresseur
//! en possède, lettres de Zarbi. Textes de la v1, dont l'embed devient un conteneur. Une partie dont
//! la lecture a échoué est omise, jamais remplie de zéros.

use std::fmt::Write as _;

use pcr_app::pokemon::sheet::{Link, Sheet};
use pcr_core::{
    config::GameConfig,
    format,
    pokemon::{
        capture,
        display::{self, dex_number},
        species::Sex,
        weights::Obtention,
    },
};
use twilight_model::channel::message::{Component, component::UnfurledMediaItem};
use twilight_util::builder::message::{
    ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
};

/// Les stades tels que les données les numérotent : 1 est la forme de base.
const STAGE_LABELS: [&str; 3] = ["Forme de base", "Stade 1", "Stade 2"];

/// La fiche, prête à envoyer.
pub(crate) fn panel(config: &GameConfig, sheet: &Sheet) -> Component {
    let species = sheet.species;
    let title = format!(
        "### {}{} {}",
        if sheet.shiny { "✨ " } else { "" },
        dex_number(species),
        species.name
    );
    let mut lines = vec![
        title,
        format!("**Type** {}", species.types.join(" / ")),
        format!(
            "**Rareté** {} {}",
            sheet.rarity.icon(),
            sheet.rarity.label()
        ),
        format!("**Difficulté** {}", difficulty(config, sheet.catch_rate)),
        format!("**Sexe**\n{}", gender(sheet)),
    ];
    lines.extend(lineage(sheet));
    if let Some(forms) = forms(sheet) {
        lines.push(format!("**Formes**\n{forms}"));
    }
    let thumbnail = ThumbnailBuilder::new(UnfurledMediaItem {
        url: species.sprite_url(sheet.shiny, None),
        proxy_url: None,
        height: None,
        width: None,
        content_type: None,
    })
    .build();
    let mut container = ContainerBuilder::new()
        .accent_color(Some(display::color(species, sheet.shiny)))
        .component(
            SectionBuilder::new(thumbnail)
                .component(TextDisplayBuilder::new(lines.remove(0)).build())
                .build(),
        )
        .component(TextDisplayBuilder::new(lines.join("\n")).build());
    let legend = legend(&sheet.chain);
    if !legend.is_empty() {
        container = container
            .component(TextDisplayBuilder::new(format!("-# {}", legend.join("\n-# "))).build());
    }
    container.build().into()
}

/// Le libellé, puis la chance de la ball la moins puissante (la Poké Ball) : une seule probabilité
/// situe la difficulté, les autres s'en déduisent, et la fiche tient sur un écran de téléphone.
fn difficulty(config: &GameConfig, catch_rate: u32) -> String {
    let capture_config = &config.pokemon.capture;
    let label = capture::difficulty_of(capture_config, catch_rate).label;
    let reference = capture::probabilities_by_ball(capture_config, catch_rate)
        .into_iter()
        .filter(|chance| chance.ball.guaranteed != Some(true))
        .min_by(|a, b| a.ball.multiplier.total_cmp(&b.ball.multiplier));
    match reference {
        Some(chance) => format!(
            "{label}\n{} {}",
            chance.ball.emoji,
            display::chance(chance.probability)
        ),
        None => label.to_owned(),
    }
}

/// La répartition des sexes, celle que tire l'apparition (des huitièmes : 87,5 % au plus fin), puis
/// ceux que le dresseur en a, pour savoir lequel chercher encore.
fn gender(sheet: &Sheet) -> String {
    let species = sheet.species;
    let Some(share) = species.female_share() else {
        return "Asexué".to_owned();
    };
    let percent = |value: f64| format!("{} %", format::decimal(value * 100.0));
    let line = format!(
        "{} {} · {} {}",
        Sex::Male.symbol(),
        percent(1.0 - share),
        Sex::Female.symbol(),
        percent(share)
    );
    let Some(owned) = &sheet.sexes else {
        return line;
    };
    let mine: Vec<String> = species
        .possible_sexes()
        .into_iter()
        .map(|sex| {
            let mark = if owned.contains(&sex) { "✅" } else { "❔" };
            format!("{} {mark}", sex.symbol())
        })
        .collect();
    format!("{line}\nTu as : {}", mine.join(" · "))
}

/// Un bloc par stade, qui se lit comme la lignée : un embranchement (Évoli) empile ses cibles sous
/// son stade. Sans lignée, le bloc ne parle plus que de la collection.
fn lineage(sheet: &Sheet) -> Vec<String> {
    let mut stages: Vec<(u8, Vec<String>)> = Vec::new();
    for link in &sheet.chain {
        let line = chain_line(sheet, link);
        match stages
            .iter_mut()
            .find(|(stage, _)| *stage == link.species.stage)
        {
            Some((_, lines)) => lines.push(line),
            None => stages.push((link.species.stage, vec![line])),
        }
    }
    stages.sort_by_key(|(stage, _)| *stage);
    let solo = stages.len() <= 1;
    stages
        .into_iter()
        .map(|(stage, lines)| {
            let name = if solo {
                "Ton Pokédex".to_owned()
            } else {
                STAGE_LABELS
                    .get(usize::from(stage.saturating_sub(1)))
                    .map_or_else(
                        || format!("Stade {}", stage - 1),
                        |label| (*label).to_owned(),
                    )
            };
            format!("**{name}**\n{}", lines.join("\n"))
        })
        .collect()
}

/// Un maillon : possession, numéro, nom. Devant un shiny, « je l'ai » veut dire « je l'ai en
/// shiny », mais les deux compteurs restent : « pas en shiny, mais deux normaux » est ce qu'on
/// cherche à savoir avant de lancer. Le maillon consulté dépasse de sa colonne et se souligne.
fn chain_line(sheet: &Sheet, link: &Link) -> String {
    let species = link.species;
    let current = species.id == sheet.species.id;
    let mut text = String::new();
    if current {
        text.push_str("▸ ");
    }
    let owned = sheet
        .owned
        .as_ref()
        .map(|owned| owned.get(&species.id).copied().unwrap_or_default());
    if let Some(owned) = owned {
        let has = if sheet.shiny {
            owned.shiny > 0
        } else {
            owned.normal + owned.shiny > 0
        };
        text.push_str(if has { "✅ " } else { "❔ " });
    }
    let _ = write!(text, "`{}` ", dex_number(species));
    if current {
        let _ = write!(text, "__**{}**__", species.name);
    } else {
        text.push_str(species.name);
    }
    let mark = link.obtention.mark();
    if !mark.is_empty() {
        text.push(' ');
        text.push_str(mark);
    }
    if let Some(owned) = owned {
        if owned.normal > 0 {
            let _ = write!(text, " ×{}", format::number(owned.normal));
        }
        if owned.shiny > 0 {
            let _ = write!(text, " ✨×{}", format::number(owned.shiny));
        }
    }
    text
}

/// Les lettres de Zarbi : combien il en a sur celles que la génération connaît, lesquelles, et
/// d'abord si la lettre de l'individu d'où vient le clic est déjà dans sa boîte.
fn forms(sheet: &Sheet) -> Option<String> {
    let owned = sheet.forms.as_ref()?;
    let species = sheet.species;
    let known: Vec<_> = species.forms_in(sheet.generation).collect();
    if known.is_empty() {
        return None;
    }
    let mine: Vec<&str> = known
        .iter()
        .filter(|form| owned.iter().any(|key| key == form.key))
        .map(|form| form.name)
        .collect();
    let mut tally = format!("**{}**/{}", mine.len(), known.len());
    if !mine.is_empty() {
        let _ = write!(tally, " : {}", mine.join(" "));
    }
    let Some(focus) = known
        .iter()
        .find(|form| sheet.form.as_deref() == Some(form.key))
    else {
        return Some(tally);
    };
    let name = display::display_name(species, false, None, Some(focus.key));
    let status = if owned.iter().any(|key| key == focus.key) {
        format!("✅ Tu as déjà le {name}")
    } else {
        format!("🆕 Le {name} te manque !")
    };
    Some(format!("{status}\n{tally}"))
}

/// Ce que signifient 🔒 et 🥚 : sans légende, elles ne disent rien à qui les découvre.
fn legend(chain: &[Link]) -> Vec<&'static str> {
    let has = |obtention| chain.iter().any(|link| link.obtention == obtention);
    let mut legend = Vec::new();
    if has(Obtention::Evolution) {
        legend.push("🔒 Introuvable à l'état sauvage : par évolution, ou par échange.");
    }
    if has(Obtention::Egg) {
        legend.push("🥚 Ne sort que d'un œuf, pondu par un couple de parents.");
    }
    legend
}
