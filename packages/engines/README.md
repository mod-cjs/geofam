# @roadsen/engines — moteurs de calcul (CONFIDENTIEL, COTE SERVEUR UNIQUEMENT)

> Ce package est le coeur de propriete intellectuelle de la plateforme.
> Il NE DOIT JAMAIS etre importe par `apps/web` ni atteindre le navigateur.
> Garde-fou en place : regle ESLint `no-restricted-imports` (echec CI sinon)
>
> - separation par package (seul `apps/api` l importe).

## Role

Modules TypeScript **purs et deterministes** extraits des moteurs GeoSuite
fournis par le client (STARFIRE). Memes entrees -> memes sorties, sans effet de
bord, sans dependance au DOM ni a l environnement navigateur.

## Cartographie GeoSuite -> moteurs (ATTENTION : nom de fichier != fonction)

Source : `03-Moteurs-client/GeoSuite/source/tools/`

| Fichier source                            | Fonction reelle                       |
| ----------------------------------------- | ------------------------------------- |
| `roadsens_burmister_LCPC_VF_moderne.html` | Chaussees (Burmister / AGEROUTE 2015) |
| `GEOPLAQUE_V10.html`                      | Radier / plaque                       |
| `casagrande_V5.html`                      | **Pieux** (fondations profondes)      |
| `terzaghi_V13.html`                       | Fondation superficielle (EC7)         |
| `pressiometre__1_.html`                   | Pressiometre (Menard)                 |
| `FASTLAB7.html`                           | Labo + oedometre (Cc/Cs)              |

## Marqueur de confidentialite (OBLIGATOIRE dans chaque moteur)

Chaque module moteur DOIT importer et referencer le marqueur exporte par
`src/marker.ts` (`ENGINE_BUNDLE_MARKER`). Raison : le controle de bundle CI grep
une **chaine litterale stable** (`__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__`) —
un minifieur renomme les symboles mais ne reecrit pas le contenu des chaines.
Si du code moteur fuit dans le bundle navigateur, le marqueur fuit avec lui et la
CI echoue. Le specifier `@roadsen/engines` seul ne suffit pas (Next l efface au
tree-shake). Voir `.github/workflows/ci.yml` (etape "Controle de confidentialite").

## Methode d integration (golden-master)

1. Les cas-tests STARFIRE sont la **spec** : on les transcrit en golden tests.
2. On extrait le calcul HTML -> module TS pur.
3. Test d **equivalence** : module extrait == origine HTML (dans la tolerance convenue).
4. Test d **equivalence** : recalcul serveur == resultat affiche client (tolerance).
5. Couverture elevee exigee sur ce package.

> L extraction des moteurs est hors scope du socle. Cet emplacement est
> prepare ; l integration sera menee par `integrateur-moteurs` + `qa-test`.
> Toute modification d un moteur fourni = proposition -> `expert-genie-civil` -> avenant.
