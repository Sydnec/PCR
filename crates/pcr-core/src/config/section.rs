//! `section!` : déclare une branche de la configuration en un seul endroit — chaque réglage avec sa
//! clé v1 (celle que tapent `/admin config` et le site), son type et sa valeur par défaut.
//!
//! La structure produite se (dé)sérialise sous ces clés, refuse une clé inconnue, et son `Default`
//! porte les valeurs v1 : l'arbre JSON des défauts, dont se servent l'administration et les
//! surcharges, se déduit d'elle sans rien recopier ailleurs.

macro_rules! section {
    (
        $(#[$meta:meta])*
        pub struct $name:ident {
            $(
                $(#[$field_meta:meta])*
                $field:ident $key:literal : $ty:ty = $default:expr
            ),* $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
        #[serde(default, deny_unknown_fields)]
        pub struct $name {
            $(
                $(#[$field_meta])*
                #[serde(rename = $key)]
                pub $field: $ty,
            )*
        }

        impl Default for $name {
            fn default() -> Self {
                Self { $( $field: $default, )* }
            }
        }
    };
}

pub(super) use section;
