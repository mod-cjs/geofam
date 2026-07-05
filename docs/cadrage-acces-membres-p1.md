# Cadrage — Accès contrôlés multi-membres (Phase 1, admin-géré)

> Issu du brainstorm 4-angles (archi / sécurité / UX / commercial), 05/07/2026.
> **Décisions actées (titulaire) :** (1) `Membership.isActive` ajouté ; (2) le **SUPERADMIN**
> (back-office STARFIRE) provisionne les comptes membres pour l'instant — **pas de
> self-service OWNER** ; (3) **rôle = scope** (pas de scope fin par module en P1).

## 1. Objectif & périmètre

**Objectif P1.** Le back-office SUPERADMIN peut, pour une **organisation existante** d'un
client, **ajouter des membres** (un ingénieur, un technicien de labo…), **suspendre/réactiver**
leur accès, et **lister** les membres. Ces membres **consomment le quota de l'org** (déjà le
cas) et leurs droits sont portés par leur **rôle** (déjà enforced).

**Hors périmètre P1 (→ Phase 2, à financer sur décision) :** self-service OWNER (écran
`/settings/members`), **invitation par lien** (non-répudiation des PV : le membre pose son
propre mot de passe), délégation OWNER+ADMIN, scope fin par module, top-up quota PayDunya.

## 2. Ce qui existe déjà (réutilisé tel quel — aucun code)
- **Quota partagé par org** : `Subscription.quota/consommation` + `reserveUnit` atomique +
  `UsageLedger.userId` (audit « qui a consommé » non-répudiable). Ajouter des membres = **0**
  changement d'abonnement.
- **Rôles porteurs de droits** : `ENGINEER` / `TECHNICIAN` / `VIEWER` avec `@Roles` posés
  (VIEWER 403 calcul ; TECHNICIAN calcule mais **403 émission PV**).
- **Révocation temps-réel** : `TenantGuard` relit le membership en base **à chaque requête**
  (`auth_user_has_membership`), le JWT n'est jamais une frontière de droits (ADR 0010) →
  suspendre prend effet **au prochain appel**, sans rotation de token.
- **Patron DEFINER** : `provision_org` (migration 0007) = modèle exact à copier.

## 3. Le seul vrai manque
Aujourd'hui on ne crée un membership qu'**à la création de l'org** (l'OWNER, via
`provision_org`). **Il n'existe aucune route pour attacher un membre à une org existante.**
C'est ce que P1 ajoute, plus le champ `is_active` pour suspendre proprement.

---

## 4. LOT 1 — Schéma & migration `0011_membership_status_and_provision_member`
> (renumérotée 0010 → 0011 au build : recette porte déjà `0010_project_domain_description`.)

**(a) Colonne `is_active`** (migration légère, sans downtime) :
```sql
ALTER TABLE "memberships" ADD COLUMN "is_active" boolean NOT NULL DEFAULT true;
```
+ champ Prisma `isActive Boolean @default(true) @map("is_active")` sur `Membership`.

**(b) ⚠️ PIÈGE HAUTE (les 4 agents) — patcher `auth_user_has_membership`** sinon la
suspension est **inopérante** (le rôle continue d'être servi). Ajouter le filtre `is_active` :
```sql
CREATE OR REPLACE FUNCTION "auth_user_has_membership"(p_user_id uuid, p_org_id uuid)
RETURNS TABLE (role "Role") LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT m."role" FROM "memberships" m
  WHERE m."user_id" = p_user_id AND m."org_id" = p_org_id
    AND m."is_active" = true          -- <-- AJOUT : un membre suspendu ne porte plus de rôle
  LIMIT 1;
$$;
```

**(c) Fonction `provision_member`** (miroir de `provision_org`, DEFINER, org injectée
serveur) :
```sql
CREATE OR REPLACE FUNCTION "provision_member"(p_org_id uuid, p_user_id uuid, p_role "Role")
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v uuid := gen_random_uuid(); prev text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  IF p_role = 'OWNER' THEN RAISE EXCEPTION 'provision_member: OWNER interdit par cette voie'; END IF;
  PERFORM set_config('app.auth_bootstrap','on',true);
  PERFORM set_config('app.current_org', p_org_id::text, true);
  INSERT INTO "memberships"(id, org_id, user_id, role) VALUES (v, p_org_id, p_user_id, p_role);
  PERFORM set_config('app.current_org', prev, true);
  PERFORM set_config('app.auth_bootstrap','off',true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev, true);
  PERFORM set_config('app.auth_bootstrap','off',true); RAISE;
END;$$;
REVOKE ALL ON FUNCTION "provision_member"(uuid,uuid,"Role") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "provision_member"(uuid,uuid,"Role") TO "roadsen_app";
```
> `OWNER` interdit ici (l'unicité de l'OWNER se gère à la création d'org / transfert explicite).
> L'`@@unique(orgId,userId)` existant → un ré-ajout lève (23505) → 409 propre côté service.

**(d) Fonction `set_member_active`** (suspend/réactive, DEFINER, **anti-lockout OWNER**) :
```sql
CREATE OR REPLACE FUNCTION "set_member_active"(p_org_id uuid, p_user_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE tgt_role "Role"; owners int;
BEGIN
  SELECT role INTO tgt_role FROM "memberships" WHERE org_id=p_org_id AND user_id=p_user_id;
  IF tgt_role IS NULL THEN RAISE EXCEPTION 'membre introuvable'; END IF;
  IF tgt_role = 'OWNER' AND p_active = false THEN
    SELECT count(*) INTO owners FROM "memberships"
      WHERE org_id=p_org_id AND role='OWNER' AND is_active=true;
    IF owners <= 1 THEN RAISE EXCEPTION 'anti-lockout: dernier OWNER actif'; END IF;
  END IF;
  UPDATE "memberships" SET is_active = p_active WHERE org_id=p_org_id AND user_id=p_user_id;
END;$$;
REVOKE ALL ON FUNCTION "set_member_active"(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "set_member_active"(uuid,uuid,boolean) TO "roadsen_app";
```
+ `down.sql` symétrique (DROP FUNCTION provision_member/set_member_active ; restore
`auth_user_has_membership` sans le filtre ; `ALTER TABLE … DROP COLUMN is_active`).
+ marqueur `ROADSEN-MIGRATION-REVIEWED:` (garde-fou DDL destructeur du review-gate).

## 5. LOT 2 — API back-office (`admin.controller.ts`, déjà `@Roles(SUPERADMIN)`)

| Route | Rôle | Action |
|---|---|---|
| `POST /admin/orgs/:orgId/members` `{ userId, role }` | SUPERADMIN | `provision_member` — role ∈ {ADMIN, ENGINEER, TECHNICIAN, VIEWER} (Zod), **OWNER refusé** ; 201 `{ membershipId }` ; conflit unicité → **409 générique** |
| `PATCH /admin/orgs/:orgId/members/:userId` `{ isActive }` | SUPERADMIN | `set_member_active` — suspend/réactive ; anti-lockout → 409 |
| `GET /admin/orgs/:orgId/members` | SUPERADMIN | liste (userId, email, nom, role, isActive, calculs du mois via `UsageLedger` GROUP BY userId) |

- **Leçon #42** : l'`orgId` vient du **path param validé** (org existante), jamais d'un owner
  arbitraire ; `userId` doit être un user **existant** (le compte reste créé par
  `POST /admin/users`). Le service passe par `prisma.asAppRole` (patron existant).
- Non-consommant (pas de `@Consumes`) : gérer un membre ne décrémente pas le quota.

## 6. LOT 3 — Tests (Postgres RÉEL, DoD §3/§9) — les sentinelles obligatoires
1. **Suspension immédiate (le piège HAUTE)** : membre actif → 200 sur une route tenant ;
   `PATCH isActive=false` ; **même token** → **403 au prochain appel**. *(Prouve que le patch
   DEFINER mord — sans ce test, une régression rendrait la suspension silencieusement inopérante.)*
2. **Isolation** : un membre ajouté à l'org A ne voit **jamais** l'org B (RLS) ; le
   provisioning dans A n'affecte pas B.
3. **Anti-lockout** : `PATCH isActive=false` sur le **dernier OWNER actif** → 409.
4. **OWNER interdit par la route** : `POST …/members { role: 'OWNER' }` → 400/409.
5. **Quota partagé** : le nouveau membre émet un calcul → décrémente le quota **de l'org**
   (le même compteur), tracé à son `userId` dans le ledger.
6. **Réactivation** : `isActive=true` → l'accès revient au prochain appel.

## 7. Invariants sécurité non négociables (gravés + testés)
- `is_active` **et** patch `auth_user_has_membership` **et** test n°1 → **même PR** (sinon fausse sécurité).
- `OWNER` non attribuable par `provision_member` ; anti-lockout dernier OWNER.
- `orgId` = path d'une org existante ; `userId` = user existant (409 générique, anti-énumération).
- Revue de **migration multi-tenant en binôme** (surface DEFINER hors-RLS) avant merge.

## 8. Definition of Done (porte de jalon)
Code mergé · **tests verts CI/gate Docker** (les 6 sentinelles) · **isolation prouvée** (Postgres
réel, un tenant ne provisionne/voit/révoque jamais chez un autre, y compris après migration) ·
déployable préprod (rollback via `down.sql`) · **revue adverse `qa-challenger` réelle**
(zone sécurité = passage obligé) · doc (ce cadrage + note API).

## 9. Séquencement & effort
1. **Migration 0011** (schéma + 3 fonctions + patch + down + test n°1) — ~1 j.
2. **API back-office** (3 routes + service + DTO Zod) — ~0,5 j.
3. **Tests isolation/escalade/quota** (n°2–6) — ~0,5 j.
4. **Revue `qa-challenger`** + corrections — ~0,5 j.
→ **≈ 2,5 jours** (dev augmenté, socle stable).

## 10. Chaîne d'agents (build)
`architecte-technique` (validé, ce cadrage) → `dev-backend` (migration + fonctions + routes) ↔
`ingenieur-securite` (revue migration DEFINER + invariants, **séquencé** avec dev-backend, pas
en parallèle — 2 Opus max) → `qa-test` (6 sentinelles, Postgres réel) → `qa-challenger` (revue
adverse). Prompt de spawn `dev-backend` : rappeler #42 (orgId serveur), le piège du patch
DEFINER, l'anti-lockout, et « ne touche à aucun moteur / schéma figé sans avenant ».
