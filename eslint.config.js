// La vérification statique du code, lancée par la CI (npm run lint). Les règles
// recommandées d'ESLint, sans style : la mise en forme n'est pas son affaire.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "backups/"] },
  js.configs.recommended,
  // Le bot est en modules ES : ni `require` ni `__dirname`, qui passeraient le
  // lint et lèveraient à l'exécution.
  {
    files: ["**/*.js", "**/*.mjs"],
    ignores: ["web/**"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.nodeBuiltin,
    },
    rules: {
      // Une erreur attrapée qu'on ignore exprès garde souvent un nom qui dit ce
      // qu'on ignore : ce n'est pas du code mort.
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },
  // Le site tourne dans le navigateur, et seulement là.
  {
    files: ["web/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: globals.browser },
    rules: { "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
];
