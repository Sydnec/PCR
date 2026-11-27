//! Les liens X et Instagram d'un message du serveur, republiés vers leurs miroirs sous la mention de
//! leur auteur (sans le notifier), puis l'original supprimé ; les tweets étrangers reçoivent ensuite
//! leur bouton « Traduire » (`tweet_translate|<id>`), qui répond en privé.

use pcr_app::links as cases;
use pcr_core::links::{
    self as rules,
    translation::{self, Reply as Translation},
};
use twilight_model::channel::{
    Message,
    message::{AllowedMentions, Component, component::ButtonStyle},
};
use twilight_util::builder::message::{
    ActionRowBuilder, ButtonBuilder, ContainerBuilder, TextDisplayBuilder,
};

use crate::{
    Ctx,
    interactions::{Edit, Reply},
    ui,
};

/// Place laissée à la traduction dans le panneau (Discord en accepte 4 000 caractères).
const TRANSLATION_MAX: usize = 3_500;

/// Un message du serveur : s'il porte des liens à réécrire, sa copie le remplace. L'original ne part
/// qu'une fois la copie publiée : rien ne se perd.
pub async fn rewrite(ctx: &Ctx, message: &Message) {
    if message.guild_id.is_none() {
        return;
    }
    let Some(rewritten) = rules::rewrite(&message.content) else {
        return;
    };
    let Some(text) = rules::repost(message.author.id.get(), &rewritten) else {
        return;
    };
    let silent = AllowedMentions::default();
    let copy = match ctx
        .http
        .create_message(message.channel_id)
        .content(&text)
        .allowed_mentions(Some(&silent))
        .await
    {
        Ok(response) => match response.model().await {
            Ok(copy) => copy,
            Err(error) => return tracing::warn!(?error, "could not read the link copy"),
        },
        Err(error) => return tracing::warn!(?error, "could not post the link copy"),
    };
    if let Err(error) = ctx
        .http
        .delete_message(message.channel_id, message.id)
        .await
    {
        tracing::warn!(?error, "could not delete the original of a link copy");
    }
    // Les boutons rejoignent la copie ensuite : elle n'attend jamais l'API.
    let buttons = cases::translate_buttons(&ctx.app, &*ctx.web, &rewritten.tweet_ids).await;
    if buttons.is_empty() {
        return;
    }
    let mut row = ActionRowBuilder::new();
    for (id, label) in buttons {
        row = row.component(
            ButtonBuilder::new(ButtonStyle::Secondary)
                .custom_id(translation::button_id(&id))
                .label(label)
                .build(),
        );
    }
    let components: [Component; 1] = [row.build().into()];
    if let Err(error) = ctx
        .http
        .update_message(copy.channel_id, copy.id)
        .components(Some(&components))
        .allowed_mentions(Some(&silent))
        .await
    {
        tracing::warn!(?error, "could not add the translate buttons");
    }
}

/// Le clic sur « Traduire » : la traduction, visible du seul membre qui clique.
pub fn translate(ctx: &Ctx, custom_id: &str) -> Reply {
    let Some(id) = translation::parse_button(custom_id).map(str::to_owned) else {
        return ui::ephemeral_text(translation::NO_LONGER_VALID).into();
    };
    let ctx = ctx.clone();
    // L'API peut dépasser les 3 s que Discord laisse pour répondre.
    Reply::later(true, async move {
        Ok(
            match cases::translation(&ctx.app, &*ctx.web, &id, TRANSLATION_MAX).await {
                Translation::Text(text) => Edit::Text(text.to_owned()),
                Translation::Translation {
                    body,
                    author,
                    footer,
                } => {
                    let mut container = ContainerBuilder::new();
                    if let Some((name, url)) = author {
                        container = container.component(
                            TextDisplayBuilder::new(format!("**[{name}]({url})**")).build(),
                        );
                    }
                    container = container
                        .component(TextDisplayBuilder::new(body).build())
                        .component(TextDisplayBuilder::new(format!("-# {footer}")).build());
                    Edit::Panel(vec![container.build().into()])
                }
            },
        )
    })
}
