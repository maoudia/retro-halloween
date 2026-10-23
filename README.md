# Retro Halloween

Board de rétrospective en temps réel, thème Halloween. Pas de compte, pas de base de données à gérer: tu crées un board, tu partages le lien, chacun choisit son nom.

[![Check and deploy](https://github.com/maoudia/retro-halloween/actions/workflows/deploy.yml/badge.svg)](https://github.com/maoudia/retro-halloween/actions/workflows/deploy.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-orange)
![Cloudflare Workers](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020)

## Ce que ça fait

- Cinq colonnes: **Citrouilles** (ce qui a bien marché), **Fantômes** (ce qui nous hante), **Toiles d'araignée** (ce qui nous bloque), **Potions magiques** (idées à tester), **Bonbons ou sort** (remerciements).
- **Crypte privée**: chacun écrit ses post-its sans que personne les voie, puis clique sur *Tout publier*. Les brouillons restent dans le navigateur et ne passent jamais par le serveur.
- **3 votes par personne**, appliqués côté serveur, avec tri par votes.
- **Minuteur partagé** (3, 5, 10 ou 15 minutes) synchronisé pour toute l'équipe.
- **Grimoire des actions** avec responsable et case à cocher.
- **Export Markdown** du board et des actions.
- **Liste des connectés** avec les noms choisis.
- Post-its **anonymes par défaut**. Chacun peut choisir d'afficher son nom sur les siens.

## Comment c'est construit

Un seul projet, un seul déploiement (approche JAMstack: front statique + une petite API temps réel).

| Pièce | Rôle |
|---|---|
| `public/` | Front statique en HTML, CSS et JavaScript sans framework ni étape de build, polices auto-hébergées |
| `src/index.js` | Worker: sert les fichiers, ajoute les en-têtes de sécurité, ouvre les WebSockets |
| `Room` (Durable Object) | Une instance par board: état, votes, minuteur, actions, effacement automatique |

Le board vit à `https://<ton-site>/#<identifiant-aléatoire>`. L'identifiant fait 128 bits et se trouve après le `#`, donc le navigateur ne l'envoie pas dans les requêtes de page.

## Vie privée et sécurité

- Pas de compte, pas de cookie, pas de traceur, pas de police chargée depuis un tiers.
- Le code n'écrit aucun log, et l'observabilité Workers est désactivée dans `wrangler.jsonc`. Cloudflare conserve malgré tout ses propres métriques réseau côté plateforme, ce que ce dépôt ne contrôle pas.
- Un board est **effacé 24 h après la dernière activité** (alarme du Durable Object).
- Quiconque a le lien peut participer. Les noms ne sont pas vérifiés: n'importe qui peut en choisir un déjà pris.
- Le serveur valide tout: tailles de message, longueur des textes, colonnes connues, limite de 3 votes, suppression de ses seuls post-its, 40 messages par 10 secondes et 30 connexions par board.
- Les connexions WebSocket sont refusées si l'origine n'est pas le site lui-même.
- En-têtes envoyés sur chaque page: `Content-Security-Policy` stricte (aucun script ni style inline), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `noindex`.
- Le front construit tout le contenu avec `textContent`, jamais avec du HTML issu des participants.

À prévoir avant d'y mettre des retours d'équipe sensibles: vérifier la politique de ton client sur l'hébergement des données d'équipe.

## Déployer en une commande

Prérequis: un compte Cloudflare (le plan gratuit suffit, les Durable Objects SQLite y sont disponibles) et Node 20 ou plus.

```bash
git clone https://github.com/maoudia/retro-halloween.git
cd retro-halloween
npm install
npx wrangler login
npm run deploy
```

Wrangler affiche l'URL `https://retro-halloween.<ton-sous-domaine>.workers.dev`. Ouvre-la, clique sur *Créer un board*, partage le lien.

## Déploiement automatique avec GitHub Actions

Le workflow `.github/workflows/deploy.yml` fait deux choses:

1. **Check** sur chaque push et pull request: `npm ci`, vérification de syntaxe du front, build à blanc du Worker (`wrangler deploy --dry-run`).
2. **Deploy** sur chaque push vers `main`, une fois le check passé.

Pour activer le déploiement, ajoute deux secrets dans *Settings > Secrets and variables > Actions*:

| Secret | Où le trouver |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare > My Profile > API Tokens > Create Token, modèle **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare > Workers & Pages, colonne de droite |

Sans ces secrets, le job de déploiement s'arrête avec une note et ne casse pas le build. Le déploiement ne tourne jamais sur une pull request.

**Alternative sans GitHub Actions**: Cloudflare propose un déploiement Git natif, Workers Builds. Tu connectes le dépôt dans le tableau de bord Cloudflare et chaque push est déployé, sans secret à copier dans GitHub. Les [guide de migration Pages vers Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) le présentent comme le remplaçant du CI/CD intégré de Pages. Garde un seul des deux modes actif pour ne pas déployer deux fois.

## Pourquoi un Worker et pas Cloudflare Pages

Cloudflare Pages ne sait pas héberger un Durable Object. D'après la [documentation des bindings Pages](https://developers.cloudflare.com/pages/functions/bindings/), le Durable Object doit être déployé dans un Worker séparé, ce qui donne deux projets à gérer. Un Worker avec des [fichiers statiques](https://developers.cloudflare.com/workers/static-assets/) sert le front et la synchro depuis un seul projet. La documentation Cloudflare indique aussi que Workers est l'option recommandée pour les nouveaux projets, et sa [matrice de compatibilité Pages et Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) classe les Durable Objects comme pris en charge sur Workers et avec contournement seulement sur Pages.

Une limite à connaître: contrairement à Pages, un Worker ne gère pas de domaine personnalisé dont les serveurs de noms ne sont pas chez Cloudflare. L'URL `workers.dev` fonctionne dans tous les cas (`workers_dev` est activé dans `wrangler.jsonc`).

Ce projet n'a pas d'étape de build, donc aucun preset de framework n'est utilisé. Pour mémoire, [Pages propose des guides](https://developers.cloudflare.com/pages/framework-guides/) pour Astro, Next.js (export statique), Nuxt, SvelteKit, Remix, Angular, React (Vite), Vue, Qwik, Docusaurus, Eleventy, Hugo, Jekyll, MkDocs, VitePress, Zola, Hexo, Gatsby et plusieurs autres, ainsi que pour le HTML statique. Voir la [liste des presets](https://developers.cloudflare.com/pages/configuration/build-configuration/) pour les commandes de build et les dossiers de sortie.

## Développer en local

```bash
npm install
npm run dev          # http://127.0.0.1:8787
```

Dans un second terminal, le test de fumée simule deux participants (accès refusés, notes en direct, votes, minuteur, actions, reconnexion, en-têtes):

```bash
npm run smoke
```

## Structure

```text
.
├── public/              front statique (index.html, app.js, style.css, fonts/)
├── src/index.js         Worker et Durable Object Room
├── scripts/smoke-test.mjs
├── wrangler.jsonc
└── .github/workflows/deploy.yml
```

## Licence

MIT. Les polices Pirata One et Alegreya Sans sont sous licence SIL Open Font License 1.1.
