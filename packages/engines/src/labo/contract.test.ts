/**
 * CONTRAT FASTLAB (#56) — la SORTIE est une whitelist `.strict()` : tous les resultats
 * de labo + la classification GTR, et RIEN d'autre (DoD §8, criteres 3 & 7).
 *
 * Particularite FASTLAB : les resultats de labo et la classe GTR sont le LIVRABLE de
 * l'essai (client-safe), PAS une methode confidentielle. Le contrat borne donc la
 * FORME (re-parse strict, fail-closed sur cle inconnue) plutot qu'il ne cache un secret.
 * On verifie surtout : conformite au schema, exposition de la classe, et l'ABSENCE de
 * cles internes du `D` brut non whitelistees (granPts, wl_raw, mfq deja expose...).
 */
import { describe, expect, it } from 'vitest';

import { LaboInputSchema, LaboOutputSchema } from './contract.js';
import { LABO_FIXTURES } from './test-fixtures.js';

import { runLabo } from './index.js';

/**
 * Cles INTERNES du `D` brut qui ne doivent PAS atteindre la sortie (intermediaires de
 * trace, non whitelistes) : la courbe granulo brute, wL non arrondi, et les cles de
 * classification internes (deplacees sous `classe`).
 */
const FUITES_INTERDITES = ['granPts', 'wl_raw', 'rhod_app_raw', 'cbrType_raw'];

function collectKeys(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, acc));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      collectKeys(v, acc);
    }
  }
}

describe('labo — contrat de sortie (whitelist .strict())', () => {
  for (const fx of LABO_FIXTURES) {
    it(`[${fx.id}] sortie conforme au schema declare (re-parse strict)`, () => {
      const env = runLabo(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const reparsed = LaboOutputSchema.parse(env.output);
      expect(reparsed).toEqual(env.output);
    });

    it(`[${fx.id}] aucune cle interne de trace ne fuit (granPts/wl_raw...)`, () => {
      const env = runLabo(fx.input);
      if (!env.ok) return;
      const keys = new Set<string>();
      collectKeys(env.output, keys);
      const fuites = FUITES_INTERDITES.filter((k) => keys.has(k));
      expect(fuites, `cle interne trouvee dans la sortie`).toEqual([]);
    });
  }

  it('la meta porte l identite, la version et le hash source (tracabilite PV)', () => {
    const fx = LABO_FIXTURES[0];
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runLabo(fx.input);
    expect(env.meta.engineId).toBe('labo-classification-gtr');
    expect(env.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(env.meta.engineSourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('une cle non whitelistee au sommet de la sortie est REJETEE (.strict(), fail-closed)', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const pollue = { ...env.output, granPts: [[0.08, 30]] /* cle interne interdite */ };
    expect(() => LaboOutputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });

  it('le DEMO expose la classe A2 + les resultats de labo (wn/p80/ip/vbs)', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.classe.code).toBe('A2');
    expect(env.output.classe.full).toMatch(/^A2/);
    expect(Number.isFinite(env.output.wn as number)).toBe(true);
    expect(Number.isFinite(env.output.p80 as number)).toBe(true);
    expect(Number.isFinite(env.output.ip as number)).toBe(true);
    expect(Number.isFinite(env.output.vbs as number)).toBe(true);
    // Le chemin de decision est expose (libelles), pas une cle interne brute.
    expect(env.output.classe.path.length).toBeGreaterThan(0);
  });

  it('un echantillon non classable renvoie une classe sans code (null), sans crash', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'indetermine-vide');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.classe.code).toBeNull();
    expect(env.output.classe.full).toBeNull();
    expect(env.output.wn).toBeNull();
  });

  // --- MAJEUR 1 (#49-53) : un readForm() COMPLET (avec IDENTIFICATION) PASSE -----------
  // readForm() du HTML serialise TOUT champ .save non vide, dont l'identification
  // (m_ref/m_chantier/…). Le DEMO du HTML EN CONTIENT. Avant correctif, le contrat
  // .strict() rejetait ces ids -> « Unrecognized key » -> 400 sur une entree 100 %
  // legitime. Ce test MORD : il prouve qu'un readForm complet (DEMO + identite) valide
  // et classe bien A2 h. ROUGE si on retire les ids d'identification du contrat.
  it('MAJEUR 1 : un readForm() COMPLET avec identification valide et classe A2 h', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    // Le DEMO porte desormais m_ref/m_chantier/m_client/m_dossier/… (cf. HTML L1567-1570).
    expect(fx.input.m_ref).toBeTruthy();
    expect(fx.input.m_chantier).toBeTruthy();
    // Le schema NE doit PAS rejeter ces metadonnees (parse direct, comme le controleur).
    expect(() => LaboInputSchema.parse(fx.input)).not.toThrow();
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.classe.full).toBe('A2 h');
  });

  it('MAJEUR 1 : les ids .save annexes (gr_fond/la_charge/su_type/mc_cls0) sont acceptes', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    const avecAnnexes = {
      ...fx.input,
      gr_fond: '5',
      la_charge: '5000',
      su_type: 'CaSO4',
      mc_cls0: '4/6.3',
    };
    expect(() => LaboInputSchema.parse(avecAnnexes)).not.toThrow();
  });

  it('FAIL-CLOSED : un id VRAIMENT inconnu reste rejete (.strict())', () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    const pollue = { ...fx.input, champ_totalement_inexistant_xyz: '42' };
    expect(() => LaboInputSchema.parse(pollue)).toThrow(/[Uu]nrecognized/);
  });
});

// --- MINEUR B (#49-53) : SENTINELLE PAR KERNEL — la couverture MORD si null -----------
// Le filet anti-faux-vert du golden-runner compte les feuilles numeriques GLOBALEMENT
// (granulo heritee de SABLE_B/GRAVE_D/DEMO satisfait deja le compteur) : il ne GARANTIT
// PAS que le KERNEL CIBLE soit non-null. On verrouille donc, par kernel, que le CHAMP
// de sortie du kernel cible est un NOMBRE FINI. ROUGE si une donnee de kernel cassait et
// que le kernel retombait a null (le cas golden resterait vert sans cette sentinelle).
describe('labo — sentinelle de couverture par kernel (le champ cible est NON-null)', () => {
  const SENTINELLES: Array<{
    fixtureId: string;
    fields: Array<keyof import('./contract.js').LaboOutput>;
  }> = [
    { fixtureId: 'kernel-rhos-methodeA', fields: ['rhos'] },
    { fixtureId: 'kernel-rhos-methodeB', fields: ['rhos'] },
    { fixtureId: 'kernel-cbr-complet', fields: ['cbr', 'gonfl'] },
    { fixtureId: 'kernel-dens-lin-prism', fields: ['rho_app', 'rhod_app'] },
    { fixtureId: 'kernel-dens-immersion', fields: ['rho_app'] },
    { fixtureId: 'kernel-dens-deplacement', fields: ['rho_app'] },
    { fixtureId: 'kernel-rho-absorption', fields: ['wa'] },
    { fixtureId: 'kernel-mde-campagne', fields: ['mde'] },
    { fixtureId: 'kernel-cisail-ring', fields: ['c_cis', 'phi_cis'] },
    { fixtureId: 'kernel-perm-const', fields: ['k'] },
  ];

  for (const { fixtureId, fields } of SENTINELLES) {
    it(`[${fixtureId}] le(s) champ(s) cible(s) ${fields.join('/')} sont des nombres FINIS (non-null)`, () => {
      const fx = LABO_FIXTURES.find((f) => f.id === fixtureId);
      expect(fx, `fixture ${fixtureId} absente`).toBeDefined();
      if (!fx) return;
      const env = runLabo(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      for (const field of fields) {
        const v = env.output[field];
        expect(
          typeof v === 'number' && Number.isFinite(v),
          `${fixtureId}.${String(field)} attendu fini non-null, recu ${JSON.stringify(v)}`,
        ).toBe(true);
      }
    });
  }
});
