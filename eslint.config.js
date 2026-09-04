// Configuration ESLint minimale, centrée sur les erreurs qui cassent le bot en
// production plutôt que sur le style.
//
// C'est `no-undef` qui aurait signalé l'appel à `handleException` dans
// commands/edit.js, où la fonction n'était pas importée : la branche de
// rattrapage d'erreur levait une ReferenceError et masquait l'erreur d'origine.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "backups/**", "**/*.db"],
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Une variable inutilisée est souvent le vestige d'un refactor incomplet,
      // mais ce n'est pas une erreur : avertissement seulement.
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Ces règles-là signalent du code qui ne peut pas fonctionner.
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-const-assign": "error",
      "no-self-assign": "error",
      "no-fallthrough": "error",
      "require-atomic-updates": "off",
    },
  },
];
