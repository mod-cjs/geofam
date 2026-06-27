# ADR 0010 — Contrat de reconciliation `[orgSlug]` (URL) ↔ `X-Org-Id` (en-tete API)

- Statut : accepte
- Date : 2026-06-27
- Tranche : F-01 de l'inventaire ecrans (D-01, D-03, D-04, C-04). Binome dev-backend
  + ingenieur-securite ; a prouver par test (qa-test).

## Contexte

Le shell (Lot 2) porte l'organisation courante dans l'URL : `/app/[orgSlug]/…`.
L'API, deja deployee, porte l'organisation par l'en-tete `X-Org-Id` (un UUID), et le
`TenantGuard` re-verifie cote serveur que le user authentifie possede un Membership
dans cet org AVANT de poser le moindre contexte tenant (cf. `tenant.guard.ts`). Il
faut un contrat de reconciliation entre les deux representations.

Contrainte ferme du panel (F-01) : la resolution `slug → orgId` dans le `middleware.ts`
Next se fait **via les claims JWT uniquement, jamais par un appel DB par requete**.
Le middleware Next s'execute sur l'edge runtime a chaque navigation ; un round-trip DB
par requete y est inacceptable (latence, couplage edge↔DB, surface).

Tension a regarder en face. Le JWT actuel (`token.service.ts`) est **volontairement
minimal** : `sub` + `typ`, AUCUN org ni role. Le commentaire du code en donne la raison :
« une revocation de membership/role prend effet immediatement (le token ne fige aucun
droit) ». Mettre `slug + role` par org dans le JWT **contredit en partie ce choix** : on
fige une photo des appartenances dans un jeton a duree de vie non nulle. Cet ADR assume
ce compromis et en borne le risque ; il ne le masque pas.

## Decision

### 1. Le JWT d'acces embarque la liste des memberships (slug + role)

Le payload du token **d'acces** (pas le refresh) ajoute un claim `orgs` :

```jsonc
{
  "sub": "<uuid user>",
  "typ": "access",
  "orgs": [
    { "id": "<uuid org>", "slug": "be-routes-dakar", "role": "OWNER" },
    { "id": "<uuid org>", "slug": "labo-thies",       "role": "ENGINEER" }
  ]
  // iat / exp standard
}
```

- `id` = UUID de l'org (= ce qui partira en `X-Org-Id`).
- `slug` = identifiant d'URL (ce que le middleware lit dans `[orgSlug]`).
- `role` = role tenant (`OWNER|ADMIN|ENGINEER|TECHNICIAN|VIEWER`) — present pour gater
  l'UI cote middleware/shell SANS appel reseau (defense en profondeur ; **le RBAC
  applique reste le `RolesGuard` serveur**, cf. §5).
- Le **refresh token reste minimal** (`sub` + `typ`) : il ne porte aucune appartenance.
  C'est lui le pivot de la fraicheur (cf. §3).

`platformRole` (SUPERADMIN/SUPPORT) **n'entre pas** dans `orgs` : un superadmin n'a pas
d'org propre et passe par les routes `@NoTenant`. S'il faut l'exposer au shell, c'est un
claim distinct `platformRole`, hors de cette decision.

### 2. Le `middleware.ts` Next valide `[orgSlug]` contre les claims et injecte `X-Org-Id`

Algorithme du middleware (edge, sans DB), pour toute requete `/app/[orgSlug]/…` :

1. Lire le token d'acces (cookie httpOnly recommande — cf. §6) et **verifier sa
   signature et son expiration** localement (HS256, meme secret cote serveur ; la cle
   de verification doit etre disponible a l'edge). Echec → redirect `/login?returnTo=…`.
2. Extraire `orgs` du payload. Chercher l'entree dont `slug === params.orgSlug`.
3. **Slug membre** → poser l'en-tete sortant `X-Org-Id: <entry.id>` sur les appels API
   (le shell n'envoie JAMAIS un `X-Org-Id` choisi par le client ; il est **derive du
   slug valide contre les claims**, jamais saisi). Laisser passer.
4. **Slug absent de `orgs`** → traiter comme « ressource d'un autre tenant » :
   **redirect silencieux** vers la racine d'une org legitime du user
   (`/app/<premier slug membre>/projets`) si le user a au moins une org, sinon
   `/login`. **Pas** de page « org X interdite » : anti-enumeration (cf. D-03/B-33).
5. **Token absent/expire** → redirect `/login?returnTo=<path demande>` (D-01/D-02).
6. **Aucune org dans `orgs`** (user provisionne sans membership) → page d'etat
   « aucune organisation attribuee » (B-08 generalise), pas une boucle de redirect.

Point dur honnete : `X-Org-Id` injecte par le middleware n'est PAS une frontiere de
securite — c'est un confort/cohérence d'UX. La frontiere reste le `TenantGuard` serveur
(§5). Si un attaquant forge `X-Org-Id` directement contre l'API (hors navigateur), le
serveur re-verifie le membership et refuse. Le middleware ne fait que de l'UX-routing.

### 3. Invalidation au changement d'appartenance (fraicheur des claims)

Le claim `orgs` est une **photo a `iat`**. Trois mecanismes bornent sa peremption :

- **TTL d'acces court — abaisse a 5 minutes** pour ce projet (defaut actuel 15m ;
  `JWT_ACCESS_TTL=5m`). La fenetre de staleness d'un membership ajoute/retire est donc
  ≤ 5 min cote claims.
- **Le refresh reconstruit `orgs` a partir de la base** : a chaque `POST /auth/refresh`,
  l'API relit les memberships frais (via la fonction DEFINER `auth_get_user_profile`,
  deja en place) et re-emet un access token avec un `orgs` a jour. Donc au pire 5 min.
- **Le serveur reste la verite immediate** : meme si un access token porte encore un
  membership revoque, le `TenantGuard` (qui lit le membership en base a chaque requete,
  cf. `membershipRole`) **refuse immediatement** (403). La revocation d'ACCES est donc
  instantanee cote API ; seul l'AFFICHAGE du slug dans le menu peut etre obsolete ≤ 5 min.

> Autrement dit : on a deplace le compromis « token fige les droits » du **controle
> d'acces** (qui reste DB-temps-reel) vers le **routing d'UI** (qui tolere 5 min de
> retard). C'est acceptable parce que l'UI n'est jamais la barriere.

Cas particulier — **ajout** d'un nouvel org pendant la session : il n'apparait dans le
menu qu'apres le prochain refresh (≤ 5 min) ou un re-login. Acceptable en P1
(provisionnement manuel, pas de temps reel attendu). A documenter pour `dev-frontend`.

### 4. Switch d'org (D-04) et tests negatifs

- **Switch d'org** = navigation vers `/app/<autre slug membre>/…` + `queryClient.clear()`
  cote shell (jamais conserver `projetId`/`calculId` de l'org precedente). Le middleware
  re-valide le nouveau slug contre `orgs` et re-derive `X-Org-Id`.
- **Tests negatifs obligatoires (qa-test) — a PROUVER, pas a supposer :**
  - T1. Forger `/app/<orgB>/projets/<projetId-de-orgA>` avec un user membre de orgB
    mais pas de orgA : middleware passe (slug orgB membre), API recoit `X-Org-Id=orgB`,
    le `projetId` de orgA n'existe PAS sous orgB → **404 tenant-safe** (RLS ne voit
    rien). Verifier qu'on ne distingue pas « inexistant » de « autre tenant » (D-03/B-11).
  - T2. Slug absent de `orgs` (`/app/<org-jamais-membre>/…`) → **redirect silencieux**,
    aucun `X-Org-Id` emis, aucune fuite d'existence de l'org.
  - T3. Forger directement `X-Org-Id: <orgA>` (curl, hors navigateur) avec un token
    de user non-membre de orgA → **403 `TenantGuard`** (la barriere serveur tient sans
    le middleware). C'est LE test qui prouve que le middleware n'est pas la securite.
  - T4. Token avec `orgs` falsifie (membership ajoute a la main) → signature invalide →
    rejet au verify (middleware ET serveur). Prouve que `orgs` est protege par la signature.
  - T5. Membership revoque en base puis requete avec un access token encore valide
    portant l'ancien `orgs` → **403 immediat** (le `TenantGuard` relit la base). Prouve
    que la fraicheur de l'acces ne depend PAS du claim.

### 5. Le serveur reste la seule frontiere (inchange)

`X-Org-Id` derive du middleware n'allege EN RIEN le `TenantGuard`. La chaine serveur
reste : `JwtAuthGuard` → `TenantGuard` (re-verifie le membership en base, fail-closed)
→ `RolesGuard` (RBAC). Le `role` du claim `orgs` **ne sert qu'a l'UI** ; le RBAC
d'autorisation est tranche par le `RolesGuard` qui relit le role en base (un role
fige dans le token n'autorise jamais une action serveur).

### 6. Durcissement transport du token

- Le token d'acces devrait etre stocke en **cookie httpOnly + Secure + SameSite=Lax**
  (lisible par le middleware edge, illisible par JS → anti-XSS-exfiltration), pas en
  `localStorage`. A trancher avec `dev-frontend` au cablage du shell ; impacte le mode
  d'envoi de `X-Org-Id` (le middleware reecrit la requete API). Si l'equipe garde un
  header `Authorization: Bearer`, alors le token est en memoire JS et le middleware le
  lit autrement — **decision de transport a figer, signalee comme non encore prouvee**.

## Consequences

### Impact backend (pour dev-backend)

1. **`token.service.ts`** : `signAccess(userId)` devient `signAccess(userId, orgs)` ;
   le payload inclut `orgs: {id, slug, role}[]`. `verify` accepte et retourne `orgs`
   (typage `AccessClaims`). **Le refresh reste minimal.**
2. **`auth.service.ts` / `issueTokens`** : avant de signer l'access, charger les
   memberships frais (reutiliser `auth_get_user_profile`, deja appele par `getProfile`)
   et passer `orgs` a `signAccess`. Le **`login` ET le `refresh`** reconstruisent `orgs`
   → au refresh, `orgs` est a jour (mecanisme de fraicheur §3).
3. **`JWT_ACCESS_TTL`** abaisse a `5m` (env + doc devops). Borne la staleness UI.
4. **`JwtAuthGuard`** : continuer a ne se fier qu'a `sub` pour l'identite. **Ne jamais**
   deriver l'autorisation du claim `orgs` cote serveur (ce serait court-circuiter le
   `TenantGuard`). `orgs` est un claim « pour le client », le serveur l'ignore pour l'AuthZ.
5. **Taille du token** : `orgs` grossit le JWT. En P1 (1–3 orgs/user, provisionnement
   manuel) c'est negligeable. Garde-fou : si un jour un user appartient a des dizaines
   d'orgs, basculer vers un claim `orgs` tronque + endpoint `GET /auth/me` pagine. Borne
   a documenter, non bloquante P1.
6. **Aucune migration de schema** pour cet ADR (le modele Membership existe deja). Le
   changement est purement applicatif (emission/lecture du token).

### Impact frontend (Lot 2 — pour dev-frontend)

- `middleware.ts` : algorithme §2 (verify token edge, match slug↔`orgs`, injecte
  `X-Org-Id`, redirects D-01/D-02/D-03). La cle de verification HS256 doit etre dispo a
  l'edge (variable d'env edge ; **ne jamais** exposer le secret au bundle client).
- `OrgSwitcherProvider` (B-04) lit `orgs` du token (ou `GET /auth/me`) pour peupler le
  menu. Switch = navigation + `queryClient.clear()` (D-04).
- Etats : slug non-membre → redirect silencieux (D-03) ; 0 org → B-08 ; 401 → D-02.
- **Rappel confidentialite** : aucune logique de calcul/symbole moteur cote navigateur
  (DoD §8). `orgs` ne contient que id/slug/role, jamais d'info moteur.

### Points a prouver par test (honnetete d'ingenieur)

- T1–T5 du §4 sont des **portes** : tant qu'elles ne sont pas vertes en CI, le contrat
  n'est pas tenu. T3 et T5 sont les plus importants (ils prouvent que le serveur barre
  meme quand le middleware est contourne / le claim est obsolete).
- La **verification HS256 a l'edge** doit etre testee (token expire, signature KO,
  `alg:none`) — l'edge runtime Next n'a pas le meme crypto que Node ; valider la lib
  utilisee (jose) rejette bien `alg:none` et l'alg-confusion, comme cote serveur.
- Le compromis de staleness (≤ 5 min sur l'AFFICHAGE, 0 sur l'ACCES) doit etre verifie
  par T5 ; sinon on aurait re-introduit le defaut que le JWT minimal evitait.

## Liens

- `token.service.ts`, `auth.service.ts`, `tenant.guard.ts` (chaine existante).
- Inventaire D-01/D-02/D-03/D-04, B-11/B-27/B-33 (404 tenant-safe), F-01.
- ADR 0011 (enforcement abonnement) — le contrat d'entitlements consomme la meme
  identite/org resolue ici.
