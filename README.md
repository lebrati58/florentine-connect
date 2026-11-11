# 4FLORENTINE — plateforme résidentielle

Deux applications connectées à la même base Supabase (`zcodeswjwtxilzpxtbdd`) :

| Application | URL | Public |
|---|---|---|
| **Application résidents** (FR / עברית / EN, PWA) | `/app/` | Habitants des 4 tours, 1 compte par appartement |
| **CRM de gestion** (100 % hébreu, RTL) | `/admin/` | Équipe (comptes nominatifs + rôles) |

Les anciennes pages `index.html` et `admin.html` restent en place tant que la v2 n’est pas validée
(voir « Bascule » ci-dessous).

## Architecture

```
assets/
  ds/            design system partagé (tokens.css, components.css, icons.js)
  js/core.js     client Supabase + couche d’accès aux données + référentiels
  js/config.js   URL et clé *publishable* (aucune clé secrète côté navigateur)
  fonts/         Frank Ruhl Libre + IBM Plex Sans / Sans Hebrew, auto-hébergées (OFL)
  brand/         logo d’origine décliné (icônes PWA, emblème) — l’original est conservé à la racine
  vendor/        supabase-js 2.119.0 (copie locale, aucune dépendance CDN)
app/             application résidents (index.html, app.js, i18n.js, sw.js, manifest)
admin/           CRM (index.html, crm.js, crm.css)
supabase/
  migrations/    schéma v2 + RLS (additif, idempotent)
  rollback/      script de retour arrière de la migration
  functions/admin-api/   fonction serveur (création des comptes appartement, PIN, comptes équipe)
tests/
  rls-test.mjs   61 vérifications des règles d’accès sur un vrai PostgreSQL (PGlite)
  e2e.py         parcours complets dans Chrome (Playwright)
  fake-api.js    backend simulé utilisé UNIQUEMENT par les tests (jamais chargé en production)
```

Choix technique : JavaScript natif en modules ES, sans étape de build. Une migration React/TS/Vite
n’apportait pas de bénéfice suffisant pour deux applications de cette taille et aurait imposé un
pipeline de build pour GitHub Pages. Zéro dépendance à l’exécution hormis supabase-js (copie locale).

## Sécurité

- **Résidents** : un compte Supabase Auth par appartement (`apt-<tour>-<numéro>@apartments.4florentine.example.com`,
  domaine non routable, aucun e-mail n’est envoyé). Le PIN (6 chiffres) est le mot de passe : haché par
  Supabase (bcrypt), jamais stocké en clair, généré côté serveur et affiché une seule fois au gestionnaire.
  Un nouveau PIN révoque toutes les sessions de l’appartement.
- **Équipe** : comptes nominatifs, rôles `owner` / `manager` / `technician` / `viewer`.
- **RLS** sur toutes les tables. Un compte authentifié qui n’est ni un appartement actif ni un membre
  de l’équipe n’a accès à rien. Les champs sensibles (statut, responsable, compte lié…) sont imposés
  par des triggers côté serveur, pas par le navigateur.
- **Photos** : bucket privé `ticket-photos`, URL signées d’une heure, accès limité au ticket.
- **Annuaire** : aucun numéro publié sans case d’accord explicite (contrainte en base), versions
  historisées et restaurables, 1 recommandation par compte, signalements (3 voisins → « obsolète »),
  plafond de 30 modifications / 24 h par compte, masquage par l’équipe.
- La clé `service_role` n’existe que dans la fonction serveur `admin-api`.

## Votes de copropriété et procurations (v2.2)

- **Une voix par appartement**, ou pondérée par la quote-part (`vote_weight`, réglable par appartement dans le CRM).
  Un appartement peut être exclu des votes (`can_vote`), par exemple si le compte est utilisé par des locataires.
- **Règles** : majorité des voix exprimées, majorité de tous les appartements, 2/3 ou 3/4 de tous les appartements.
  Périmètre : tout le complexe, une tour ou une entrée. Règles et options **verrouillées dès l'ouverture**.
- **Procuration (ייפוי כוח)** : le résident désigne un autre appartement (un vote précis, ou tous les votes jusqu'à une date)
  → le mandataire accepte → **l'administrateur valide**. Révocable à tout moment ; le vote direct du mandant l'emporte
  toujours. Plafond optionnel de procurations par mandataire. Les procurations papier saisies par l'admin sont actives
  immédiatement (mandataire résident ou personne extérieure).
- **Assemblée physique** : l'admin saisit les voix exprimées sur place ou par bulletin papier.
- **Vote secret** : personne, équipe comprise, ne voit le choix d'un appartement — uniquement les totaux et la participation.
- **Traçabilité** : journal de toutes les voix (`ballot_log`, y compris les changements), hors votes secrets.
- **Langues** : un vote ne peut être ouvert (et une annonce publiée) que si son texte existe en hébreu, français et anglais.

Limite à connaître : le compte d'un appartement est partagé par ses occupants ; l'application enregistre la voix de
l'appartement, pas l'identité de la personne qui a cliqué. Pour les décisions qui l'exigent légalement (signature,
majorités spéciales de la loi sur les biens immobiliers), garder le procès-verbal et les procurations signées.

## Mise en service (une fois)

1. Appliquer dans l'ordre les fichiers de `supabase/migrations/` (SQL editor ou `supabase db push`).
2. Déployer la fonction : `supabase functions deploy admin-api`
   (secrets optionnels : `ALLOWED_ORIGINS`, `APARTMENT_EMAIL_DOMAIN`).
3. Ouvrir `/admin/`, « הגדרה ראשונית » : le premier compte créé devient propriétaire.
4. Désactiver ensuite les inscriptions publiques (Authentication → Providers → Email → *Allow new users to sign up* : off).
   Les comptes équipe sont créés depuis le CRM.
5. CRM → בניינים ודירות → ajouter les 260 appartements, puis « הנפקת קוד » pour chacun.

## Tests

```bash
cd tests && npm install && node rls-test.mjs <migrations séparées par des virgules>   # 119 tests d’accès
python3 -m http.server 8811 &                    # depuis la racine du dépôt
python3 tests/e2e.py http://localhost:8811/ tests/shots
```

## Bascule et retour arrière

**Bascule** (quand la v2 est validée) : `index.html` et `admin.html` redirigent vers `app/` et `admin/` ;
les anciennes pages sont conservées dans `legacy/`.

**Retour arrière du site** : `git revert <commit de bascule>` (ou du commit v2) puis push sur `main` —
GitHub Pages republie en ~1 minute. Le service worker est en « réseau d’abord » : aucune ancienne
version ne reste bloquée en cache.

**Retour arrière de la base** : `supabase/rollback/20261110120000_platform_v2_down.sql`
(⚠️ supprime les données créées par la v2 — faire une sauvegarde avant). La table historique
`directory_suggestions` n’est jamais modifiée.
