# Cadrage — Back-office SUPERADMIN (console d'ops STARFIRE)

> Issu du brainstorm 4-angles (backend / UX / sécurité / ops), 05/07/2026.
> **Décisions actées (titulaire) :** (1) **read-first** — Lot 1 = console de lecture +
> onboarding, mutations money en Lot 2 ; (2) suspension d'org = **approche propre RLS**
> (auth_user_has_membership joint `organizations.status`) ; (3) renouvellement =
> **reset consommation + nouvelle fenêtre**.

## Principe directeur (consensus des 4 angles)
On **n'invente aucune architecture** : on étend l'invariant du code.
- **Identité** (users / orgs / memberships) → fonctions **SECURITY DEFINER** appelées via
  `asAppRole` (lecture/écriture cross-tenant, HORS `withTenant`), patron **exact** de 0011.
- **Données tenant** (subscriptions / usage) → `withTenant(orgId)` (`roadsen_app` a déjà les GRANT).
- **Le serveur est la SEULE frontière** : `@Roles(SUPERADMIN)` backend + garde Server
  Component front. Le front ne décide jamais l'autorisation.

---

# LOT 1 — Console read-first (valeur immédiate : STARFIRE lâche le curl)

## 1.1 Migration `0012_backoffice_read`
Fonctions DEFINER de **lecture cross-tenant** (clonage de `list_org_members` 0011 : owner
`roadsen_auth`, drapeau `app.auth_bootstrap` posé/fermé sur tous les chemins, `search_path`
figé, `REVOKE PUBLIC` + `GRANT EXECUTE roadsen_app`, colonnes minimales, **paginées/bornées**
= minimisation CDP) :
- `admin_list_orgs(limit, offset, q)` → orgs + résumé abonnement (pack, quota, consommation,
  date_fin, status) — jointure `organizations` + `subscriptions` en une passe.
- `admin_get_org(org_id)` → identité de l'org (le détail COMPOSE : cette fonction + le
  `list_org_members` existant + abonnement/usage via `withTenant`).
- `admin_search_users(q, limit)` → users (email/nom, id, platform_role, is_active, nb_orgs) —
  **SUPERADMIN only, journalisé** (oracle d'énumération sinon).
> ⚠️ Sans ces DEFINER, `GET /admin/orgs` renvoie **0 ligne silencieusement** (RLS FORCE +
> `roadsen_app` NOBYPASSRLS). Test direct `SET ROLE roadsen_app; SELECT admin_list_orgs()`
> AVANT d'exposer les routes.

## 1.2 Backend — endpoints lecture (`AdminOrgsService` / `AdminUsersService`)
- `GET /admin/me` → `{ platformRole }` (garde front).
- `GET /admin/orgs?q=&limit=&offset=` → liste (via `admin_list_orgs`).
- `GET /admin/orgs/:orgId` → détail composite (identité DEFINER + membres via `listMembers`
  existant + abonnement + usage agrégé via `withTenant`).
- `GET /admin/orgs/:orgId/usage` → agrégat `withTenant` (consommation/quota, ventilation
  CALC/PV, par membre, mois courant).
- `GET /admin/users?q=` → recherche (via `admin_search_users`).
> `@NoTenant` + `@Roles(SUPERADMIN)` (chaîne existante). Lecture cross-tenant TOUJOURS via
> `asAppRole` (jamais `withTenant` → sinon 0 ligne). Documenter ce choix dans le service.

## 1.3 Front — shell `/admin` **séparé** du shell `[orgSlug]`
- `apps/web/src/app/admin/layout.tsx` : layout dédié (topbar `--struct-petrole`, libellé
  BACK-OFFICE, sidebar 2 entrées Organisations / Utilisateurs). **Garde Server Component**
  (appel `GET /admin/me` serveur ; `platformRole !== SUPERADMIN` → redirect/404 anti-énum).
  **Code-split** (aucun import moteur — DoD §8). Étendre le middleware pour couvrir `/admin`.
- `/admin/orgs` : tableau dense (Nom/Slug · Statut · Pack · QuotaBar · Expiration · Membres),
  recherche + filtre statut.
- `/admin/orgs/[orgId]` : onglets **Membres | Abonnement | Usage** (LECTURE seule en Lot 1 ;
  les actions arrivent en Lot 2).
- `/admin/orgs/new` : **wizard onboarding 3 étapes** (Compte OWNER → Org → Abonnement) →
  **un seul POST /admin/orgs** au submit (déjà atomique : `provision_org` + subscription).
  Étape 1 = recherche user existant (`GET /admin/users?q=`) OU création inline.
- `/admin/users` : liste + recherche par email (clôt le workflow « ajouter un membre à une
  org existante »).
- Composants : `QuotaBar`, `OrgStatusBadge`, `AdminSidebar`, `AdminTopbar` (tokens CSS existants).

## 1.4 Tests Lot 1 (Postgres réel + Playwright)
- **T-ISO** : `admin_list_orgs`/`admin_search_users` renvoient bien TOUTES les orgs/users
  (pas filtré à 0 par RLS), et **aucun chemin ne fuit au runtime tenant**.
- **Garde front** : un token OWNER (non-SUPERADMIN) sur `/admin/**` → 403 backend + redirect front.
- Wizard : onboarding bout-en-bout (org + OWNER + abo créés en un POST).

**Effort Lot 1 ≈ migration 1 j · backend 1,5-2 j · front 4-5 j (gros amorçage du shell) · tests 1 j.**

---

# LOT 2 — Mutations & money-adjacent (le point sensible)

> **Prérequis NON négociable (les 4 angles) : le quota est *money-adjacent*.**
> `roadsen_app` a déjà `GRANT UPDATE ON subscriptions` → un top-up direct passerait **sans
> trace**. À fermer AVANT toute mutation d'abonnement.

## 2.1 Migration `0013_backoffice_admin_mutations`
- **`admin_audit_log`** (append-only, HORS-tenant, triggers d'immuabilité = patron ledger
  0008) : `{actor_user_id, action, target_org_id, target_user_id, payload, idempotency_key,
  created_at}`. Lecture par DEFINER SUPERADMIN. **Backport** : tracer aussi les actions admin
  déjà livrées (createUser/createOrg/addMember/setMemberActive — aujourd'hui sans trace).
- **`adjust_quota(org, delta, motif, actor, idempotency_key)`** DEFINER : `UPDATE quota` +
  `INSERT admin_audit_log` **ATOMIQUES** + **idempotency_key** (anti double-crédit).
  **Ne JAMAIS toucher `consommation`** (réconcilie le COUNT du ledger).
- **Re-scoper le `GRANT UPDATE ON subscriptions`** de `roadsen_app` (fermer le chemin non
  tracé) — **revue de migration EN BINÔME dev-backend** (scénario le + dangereux : préserver
  le décompte de `reserveUnit` sans rouvrir la mutation quota directe).
- **`set_member_role`** + **`remove_member`** DEFINER : anti-escalade OWNER (OWNER traité à
  part, chemin explicite tracé) + anti-lockout dernier OWNER (réutilise 0011) + `GRANT DELETE
  ON memberships TO roadsen_auth` (absent).
- **Redéfinir `auth_user_has_membership`** pour joindre `organizations WHERE status='ACTIVE'`
  (décision « suspension org propre ») — **revue ingenieur-securite** (cœur de l'isolation).
- **Renouvellement** = reset `consommation` à 0 + nouvelle fenêtre `date_debut/date_fin`
  (décision actée), consigné dans `admin_audit_log` (état avant/après).

## 2.2 Backend — mutations (chacune trace un audit)
`POST /admin/orgs/:id/subscription/topup` · `.../renew` · `PATCH .../entitlements` ·
`PATCH /admin/orgs/:id/members/:userId/role` · `DELETE .../members/:userId` (soft par défaut) ·
`PATCH /admin/orgs/:id/status` (suspension org, effet réel via l'auth function redéfinie).
Garde : `quota_nouveau < consommation` → 400 explicite.

## 2.3 Front — pages de mutation
`SubscriptionEditor` (modal top-up **+ motif obligatoire** + confirmation) · gestion rôle
(garde-fous OWNER visibles) · retrait membre · suspension org (**modal forte, recopie du
slug**, mention « effet au prochain appel »).

## 2.4 Décisions/hardening à acter en Lot 2
- **SUPPORT en moindre privilège** : matrice `@Roles` par handler (SUPPORT lecture, SUPERADMIN
  écriture) — l'enum existe, à exploiter.
- **Cookie httpOnly** sur `/admin` (dette middleware) : un XSS volant une session SUPERADMIN =
  compromission cross-tenant totale ; ré-auth possible sur les actions money.
- **Trace facturation P1** : champ `notes` sur Subscription (ex. « TOP-UP 50 — virement 05/07 »)
  suffit ; table `billing_events` structurée = à planifier avant PayDunya (P2, avec `payment-integration`).

## 2.5 Tests + revue Lot 2
Escalade (OWNER, non-SUPERADMIN → 403) · anti-lockout `set_member_role`/`remove_member` ·
**idempotence top-up** (double-appel = 1 crédit) · **suspension org effective** (membre d'une
org suspendue → 403) · RBAC SUPPORT. → **revue adverse `qa-challenger` OBLIGATOIRE** (zone
paiement/devis).

**Effort Lot 2 ≈ migration 2-3 j · backend 2 j · front 2-3 j · tests+challenge 1 j.**

---

## Chaîne d'agents (build, comme le module membres)
`dev-backend` (migration + services + endpoints) ↔ `ingenieur-securite` (revue DEFINER +
la redéfinition de `auth_user_has_membership` + le re-scoping du GRANT) → `dev-frontend`
(shell /admin + pages) → `qa-test` (T-ISO + Playwright) → `qa-challenger` (revue adverse,
**incontournable en Lot 2 = money**). Merge/déploiement préprod = **décision humaine** (zone
critique isolation + money).
