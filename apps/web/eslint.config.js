/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import solidPlugin from "eslint-plugin-solid";
import typegpuPlugin from "eslint-plugin-typegpu";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    ...typegpuPlugin.configs.recommended,
    files: ["**/*.{js,jsx,ts,tsx}"],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
        project: ["./tsconfig.app.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname, // ESM way to get __dirname
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        // Vite `define` (see vite.config.ts); declared in src/vite-env.d.ts
        APP_VERSION: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      solid: solidPlugin,
    },
    rules: {
      "solid/reactivity": "off",
      // Additional helpful SolidJS rules
      "solid/no-destructure": "warn",
      "solid/jsx-no-undef": "error",
      "solid/jsx-uses-vars": "error",
      // Disable base no-unused-vars in favor of TypeScript version
      "no-unused-vars": "off",
      // Disable no-redeclare to allow TypeScript function overloads
      "no-redeclare": "off",
      // TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // plan.video's website (site/, lib/site.ts) stays apart from the app, so
    // the app builds and runs without it: the app reaches the site through
    // lib/site.ts alone, never by importing its files.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@site", "@site/*", "**/site/src", "**/site/src/*"],
          message: "That's the website's (lib/site.ts); the app reaches it through `site` from @/lib/site.",
        }],
      }],
    },
  },
  {
    // The end-to-end checks: Node scripts that also run code in the browser page.
    files: ["e2e/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Ignore patterns
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-ssr/**",
      "*.config.js",
      "*.config.ts",
      // The site's Node scripts (films, link pictures), as the repository's own scripts/ go unlinted.
      "site/scripts/**",
    ],
  },
];
