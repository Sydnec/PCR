//! Les messages publics de la v1 (`channel_id`, `message_id`, `message_closed_at` répartis sur six
//! tables) rangés dans `public_messages`.
//!
//! Un message est à jour (`synced_version = version`) si sa fin a été écrite, ou si son entité est
//! encore ouverte (la v1 le réécrivait à chaque changement). Une entité terminée dont la fin n'a pas
//! été écrite reste en retard : le worker de la v2 la rattrapera, comme le faisait la réparation v1.
//! Sans salon ou sans message (touche de pêche, envoi jamais abouti), pas de ligne.

use sqlx::SqliteConnection;

use super::{MigrateError, Report, is_id};

/// Une source de messages publics dans le schéma v1.
struct Source {
    kind: &'static str,
    from: &'static str,
    /// La table v2 de l'entité : un message dont l'entité a été écartée n'a plus rien à montrer.
    entity: &'static str,
    channel: &'static str,
    message: &'static str,
    /// Condition SQL : le message montre déjà l'état courant.
    synced: &'static str,
    /// Le dernier changement d'état, d'où part la fenêtre de rattrapage.
    changed_at: &'static str,
}

const SOURCES: [Source; 6] = [
    Source {
        kind: "spawn",
        from: "v1.pokemon_spawns",
        entity: "pokemon_spawns",
        channel: "channel_id",
        message: "message_id",
        synced: "message_closed_at IS NOT NULL OR status = 'ACTIVE'",
        changed_at: "COALESCE(ended_at, spawned_at)",
    },
    Source {
        kind: "trade",
        from: "v1.pokemon_trades",
        entity: "pokemon_trades",
        channel: "channel_id",
        message: "message_id",
        synced: "message_closed_at IS NOT NULL OR status = 'PENDING'",
        changed_at: "COALESCE(resolved_at, created_at)",
    },
    Source {
        kind: "drop",
        from: "v1.pokemon_drops",
        entity: "pokemon_drops",
        channel: "channel_id",
        message: "message_id",
        synced: "message_closed_at IS NOT NULL OR status = 'OPEN'",
        changed_at: "COALESCE(claimed_at, dropped_at)",
    },
    Source {
        kind: "safari_park",
        from: "v1.pokemon_safari_parks",
        entity: "pokemon_safari_parks",
        channel: "channel_id",
        message: "message_id",
        synced: "message_closed_at IS NOT NULL OR status = 'OPEN'",
        changed_at: "COALESCE(closed_at, opened_at)",
    },
    Source {
        kind: "safari_live",
        from: "v1.pokemon_safari_sessions",
        entity: "pokemon_safari_sessions",
        channel: "live_channel_id",
        message: "live_message_id",
        synced: "live_closed_at IS NOT NULL OR status = 'ACTIVE'",
        changed_at: "COALESCE(ended_at, started_at)",
    },
    // Un bilan publié ne se réécrit pas : il est à jour dès qu'il existe.
    Source {
        kind: "season_recap",
        from: "v1.pokemon_season_recaps",
        entity: "pokemon_season_recaps",
        channel: "channel_id",
        message: "message_id",
        synced: "1",
        changed_at: "COALESCE(posted_at, ended_at)",
    },
];

pub(super) async fn convert(
    conn: &mut SqliteConnection,
    report: &mut Report,
) -> Result<(), MigrateError> {
    for s in &SOURCES {
        let key = if s.kind == "season_recap" {
            "season"
        } else {
            "id"
        };
        let sql = format!(
            "INSERT INTO public_messages
                    (kind, entity_id, channel_id, message_id, version, synced_version, changed_at)
             SELECT '{kind}', {key}, CAST({channel} AS INTEGER), CAST({message} AS INTEGER), 1,
                    CASE WHEN {synced} THEN 1 ELSE 0 END, {changed_at}
               FROM {from}
              WHERE {channel_ok} AND {message_ok} AND {key} IN (SELECT {key} FROM {entity})",
            kind = s.kind,
            channel = s.channel,
            message = s.message,
            synced = s.synced,
            changed_at = s.changed_at,
            from = s.from,
            entity = s.entity,
            channel_ok = is_id(s.channel),
            message_ok = is_id(s.message),
        );
        report
            .copy(
                conn,
                "public_messages",
                s.from,
                &sql,
                "sans message public (pêche, envoi jamais abouti) ou entité écartée",
            )
            .await?;
        report
            .fixed(
                conn,
                &format!(
                    "SELECT count(*) FROM public_messages WHERE kind = '{}' AND synced_version = 0",
                    s.kind
                ),
                "message(s) terminé(s) sans fin écrite, à réécrire par le worker",
            )
            .await?;
    }
    Ok(())
}
