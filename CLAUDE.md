# CLAUDE.md — 4FLORENTINE (florentine-connect)

Plateforme pour les résidents de **quatre tours à Florentin, Tel Aviv**. Le complexe a 6 entrées regroupées en 4 tours : 1+2, 3, 4+5, 6. Il y a deux applications, branchées sur la même base :

| App | Dossier | Langue | Public |
|---|---|---|---|
| Application résidents (PWA, mobile d'abord) | `app/` | FR / עברית / EN | 1 compte par appartement |
| CRM de gestion | `admin/` | **100 % hébreu, RTL** | équipe (comptes nominatifs + rôles) |

`index.html` et `admin.html` à la racine redirigent vers la v2. Les anciennes pages sont gardées dans `legacy/`. Architecture, sécurité et mise en service : `README.md`.

## Stack
- JavaScript natif en modules ES, **sans build**. Hébergement GitHub Pages (`.nojekyll`). supabase-js est copié localement dans `assets/vendor/`.
- **Supabase** : projet « Florentine Connect », `zcodeswjwtxilzpxtbdd`. Migrations dans `supabase/migrations/` (additives et idempotentes), retour arrière dans `supabase/rollback/`, fonction serveur dans `supabase/functions/admin-api` (la seule à détenir la clé `service_role`).
- `assets/ds/` contient le design system partagé (tokens, composants, icônes). `assets/js/core.js` contient le client et l'accès aux données. `assets/js/config.js` ne contient que l'URL et la clé publique.

## Commandes
```bash
cd tests && npm install && npm run rls     # vérifications RLS sur un vrai PostgreSQL (PGlite)
python3 -m http.server 8811                # depuis la racine, puis /app/ et /admin/
python3 tests/e2e.py http://localhost:8811/ tests/shots   # parcours complets dans Chrome
```
`tests/fake-api.js` sert **uniquement aux tests** et ne doit jamais être chargé en production. Pour les vérifications visuelles, utilise le skill **playwright** du dépôt.

## Déploiement
Un push sur `main` republie GitHub Pages en environ une minute. Le service worker est en « réseau d'abord ». Pour revenir en arrière : `git revert` puis push. Les migrations de base ne sont **pas** appliquées automatiquement.

## Règles de travail
- **Chaque écran est entièrement dans une seule langue.** Jamais de français mélangé à un écran en hébreu ou en anglais. Le CRM reste 100 % hébreu.
- On garde le **logo doré d'origine** (`logo.svg`, déclinaisons dans `assets/brand/`).
- La sécurité est assurée par la **RLS et des triggers côté serveur**, jamais par la seule interface. Toute nouvelle table a sa RLS et ses tests dans `tests/rls-test.mjs`.
- Les PIN des appartements sont hachés par Supabase Auth et jamais stockés en clair. Aucun numéro de téléphone n'est publié dans l'annuaire sans l'accord explicite de la personne.
- Votes de copropriété et procurations (ייפוי כוח) : une procuration doit toujours être autorisée par un admin.
- **Aucune migration, suppression ou modification de données sans la confirmation explicite de Lionel.** Une migration est toujours livrée avec son script de rollback.
- Travaille sur une branche avec une PR. « **yallah** » veut dire : fusionne dans `main`, puis vérifie la publication.
- Ne dis jamais qu'une chose est testée si elle ne l'a pas été.

## Contexte métier (pour les tickets et les textes)
Problèmes fréquents : fuites aux parkings -1 et -2 (parfois dans le hall), odeurs, travaux de voisins à des heures interdites, pannes du parking robotisé (-1) et de la barrière (-2), ascenseurs, alarme ou bruit du hall, mendiants (à signaler au 106+ de Tel Aviv).
