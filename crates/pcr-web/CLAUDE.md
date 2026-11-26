# pcr-web — site et API (axum)

- `router(app)` assemble les routes ; `serve` arrête proprement à l'arrêt du bot.
- `/healthz` : HTTP + base uniquement (Discord est signalé, jamais bloquant) ; c'est ce que vérifie le
  script de déploiement avant de garder une version.
- P6 : routes aux **formes JSON v1** (`docs/api.md`, `git show origin/main:modules/web/api.js`), OAuth2
  Discord, sessions en base, SSE `/api/events`, limitation de débit (écritures par utilisateur, connexion
  par IP ; `X-Forwarded-For` cru seulement depuis `instance.web.trusted_proxy`).
- Le front (`web/`, JS sans build repris de la v1) est embarqué dans le binaire ; types générés par `ts-rs`.
- Tests : autorisations par classe de route, sessions, contrôles Origin et Content-Type. Rien d'autre.
