// Connexion par Discord (OAuth2, flux « authorization code »).
//
// Le compte web EST le compte Discord : on ne demande que la portée
// `identify`, qui donne l'identifiant, le pseudo et l'avatar — rien de plus,
// ni serveurs ni e-mail. L'appartenance au serveur se vérifie ensuite par le
// bot, qui la connaît déjà.
const apiBase = () => process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
const authorizeBase = () =>
  process.env.DISCORD_AUTHORIZE_URL || "https://discord.com/oauth2/authorize";

export const redirectUri = () => `${process.env.WEB_BASE_URL}/api/auth/callback`;

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: "identify",
    state,
    prompt: "none",
  });
  return `${authorizeBase()}?${params}`;
}

// Échange le code contre un jeton d'accès, puis lit l'utilisateur. Le jeton
// d'accès n'est ni stocké ni renvoyé : il ne sert qu'à cette lecture.
export async function fetchDiscordUser(code) {
  const tokenResponse = await fetch(`${apiBase()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Échange du code refusé (${tokenResponse.status})`);
  const { access_token: accessToken } = await tokenResponse.json();

  const userResponse = await fetch(`${apiBase()}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) throw new Error(`Lecture du compte refusée (${userResponse.status})`);
  const user = await userResponse.json();
  return { id: user.id, username: user.global_name ?? user.username, avatar: user.avatar };
}
