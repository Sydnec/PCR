//! Le port `MembersPort` de `pcr-app` : la liste complète des membres du serveur, lue par l'API
//! (une page de 1 000 à la fois), et le nom d'un rôle.
//!
//! L'API ne la donne qu'avec l'intention privilégiée « Server Members » cochée pour l'application
//! (la v1 l'avait aussi) ; la gateway, elle, n'en a pas besoin.

use std::sync::Arc;

use pcr_app::members::{Member, MembersPort, PortFuture, Roster};
use twilight_http::Client;
use twilight_model::id::{Id, marker::GuildMarker};

/// Taille de page maximale de l'API.
const PAGE: u16 = 1000;

#[derive(Debug, Clone)]
pub(crate) struct DiscordMembers {
    pub http: Arc<Client>,
    pub guild: Id<GuildMarker>,
}

fn id(id: u64) -> i64 {
    i64::try_from(id).unwrap_or(i64::MAX)
}

impl MembersPort for DiscordMembers {
    fn roster(&self, role: i64) -> PortFuture<'_, Roster> {
        Box::pin(async move {
            let roles = self
                .http
                .roles(self.guild)
                .await
                .map_err(|error| error.to_string())?
                .models()
                .await
                .map_err(|error| error.to_string())?;
            let role_name = roles
                .into_iter()
                .find(|found| id(found.id.get()) == role)
                .map(|found| found.name);

            let mut members = Vec::new();
            let mut after = None;
            loop {
                let mut request = self.http.guild_members(self.guild).limit(PAGE);
                if let Some(after) = after {
                    request = request.after(after);
                }
                let page = request
                    .await
                    .map_err(|error| error.to_string())?
                    .models()
                    .await
                    .map_err(|error| error.to_string())?;
                after = page.last().map(|member| member.user.id);
                let full = page.len() == usize::from(PAGE);
                members.extend(page.into_iter().map(|member| Member {
                    id: id(member.user.id.get()),
                    bot: member.user.bot,
                    roles: member.roles.iter().map(|role| id(role.get())).collect(),
                }));
                if !full {
                    break;
                }
            }
            Ok(Roster { role_name, members })
        })
    }
}
