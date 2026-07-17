/**
 * Test SENTINELLE (CRITIQUE-1) — le PV d'un mode 2D GEOPLAQUE (plane-strain /
 * axi-plaque / radier-tri) ne doit PAS être un mur de nombres.
 *
 * CONTEXTE : ces trois modes ont désormais un CORPS MÉTIER DÉDIÉ (buildPlaneStrainBody
 * / buildAxiBody / buildTriRaftBody), miroir des panneaux `#ps-run` / `#ax-run` /
 * `#tri-run` de l'outil client. Leur sortie porte des CHAMPS D'AFFICHAGE volumineux —
 * `profils` (97 points × plusieurs courbes) et `champDeflexion` (grille jusqu'à 48×48 =
 * 2304 valeurs) — destinés au RENDU de l'app (carto design-sûre), JAMAIS listés en
 * clé-valeur. Aplatis récursivement, ils produiraient des centaines à des milliers de
 * lignes : un PV scellé/numéroté imprésentable (DoD §5).
 *
 * PROTECTION prouvée ici : le corps dédié ne rend QUE des scalaires whitelistés et
 * n'énumère jamais `profils`/`champDeflexion` (l'intégrité est intacte — ils restent
 * DANS input_canonical scellé). Volume BORNÉ + libellés métier.
 *
 * On construit un OfficialPv SCELLÉ en mémoire (sceau valide) — patron du spec
 * multipage : aucune base, aucun réseau.
 */
import type { OfficialPv } from '@prisma/client';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  type SealableValue,
} from '@roadsen/shared';

import { buildPvDocDefinition, collectPvPdfText, renderPvPdf } from './pv-pdf';

const SECRET = 'secret-unitaire-geoplaque-2d';

/** Construit un OfficialPv COHÉRENT (sceau valide) pour un mode 2D en fallback. */
function makeSealedPv(
  engineId: string,
  input: SealableValue,
  output: SealableValue,
): OfficialPv {
  const pvNumber = 'PV-RDS-org-a-2026-009002';
  const sealedAtIso = '2026-07-14T10:00:00.000Z';
  const content: SealableValue = {
    pvNumber,
    sealedAt: sealedAtIso,
    engineMeta: {
      engineId,
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: { userId: 'u-1', projectId: 'p-1', projectName: 'Radier 2D' },
    input,
    output,
    scienceStatus: 'unsigned',
  };
  const canonical = canonicalize(content);
  return {
    id: 'pv-2d-1',
    orgId: '11111111-1111-1111-1111-111111111111',
    calcResultId: 'c-1',
    projectId: 'p-1',
    pvNumber,
    userId: 'u-1',
    projectName: 'Radier 2D',
    engineId,
    engineVersion: '1.0.0',
    engineSourceHash: 'a'.repeat(64),
    inputCanonical: canonical,
    output,
    scienceStatus: 'unsigned',
    verdict: 'NON_APPLICABLE',
    contentHash: sealContentHash(canonical),
    hmac: sealHmac(canonical, SECRET),
    sealedAt: new Date(sealedAtIso),
  };
}

/** Profil ré-échantillonné (97 points) — champ d'affichage de plane-strain/axi. */
function profil(label: string): SableRecord {
  const x: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < 97; i += 1) {
    x.push(Number((i * 0.1).toFixed(3)));
    v.push(Number((Math.sin(i / 5) * 1.234).toFixed(4)));
  }
  return { x, v, unit: 'mm', label };
}
type SableRecord = Record<string, SealableValue>;

/** Grille de déflexion 48×48 = 2304 valeurs — champDeflexion de radier-tri. */
function champDeflexion(): SableRecord {
  const vals: number[] = [];
  for (let i = 0; i < 48 * 48; i += 1)
    vals.push(Number(((i % 11) * 0.37).toFixed(3)));
  return { nx: 48, ny: 48, vals };
}

/** Sortie 2D typique : scalaires métier + gros champs d'affichage. */
function twoDOutput(): SealableValue {
  return {
    ok: true,
    erreur: null,
    warnings: [],
    // SCALAIRES métier (à conserver au rendu — whitelist implicite du fallback) :
    wMax: 12.34,
    wMin: 1.23,
    diff: 11.11,
    mMax: 45.67,
    mMin: -3.21,
    pMax: 78.9,
    totalLoad: 1000,
    sumReact: 999.5,
    z0: 0,
    decolN: 0,
    EI: 54321.6,
    // CHAMPS D'AFFICHAGE volumineux (à STRIPPER au rendu clé-valeur) :
    profils: {
      deflexion: profil('Déflexion'),
      moment: profil('Moment'),
      reaction: profil('Réaction'),
    },
    champDeflexion: champDeflexion(),
  };
}

/** Entrée minimale (quelques champs) — n'influe pas sur le sujet du test. */
function smallInput(): SealableValue {
  return { projet: 'Radier 2D', mode: 'plane-strain', Bw: 8, e: 0.4, ne: 60 };
}

/** Le plus long enchaînement de lignes composées UNIQUEMENT d'un nombre. */
function maxNumericRun(text: string): number {
  const isNumericLine = (s: string): boolean =>
    /^[-\u2212]?[\d\s.,\u202f\u00a0]+$/.test(s.trim()) && /\d/.test(s);
  let max = 0;
  let cur = 0;
  for (const line of text.split('\n')) {
    if (isNumericLine(line)) {
      cur += 1;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

/** Nombre de lignes de texte rendues (ordre de l'arbre = ce que voit le lecteur). */
function lineCount(text: string): number {
  return text.split('\n').filter((l) => l.trim() !== '').length;
}

describe('PV mode 2D GEOPLAQUE (fallback) — pas de mur de nombres (CRITIQUE-1)', () => {
  const prevSecret = process.env.PV_SIGNING_SECRET;
  beforeAll(() => {
    process.env.PV_SIGNING_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PV_SIGNING_SECRET;
    else process.env.PV_SIGNING_SECRET = prevSecret;
  });

  it.each(['plane-strain', 'axi-plaque', 'radier-tri'])(
    '%s : rendu BORNÉ (< 80 lignes) et sans mur de nombres',
    (engineId) => {
      const pv = makeSealedPv(engineId, smallInput(), twoDOutput());
      const text = collectPvPdfText(pv);
      // (1) volume borné : sans strip, profils(3×194) + grille(2304) ~ des
      //     centaines/milliers de lignes -> ROUGE avant correction.
      expect(lineCount(text)).toBeLessThan(80);
      // (2) aucun mur de nombres : pas d'enchaînement de dizaines de nombres.
      expect(maxNumericRun(text)).toBeLessThan(20);
    },
  );

  it('rend les diagnostics métier AVEC libellés (corps plane-strain dédié) et masque les champs d’affichage', () => {
    const pv = makeSealedPv('plane-strain', smallInput(), twoDOutput());
    const def = buildPvDocDefinition(pv);
    // Les grandeurs sont désormais LIBELLÉES (miroir du panneau `#ps-run`), plus de
    // clés brutes « wMax »/« mMax »/« EI » : chaque valeur porte son unité.
    expect(findRowValue(def.content, 'Tassement maximal w_max')?.value).toBe(
      '12,3 mm', // wMax 12.34 -> toFixed(1) fr-FR comme l'outil client
    );
    expect(findRowValue(def.content, 'Moment fléchissant maximal')?.value).toBe(
      '45,7 kN·m/m',
    );
    expect(findRowValue(def.content, 'Tassement différentiel')?.value).toBe(
      '11,1 mm',
    );
    expect(findRowValue(def.content, 'Rigidité de flexion D')?.value).toMatch(
      /kN·m$/,
    );
    expect(findRowValue(def.content, 'Charge / réaction Σ')?.value).toContain(
      'kN/m',
    );
    const text = collectPvPdfText(pv);
    // Aucune clé brute résiduelle (le fallback clé-valeur n'est plus emprunté).
    expect(text).not.toContain('wMax');
    expect(text).not.toContain('mMax');
    // Les clés de PURE VISUALISATION ne sont JAMAIS rendues.
    expect(text).not.toContain('champDeflexion');
    expect(text).not.toContain('deflexion');
    expect(text).not.toContain('profils');
  });

  it('produit un PDF réel de volume BORNÉ (≤ 2 pages, sceau valide)', async () => {
    // Avant correction : 84 pages (mur de nombres). Après strip : PV court
    // (cartes d'identité + entrées + scalaires + bloc de scellement insécable).
    const pv = makeSealedPv('radier-tri', smallInput(), twoDOutput());
    const buf = await renderPvPdf(pv);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    const s = buf.toString('latin1');
    const m =
      /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/.exec(s) ??
      /\/Count\s+(\d+)/.exec(s);
    const pages = m ? Number(m[1]) : 0;
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThanOrEqual(2);
  });

  it('l’intégrité est intacte : les champs d’affichage restent DANS le sceau', () => {
    const pv = makeSealedPv('plane-strain', smallInput(), twoDOutput());
    // input_canonical (scellé) contient toujours profils + champDeflexion : le
    // corps dédié ne les liste jamais, mais la donnée scellée est intacte.
    expect(pv.inputCanonical).toContain('profils');
    expect(pv.inputCanonical).toContain('champDeflexion');
    // Le rendu ne throw pas et le hash imprimé recolle au sceau (fail-closed).
    expect(() => buildPvDocDefinition(pv)).not.toThrow();
  });
});

/** Lit la valeur (cellule d'index 1) de la ligne dont la 1re cellule = `label`. */
function findRowValue(
  content: unknown,
  label: string,
): { value: string } | null {
  let found: { value: string } | null = null;
  const cellText = (c: unknown): string =>
    c &&
    typeof c === 'object' &&
    typeof (c as { text?: unknown }).text === 'string'
      ? (c as { text: string }).text
      : '';
  const walk = (n: unknown): void => {
    if (found || n == null) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      const o = n as Record<string, unknown>;
      const table = o.table as { body?: unknown[][] } | undefined;
      if (table?.body) {
        for (const row of table.body) {
          if (
            Array.isArray(row) &&
            row.length >= 2 &&
            cellText(row[0]) === label
          ) {
            found = { value: cellText(row[1]) };
            return;
          }
        }
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(content);
  return found;
}
