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
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        APP_VERSION: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      solid: solidPlugin,
    },
    rules: {
      "solid/reactivity": "off",
      "solid/no-destructure": "warn",
      "solid/jsx-no-undef": "error",
      "solid/jsx-uses-vars": "error",
      "no-unused-vars": "off",
      // Allows TypeScript function overloads.
      "no-redeclare": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The app must build without the website: it reaches the site only through lib/site.ts.
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
    // It imports every page's data for the build: one page importing it ships all of them to every visitor.
    files: ["site/src/pages/**/*.tsx", "site/src/components/**/*.tsx", "site/src/index.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@site/lib/seo-pages", "**/lib/seo-pages"],
          message: "That's the build's list of pages; words pages draw go in lib/site-words.ts.",
        }],
      }],
    },
  },
  {
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
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-ssr/**",
      "*.config.js",
      "*.config.ts",
      "site/scripts/**",
    ],
  },
];
