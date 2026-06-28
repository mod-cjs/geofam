# Référence API — Endpoints de calcul (`/calc/*`)

> **Etat** : pilote (Phase 1). Les quatre endpoints sont `@Public` (pas de garde
> tenant/RBAC). Le rattachement a un PV (persistance + scellement) interviendra
> lors du pipeline PV (`dev-backend`). **MJ-6 : pas de production sans conformite
> cas-tests STARFIRE (#36).** Toutes les sorties sont taguees `@science-unsigned`.

---

## Conventions communes

### Confidentialite (DoD §8)

Le calcul s'execute **exclusivement cote serveur** (`apps/api`). Le front ne recoit
que les grandeurs de resultat d'ingenierie (taux de travail, resistances, verdicts).
Aucun intermediaire confidentiel (coefficients de calage, facteurs de portance
partiels, contraintes brutes par couche, courbes corrigees...) n'est expose.

La sortie est projetee a travers un schema Zod de whitelist stricte avant renvoi
(double strip : construction manuelle + `projectEngineOutput`). Les `warnings[]`
textuels sont rediges pour en retirer toute valeur d'intermediaire confidentiel.

Voir ADR 0002 et ADR 0005.

### Enveloppe de reponse

Tout endpoint renvoie une union discriminee par `ok` :

**Succes (`ok: true`) :**

```json
{
  "ok": true,
  "meta": {
    "engineId": "...",
    "engineVersion": "1.0.0",
    "engineSourceHash": "<sha256-hex-64>"
  },
  "output": { ... }
}
```

**Echec moteur (`ok: false`) :**

```json
{
  "ok": false,
  "meta": { "engineId": "...", "engineVersion": "1.0.0" },
  "error": {
    "code": "INPUT_INVALIDE | NON_CONVERGENCE | DOMAINE_NON_COUVERT | ERREUR_INTERNE",
    "champ": "<identifiant_champ_fautif>"
  }
}
```

Le champ `error.code` est une enumeration fermee. Le libelle d'affichage est derive
du code cote API (`ENGINE_ERROR_LIBELLES`) — aucun message libre porteur d'intermediaires.

**`engineSourceHash`** : empreinte SHA-256 du fichier HTML source dont le module a
ete extrait. Permet de re-verifier un PV ulterieur contre la version source exacte.

### Codes d'erreur HTTP

| Code                | Cause                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| `400`               | Corps hors-schema (validation Zod) — details `{ path, code }` sans valeur recue |
| `200` (`ok: false`) | Entree valide schema mais hors-domaine moteur, ou exception moteur              |
| `500`               | Exception inattendue non moteur (loguee cote serveur, opaque cote client)       |

### Validation

Chaque route applique `ZodValidationPipe` sur le schema d'entree du contrat. Une
entree hors-schema renvoie un 400 avec :

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Validation echouee",
  "details": [{ "path": ["champ"], "code": "invalid_type" }],
  "traceId": "..."
}
```

La valeur recue n'est jamais renvoyee dans le detail d'erreur (anti-fuite, ADR 0004).

---

## POST /calc/terzaghi

**Moteur** : fondations superficielles — NF P 94-261  
**ID registre** : `fondation-superficielle`  
**Incrément** : #45

### Objet

Dimensionnement d'une fondation superficielle (filante, carree, rectangulaire ou
circulaire) par la methode pressiometrique Menard (pression limite `ple*`), la methode
penetrometrique (`qce`) ou la methode analytique `c–φ`. Verifie la portance, le
glissement et le tassement pour chaque cas de charge saisi (ELU_F, ELU_A, ELS_C,
ELS_F, ELS_QP).

### Schema d'entree

Les nombres peuvent etre passes en chaine FR (`"1,5"`) ou en nombre (`1.5`) — le
moteur parse lui-meme via `num()` (virgule decimale FR) pour parite avec le HTML
d'origine.

| Champ            | Type                 | Requis | Description                                                          |
| ---------------- | -------------------- | ------ | -------------------------------------------------------------------- |
| `projet`         | string (≤ 200)       | non    | Libelle d'affichage, hors calcul                                     |
| `sondage`        | SondageRow[] (≤ 200) | oui    | Lignes de sondage in situ                                            |
| `sondage[].z`    | number\|string       | non    | Profondeur (m)                                                       |
| `sondage[].pl`   | number\|string       | non    | Pression limite Menard pl (MPa)                                      |
| `sondage[].em`   | number\|string       | non    | Module pressiometrique EM (MPa)                                      |
| `sondage[].al`   | number\|string       | non    | Coefficient rheologique α                                            |
| `sondage[].qc`   | number\|string       | non    | Resistance de pointe qc (MPa)                                        |
| `solCat`         | enum                 | oui    | Categorie de sol : `argiles \| sables \| craies \| marnes \| roches` |
| `nappe`          | number\|string       | non    | Profondeur de nappe (m)                                              |
| `gAvant`         | number\|string       | non    | Poids volumique avant travaux (kN/m³)                                |
| `gApres`         | number\|string       | non    | Poids volumique apres travaux (kN/m³)                                |
| `c`              | number\|string       | non    | Cohesion c ou cu (kPa)                                               |
| `phi`            | number\|string       | non    | Angle de frottement φ (deg)                                          |
| `eYoung`         | number\|string       | non    | Module d'Young E (MPa)                                               |
| `nuSol`          | number\|string       | non    | Coefficient de Poisson ν                                             |
| `cphiOn`         | boolean              | non    | Activer le calcul c–φ                                                |
| `cphiMode`       | enum                 | non    | `auto \| nd \| d` (non-draine / draine)                              |
| `gSous`          | number\|string       | non    | Poids volumique sous nappe (kN/m³)                                   |
| `essai`          | enum                 | oui    | `pressio \| penetro \| labo`                                         |
| `alphaSang`      | number\|string       | non    | Coefficient α de Sanglerat (M = α·qc)                                |
| `profilMode`     | enum                 | oui    | `couches \| essais`                                                  |
| `forme`          | enum                 | oui    | `filante \| carree \| rect \| circ`                                  |
| `B`              | number\|string       | non    | Largeur B (m)                                                        |
| `L`              | number\|string       | non    | Longueur L (m) — requis si `forme=rect`                              |
| `D`              | number\|string       | non    | Encastrement D (m)                                                   |
| `talusOn`        | boolean              | non    | Fondation en bord de talus                                           |
| `beta`           | number\|string       | non    | Pente du talus (deg)                                                 |
| `dTalus`         | number\|string       | non    | Distance au bord du talus (m)                                        |
| `talusDir`       | enum                 | non    | `ext \| int`                                                         |
| `beton`          | enum                 | non    | `coule \| prefa`                                                     |
| `alphaConst`     | boolean              | non    | Surcharger α (construction)                                          |
| `alphaConstVal`  | number\|string       | non    | Valeur d'α construction                                              |
| `charges`        | ChargeRow[] (≤ 50)   | oui    | Cas de charge                                                        |
| `charges[].etat` | enum                 | oui    | `ELU_F \| ELU_A \| ELS_C \| ELS_F \| ELS_QP`                         |
| `charges[].fz`   | number\|string       | non    | Effort vertical Fz (kN)                                              |
| `charges[].fx`   | number\|string       | non    | Effort horizontal Fx (kN)                                            |
| `charges[].fy`   | number\|string       | non    | Effort horizontal Fy (kN)                                            |
| `charges[].mx`   | number\|string       | non    | Moment Mx (kN.m)                                                     |
| `charges[].my`   | number\|string       | non    | Moment My (kN.m)                                                     |

### Schema de sortie (whitelist)

```
output.erreur             string|null     Erreur de saisie globale (calcul non lance)
output.warnings           string[]        Avertissements normatifs (redactes)
output.regime             string?         'superficielle' | 'semi-profonde' (annexe C)
output.capaciteReference  object?         Capacite portante (charge centree verticale)
  .ok                     boolean
  .A                      number          Aire de fondation A (m²)
  .R0                     number          Surcharge laterale R0 = A·q0 (kN)
  .states[]               object[]        Par etat-limite (ELU_F / ELU_A / ELS_C)
    .etat                 string
    .gRv                  number          Coefficient partiel γRv
    .Rvd                  number          Resistance verticale de calcul R_v;d (kN)
    .qRvd                 number          Contrainte resistante q_Rv;d (kPa)
output.cas[]              object[]        Verdict par cas de charge
  .idx                    number          Index du cas dans la saisie
  .etat                   string          Etat-limite
  .invalide               boolean         Cas rejete (Fz <= 0, A' = 0...)
  .Rtot                   number?         Resistance totale R_tot (kN)
  .qRvd                   number?         Contrainte resistante (kPa)
  .taux                   number?         Taux de mobilisation portance Fz/R_tot
  .portanceOk             boolean?        Portance verifiee
  .Rhd                    number?         Resistance au glissement R_h;d (kN)
  .tauxH                  number?         Taux mobilisation horizontale H/R_h;d
  .glissementOk           boolean?        Glissement verifie
  .tassement              number?         Tassement Menard (m)
  .tassementSchmertmann   number?         Tassement Schmertmann (m)
  .tassementOed           number?         Tassement oedometrique Sanglerat (m)
  .tassementElastique     number?         Tassement elastique J.3.1 (m)
  .deplacementVertical    number?         Deplacement vertical (m)
```

**Intermediaires non exposes :** `ple*`, `qce`, `De`, `kp`, `kc`, `A'`, facteurs de
forme (kf, kc, bv, bB), coefficients d'inclinaison iδ/iβ, moyennes harmoniques par
tranche, Nq/Nc/Ng, modules Ec/Ed, et tous les resultats intermediaires de l'objet
`R` interne du moteur.

---

## POST /calc/burmister

**Moteur** : dimensionnement de chaussees — methode rationnelle / AGEROUTE Senegal 2015  
**ID registre** : `chaussee-burmister`  
**Incrément** : #46

### Objet

Dimensionnement d'une structure de chaussee multicouche par la methode rationnelle
(propagation des contraintes multicouches, lois de fatigue AGEROUTE). Verifie le
critere de fatigue de la couche liee et le critere d'orniarage du sol support.

### Schema d'entree

Les champs numeriques acceptent des nombres finis bornes (pas d'unions chaine, le HTML
d'origine lisait des `+value` deja convertis).

| Champ              | Type                  | Requis | Description                                               |
| ------------------ | --------------------- | ------ | --------------------------------------------------------- |
| `projet`           | string (≤ 200)        | non    | Libelle d'affichage                                       |
| `layers`           | Layer[] (1..20)       | oui    | Couches de structure (surface vers bas)                   |
| `layers[].mat`     | string (1..32)        | oui    | Cle materiau (ex. `BBSG1`, `GB3`, `GL1`)                  |
| `layers[].E`       | number (1..60000 MPa) | oui    | Module d'Young (MPa)                                      |
| `layers[].nu`      | number (0.1..0.5)     | oui    | Coefficient de Poisson                                    |
| `layers[].h`       | number (0.001..2 m)   | oui    | Epaisseur (m)                                             |
| `subgrade`         | object                | oui    | Plateforme support de chaussee (PSC)                      |
| `subgrade.cls`     | string (≤ 16)         | non    | Classe PF (affichage)                                     |
| `subgrade.E`       | number                | oui    | Module PSC (MPa)                                          |
| `subgrade.nu`      | number                | oui    | Poisson PSC                                               |
| `traffic`          | object                | oui    | Donnees de trafic                                         |
| `traffic.T`        | number (0..1e6)       | oui    | TMJA poids lourds par sens (PL/j/sens)                    |
| `traffic.C`        | number (0..100)       | oui    | Coefficient d'agressivite moyen (CAM)                     |
| `traffic.N`        | number (1..100)       | oui    | Duree de service (ans)                                    |
| `traffic.tau`      | number (-50..50)      | oui    | Taux de croissance annuel (%)                             |
| `traffic.dir`      | number (0..2)         | oui    | Coefficient directionnel f_dir                            |
| `traffic.tv`       | number (0..2)         | oui    | Coefficient repartition transversale f_tv                 |
| `load`             | object                | oui    | Charge de reference (jumelage)                            |
| `load.p`           | number (0.01..5 MPa)  | oui    | Pression de contact (MPa)                                 |
| `load.a`           | number (0.01..1 m)    | oui    | Rayon surface chargee (m)                                 |
| `load.d`           | number (0..2 m)       | oui    | Entraxe jumelage (m)                                      |
| `load.r`           | `'auto'` \| number    | non    | Risque effectif (`auto` = Tab. 70)                        |
| `load.sh`          | `'auto'` \| number    | non    | Sh (cm) (`auto` = Tab. VI.2.4)                            |
| `load.ks`          | `'auto'` \| number    | non    | ks (`auto` = couche sous-jacente)                         |
| `materials`        | object                | non    | Referentiel materiaux AGEROUTE (defaut interne si absent) |
| `materials.<CODE>` | MaterialEntry         | non    | Entree pour chaque code AGEROUTE enumere                  |

**Codes materiaux AGEROUTE enumeres** (jeu ferme) : `BBSG1`, `BBSG2`, `BBTM`, `BBM`,
`GB2`, `GB3`, `EME2`, `GL1`, `GL2`, `GLli`, `GLa`, `GLc1`, `GLc2`, `GNT1`, `GNT2`,
`GC3`, `SC2`, `BQc`, `BC5`, `BC2`.

### Schema de sortie (whitelist)

```
output.erreur           string|null     Erreur de calcul bornee
output.warnings         string[]        Avertissements (redactes)
output.conforme         boolean         Verdict global (tous criteres requis verifies)
output.NE               number          Trafic cumule (essieux equivalents)
output.famille          string          Famille de structure (libelle LCPC §4.2-4.5)
output.epaisseurLiee    number          Epaisseur du paquet lie (m)
output.epaisseurTotale  number          Epaisseur totale des couches (m)
output.fatigue          object?         Critere de fatigue (si applicable)
  .rigide               boolean         true = MTLH/beton (σ_t MPa) ; false = bitumineux (ε_t μdef)
  .valeur               number|null     Valeur sollicitante
  .admissible           number|null     Valeur admissible
  .ok                   boolean         Critere verifie
  .requis               boolean         Critere requis par la famille de structure
output.ornierage        object          Critere d'orniarage (sol support)
  .valeur               number          ε_z sollicitant (μdef)
  .admissible           number          ε_z admissible (μdef)
  .ok                   boolean         Critere verifie
```

**Intermediaires non exposes :** tenseur de contraintes brut aux interfaces (sz/sr/sth),
contraintes aux interfaces critiques (s0/sd2/bz), coefficients de calage des lois de
fatigue (kr, ks, kc, Sh, b, ε₆/σ₆, kθ), matrices de propagateur (ABCD 4×4).

---

## POST /calc/pressiometre

**Moteur** : depouillement pressiometrique Menard — NF EN ISO 22476-4  
**ID registre** : `pressiometre-menard`  
**Incrément** : #47

### Objet

Depouillement d'un essai pressiometrique Menard pour une profondeur donnee :
determination de la pression limite `pL`, de la pression de fluage `pf`, du module
pressiometrique `EM`, et classification du sol. Le resultat alimente le dimensionnement
de fondation (terzaghi) via les colonnes `pl` et `em` du sondage.

### Unites internes

Le moteur travaille en **bar** pour les pressions et en **cm³** pour les volumes,
conformement au HTML d'origine. En particulier, `params.a` est l'inertie en cm³/bar
(l'appelant divise la valeur saisie en cm³/MPa par 10, comme le faisait `getParams()`
du HTML).

### Schema d'entree

| Champ        | Type                    | Requis | Description                                                   |
| ------------ | ----------------------- | ------ | ------------------------------------------------------------- |
| `projet`     | string (≤ 200)          | non    | Libelle d'affichage                                           |
| `label`      | string (1..40)          | oui    | Libelle de profondeur ; `z = parseFloat(label)` (parite HTML) |
| `params`     | object                  | oui    | Parametres sonde / correction (unites internes bar)           |
| `params.a`   | number (0..100 cm³/bar) | oui    | Inertie appareillage (deja /10)                               |
| `params.Ph`  | number (0..50 bar)      | oui    | Pression hydrostatique colonne d'eau                          |
| `params.Pe`  | number (0..50 bar)      | oui    | Resistance propre sonde                                       |
| `params.V0`  | number (1..10000 cm³)   | oui    | Volume initial sonde                                          |
| `params.k0`  | number (0..5)           | oui    | Coefficient des terres au repos K0                            |
| `gamma`      | number (0..40 kN/m³)    | oui    | Poids volumique du sol (defaut moteur = 19 si <= 0)           |
| `nappe`      | number (0..1000 m)      | oui    | Profondeur de nappe (0 = absente)                             |
| `rows`       | Row[] (1..60)           | oui    | Paliers de mesure (moteur exige >= 4 valides)                 |
| `rows[].p`   | number (0..500 bar)     | oui    | Pression appliquee (bar)                                      |
| `rows[].v15` | number (0..10000 cm³)   | oui    | Volume a 15 s                                                 |
| `rows[].v30` | number (0..10000 cm³)   | oui    | Volume a 30 s                                                 |
| `rows[].v60` | number (0..10000 cm³)   | oui    | Volume a 60 s                                                 |
| `pf_idx`     | integer (-1..59)        | non    | Selection manuelle debut pseudo-elastique (-1 = auto)         |
| `plm_idx`    | integer (-1..59)        | non    | Selection manuelle fin de plage (-1 = auto)                   |

### Schema de sortie (whitelist)

```
output.erreur           string|null     Erreur de calcul / donnees insuffisantes
output.warnings         string[]        Avertissements (redactes ; structurellement vide a ce jour)
output.pL               number          Pression limite pL (bar)
output.pLNette          number          Pression limite nette pL* = pL - sigH0 (bar)
output.pfNette          number          Pression de fluage nette pf* = pf - sigH0 (bar)
output.EM               number          Module pressiometrique EM (MPa)
output.ratioEMpL        number          EM / pL* (sans dimension)
output.alpha            number          Coefficient rheologique α (Menard)
output.pLDirect         boolean         false = pL extrapole (§D.4.3)
output.categorie        string (≤ 4)    Categorie de sol (A..E)
output.categorieLibelle string (≤ 80)   Libelle de categorie
output.consolidation    string (≤ 80)   Etat de consolidation
```

**Intermediaires non exposes :** courbe corrigee complete `C` (pression et volumes
par palier), decomposition contrainte au repos (sigH0/sigV0/u0), analyse de pente
de la plage pseudo-elastique (mE, beta, indices auto_p0I/auto_pfI), coefficients
A/B de la regression (extrapolation §D.4.3.2), courbe de fluage, pressions/volumes
de calage intermediaires (pE, p0, Pf bruts, VE/V0c/Vf).

---

## POST /calc/pieux

**Moteur** : portance de pieu / fondations profondes — NF P 94-262, EC7  
**ID registre** : `fondation-profonde-pieux`  
**Incrément** : #48

### Objet

Calcul de la portance d'un pieu isole (ou groupe) selon NF P 94-262 (Eurocode 7,
annexe nationale France). Methodes pressiometrique (PMT), penetrometrique (CPT) ou
analytique (c–φ). Approches de calcul EC7 DA1/DA2/DA3. Sens compression ou traction.
Fournit les resistances caracteristiques Rb;k/Rs;k/Rc;k, la resistance de calcul ELU
Rc;d, les charges de fluage ELS, et le verdict de verification par combinaison.

### Schema d'entree

| Champ             | Type                   | Requis | Description                                         |
| ----------------- | ---------------------- | ------ | --------------------------------------------------- |
| `projet`          | string (≤ 200)         | non    | Libelle d'affichage                                 |
| `pieu`            | string (≤ 200)         | non    | Libelle du pieu                                     |
| `geom`            | object                 | oui    | Geometrie de section                                |
| `geom.section`    | enum                   | oui    | `circ \| carre \| rect \| quel`                     |
| `geom.g_B`        | number (0..10 m)       | non    | Diametre/cote B                                     |
| `geom.g_b2`       | number (0..10 m)       | non    | Largeur b (section rect)                            |
| `geom.g_Ap`       | number (0..100 m²)     | non    | Aire de pointe Ap (section quelconque)              |
| `geom.g_P`        | number (0..100 m)      | non    | Perimetre fut P (section quelconque)                |
| `g_z0`            | number (0..500 m)      | oui    | Profondeur de tete (m)                              |
| `g_D`             | number (0..500 m)      | oui    | Profondeur de base D (m)                            |
| `cat`             | integer (1..20)        | oui    | Categorie de pieu (Tableau A.1 NF P 94-262)         |
| `meth`            | enum                   | oui    | `pmt \| cpt \| cphi`                                |
| `da`              | enum                   | oui    | `da1 \| da2 \| da3`                                 |
| `sens`            | enum                   | oui    | `comp \| trac`                                      |
| `essais`          | enum                   | oui    | `oui \| non` (essais de chargement)                 |
| `c_G`             | number (0..1e9 kN)     | oui    | Charge permanente caracteristique G                 |
| `c_Q`             | number (0..1e9 kN)     | oui    | Charge variable caracteristique Q                   |
| `o_nappe`         | number (0..500 m)      | oui    | Profondeur de nappe                                 |
| `o_nprofil`       | number (1..10000)      | oui    | Nombre de profils de sol (facteurs xi)              |
| `o_surf`          | number (0..1e9 m²)     | oui    | Surface investiguee (facteurs xi)                   |
| `o_redis`         | enum                   | oui    | `oui \| non` (redistribution structure rigide)      |
| `grp`             | object                 | oui    | Effet de groupe                                     |
| `grp.grp_n`       | number (1..10000)      | oui    | Nombre de files                                     |
| `grp.grp_m`       | number (1..10000)      | oui    | Pieux par file                                      |
| `grp.grp_s`       | number (0..1000 m)     | oui    | Entraxe S (0 = isole)                               |
| `coeffs`          | object                 | oui    | Coefficients partiels (NA france DA2 + fluage)      |
| `coeffs.k_gG`     | number                 | oui    | γG defavorable (defaut 1,35)                        |
| `coeffs.k_gQ`     | number                 | oui    | γQ defavorable (defaut 1,50)                        |
| `coeffs.k_gb`     | number                 | oui    | γb pointe (defaut 1,10)                             |
| `coeffs.k_gs`     | number                 | oui    | γs frottement (defaut 1,10)                         |
| `coeffs.k_gst`    | number                 | oui    | γs;t traction (defaut 1,15)                         |
| `coeffs.k_psi2`   | number                 | oui    | ψ₂ quasi-permanent (defaut 0,3)                     |
| `coeffs.cr_b_b`   | number                 | oui    | Coef Rb;k fluage, pieu refoulement (defaut 0,70)    |
| `coeffs.cr_b_s`   | number                 | oui    | Coef Rs;k fluage, pieu refoulement (defaut 0,70)    |
| `coeffs.cr_f_b`   | number                 | oui    | Coef Rb;k fluage, pieu fore (defaut 0,50)           |
| `coeffs.cr_f_s`   | number                 | oui    | Coef Rs;k fluage, pieu fore (defaut 0,70)           |
| `coeffs.cr_car`   | number                 | oui    | γ fluage caracteristique compression (defaut 0,90)  |
| `coeffs.cr_qp`    | number                 | oui    | γ fluage quasi-permanent compression (defaut 1,10)  |
| `coeffs.cr_car_t` | number                 | oui    | γs;cr fluage caracteristique traction (defaut 1,10) |
| `coeffs.cr_qp_t`  | number                 | oui    | γs;cr fluage quasi-permanent traction (defaut 1,50) |
| `layers`          | Layer[] (1..100)       | oui    | Profil de couches                                   |
| `layers[].soil`   | enum                   | oui    | `argile \| sable \| craie \| marne \| roche`        |
| `layers[].th`     | number (0..200 m)      | oui    | Epaisseur (m)                                       |
| `layers[].pl`     | number (0..100 MPa)    | non    | Pression limite nette pl\* (methode PMT)            |
| `layers[].em`     | number (0..100000 MPa) | non    | Module EM (tassement)                               |
| `layers[].qc`     | number (0..200 MPa)    | non    | Resistance de pointe qc (methode CPT)               |
| `layers[].c`      | number (0..100000 kPa) | non    | Cohesion c (methode c-φ)                            |
| `layers[].phi`    | number (0..89 deg)     | non    | Angle de frottement φ (methode c-φ)                 |
| `layers[].gamma`  | number (0..40 kN/m³)   | non    | Poids volumique                                     |
| `cpt`             | object                 | oui    | Penetrogramme qc(z) (methode CPT)                   |
| `cpt.step`        | number (0.01..10 m)    | oui    | Pas de sondage                                      |
| `cpt.pts`         | CptPoint[] (0..2000)   | oui    | Points {z, qc} ; vide = genere depuis couches       |

**Valeurs par defaut des coefficients** : disponibles via `PIEUX_DEFAULT_COEFFS`
(exporte par `@roadsen/engines`).

### Schema de sortie (whitelist)

```
output.erreur             string|null     Erreur de calcul / garde du moteur
output.warnings           string[]        Avertissements (redactes)
output.B                  number          Diametre/cote equivalent B (m)
output.D                  number          Profondeur de base D (m)
output.categorie          integer         Categorie de pieu (1..20)
output.methode            string          Methode retenue ('pmt'/'cpt'/'cphi')
output.sens               string          Sens de sollicitation ('comp'/'trac')
output.RbK                number          Resistance de pointe caracteristique Rb;k (kN)
output.RsK                number          Resistance de frottement caracteristique Rs;k (kN)
output.RcK                number          Resistance caracteristique totale Rc;k (kN)
output.RcD                number          Resistance de calcul ELU gouvernante Rc;d (kN)
output.RcrK               number          Charge de fluage caracteristique Rc;cr;k (kN)
output.RcrCar             number          Resistance fluage ELS caracteristique (kN)
output.RcrQp              number          Resistance fluage ELS quasi-permanent (kN)
output.FduELU             number          Sollicitation ELU gouvernante Fd (kN)
output.FdCar              number          Sollicitation ELS caracteristique G + Q (kN)
output.FdQp               number          Sollicitation ELS quasi-permanent G + ψ₂·Q (kN)
output.verifications[]    object[]        Verifications par combinaison (ELU + ELS)
  .nom                    string          Libelle de la combinaison
  .Fd                     number          Sollicitation de calcul (kN)
  .Rd                     number          Resistance de calcul (kN)
  .taux                   number          Taux de travail Fd/Rd
  .ok                     boolean         Fd <= Rd
output.allOk              boolean         Toutes les verifications satisfaites
output.tauxGouvernant     number          Max(Fd/Rd) toutes combinaisons
output.tassementELS       number|null     Tassement ELS sous charge caracteristique (mm)
```

**Intermediaires non exposes :** terme de pointe brut `qb`, pression limite nette
equivalente `ple`, resistance de pointe equivalente `qce`, facteurs de portance
`kfac`/`kmax` (kp/kc Tab. F.4.2.1/G.4.2.1), hauteur d'encastrement equivalente
`Def`/`debR`, detail de frottement par couche (`fric`), courbe de mobilisation du
tassement (`settle.pts`), facteurs de correlation `xi3`/`xi4`, coefficient de
modele `grd`, facteurs partiels intermediaires par combinaison.

---

## Note sur le statut scientifique

Les quatre moteurs sont tagues `@science-unsigned`. L'equivalence-portage
(module TS == HTML d'origine, tolerance 1e-9) est prouvee par les harnais jsdom.
La **justesse scientifique** — conformite effective aux normes NF P 94-261, NF P 94-262,
AGEROUTE 2015 et NF EN ISO 22476-4 — reste **non validee** tant que le kit cas-tests
STARFIRE (#36) n'est pas fourni et rejoue.

**MJ-6 : aucun de ces endpoints ne doit etre expose en production ni utilise pour
produire des PV avant cette validation.**
