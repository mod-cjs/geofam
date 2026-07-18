/**
 * FAC-SIMILÉ du rapport natif PressioPro (moteur `pressiometre-menard`, essai
 * Ménard NF EN ISO 22476-4) — décision titulaire 18/07 : le PV scellé reproduit
 * SECTION PAR SECTION le dépouillement que l'outil client affiche (`renderResults`
 * de packages/engines/reference/pressiometre__1_.html), en consommant la MÊME
 * sortie serveur whitelistée (`PressiometreOutputSchema`) que le clone rend à
 * l'écran. Invariant : PV == écran == rapport client.
 *
 * Le PV actuel ne rendait que pL / pL* / pf* / EM / ratio + catégorie — très
 * en-dessous du rapport natif (audit). Ce corps rétablit, dans l'ORDRE et avec les
 * LIBELLÉS de `renderResults` :
 *   - la grille KPI 1 (EM, pL, Pf, E/PLM + classement Remanié/N.C./Précons.) ;
 *   - la grille KPI 2 (P*LM, P*f, α Ménard, Ey = E/α) ;
 *   - l'encadré catégorie de sol (A..E + libellé + description) ;
 *   - le bloc « Extrapolation pLM » (§D.4.3.2 : A, B, PLM au V conventionnel,
 *     asymptote, écart d'ajustement) ;
 *   - les « Paramètres normalisés » (pE, p0, pf, σh0, pf*, pL, pL*, méthode, P*LM
 *     + table des volumes VE / V(p0) / V(pf) / VLim) ;
 *   - la synthèse (β, mE, plage auto, corrections a/Ph/Pe/Vs) ;
 *   - la table « Mesures corrigées » (P brut, P corr., V60 corr., Δ60/30, Phase) ;
 *   - les garde-fous affichés (EM = 0, résultat non corrigé, résistance propre).
 *
 * CONFIDENTIALITÉ (DoD §8) : lecture par clés NOMMÉES uniquement (fail-closed). La
 * sortie a déjà été whitelistée par `PressiometreOutputSchema` au calcul, puis figée
 * dans input_canonical au scellement — le PDF NE RE-RÉDIGE PAS, il consomme. Les
 * grandeurs de calage (pE, p0, pf, σh0, β, mE, volumes, extrapolation A/B) sont
 * TOUTES des champs whitelistés (« zéro écart », ADR 0014). Les corrections
 * appareillage (a, Ph, Pe, Vs) proviennent de l'ENTRÉE saisie par l'opérateur (sa
 * propre donnée). AUCUN intermédiaire de méthode SERVEUR (décomposition σV0/σ′v0/u0,
 * pression nette par palier pS, volumes v15/v30 corrigés, analyse de pente brute,
 * closure de régression) n'est rendu : ces champs ne sont pas dans la whitelist.
 *
 * Chrome GEOFAM, référentiel NF EN ISO 22476-4 (essai pressiométrique) — JAMAIS
 * AGEROUTE (chaussée), JAMAIS le brand ROADSEN dans le corps.
 */
import type { Content, TableCell } from 'pdfmake/interfaces';

import type { SealedContent } from '../pv-pdf';
import { COLORS, FINE_TABLE_LAYOUT } from '../pv-pdf.theme';

// ---------------------------------------------------------------------------
// Helpers de formatage — MIROIRS des conventions de `renderResults` (nombre de
// décimales par grandeur) mais en typographie maison fr-FR (séparateur décimal
// « , », comme la note terzaghi et l'affichage du clone). Fail-closed « — » sur
// une valeur non finie (jamais de « NaN » / « [object Object] » dans un PV).
// ---------------------------------------------------------------------------

/** Lecture d'un nombre fini ou null (jamais de coercition de chaîne — la sortie
 * scellée est déjà typée numérique par le schéma Zod). */
function fin(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Formatte à `d` décimales FIXES, fr-FR — parité `toFixed(d)` du rapport natif
 * (garde les zéros de queue, ex. « 0,4000 »), avec clamp anti « -0,00 ». */
function fmt(v: unknown, d: number, unit?: string): string {
  let n = fin(v);
  if (n === null) return '—';
  if (Math.abs(n) < 0.5 / Math.pow(10, d)) n = 0;
  const s = n
    .toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })
    .replace(/[\u202f\u00a0]/g, ' ');
  return unit ? `${s} ${unit}` : s;
}

/** bar → MPa (×0,1) puis format à `d` décimales — les pressions du moteur sont en
 * bar interne, AFFICHÉES en MPa partout (parité `(v*0.1).toFixed(d)` du client). */
function mpa(barVal: unknown, d: number, unit = 'MPa'): string {
  const n = fin(barVal);
  return n === null ? '—' : fmt(n * 0.1, d, unit);
}

/** Notation SCIENTIFIQUE fr-FR — parité `x.toExponential(2)` (coeffs A/B de la
 * régression courbe inverse), mantisse localisée « , ». */
function expo(v: unknown): string {
  const n = fin(v);
  return n === null ? '—' : n.toExponential(2).replace('.', ',');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Blocs de présentation (KPI, encadré catégorie, garde-fous) — miroirs des motifs
// `.kp` / `.catb` / bandeaux d'alerte de `renderResults`.
// ---------------------------------------------------------------------------

/** En-tête de section (MAJUSCULE inter-lettré maison), comme les `.ch` du client. */
function pmSection(label: string): Content {
  return { text: label.toUpperCase(), style: 'section', margin: [0, 14, 0, 6] };
}

/** Cellule d'en-tête de table (bleu, gras). */
function pmHead(text: string, align: 'left' | 'right' = 'left'): TableCell {
  return { text, style: 'tableHead', alignment: align };
}

/**
 * Une « carte » KPI = libellé + valeur + unité (+ badge de classement optionnel).
 * Rendue en cellule de tableau pour la grille (miroir des blocs `.kp` en `.kg4`).
 */
function kpiCell(
  label: string,
  value: string,
  unit: string,
  badge?: string,
): TableCell {
  const stack: Content[] = [
    { text: label, fontSize: 7.5, bold: true, color: COLORS.navy },
    { text: value, fontSize: 13, color: COLORS.text, margin: [0, 2, 0, 0] },
  ];
  if (badge)
    stack.push({
      text: badge,
      fontSize: 7.5,
      bold: true,
      color: COLORS.accent,
      margin: [0, 1, 0, 0],
    });
  stack.push({ text: unit, fontSize: 7.5, color: COLORS.muted });
  return { stack, fillColor: COLORS.cardFill, margin: [8, 7, 8, 7] };
}

/** Grille de 4 cartes KPI (miroir de `.kg4`), sans filets, fond de carte. */
function kpiRow(cells: TableCell[]): Content {
  return {
    margin: [0, 2, 0, 2],
    table: { widths: ['*', '*', '*', '*'], body: [cells] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 4,
      vLineColor: () => COLORS.white,
      paddingLeft: () => 0,
      paddingRight: () => 0,
    },
  };
}

/** Encadré catégorie de sol (miroir de `.catb`) : lettre + libellé + description. */
function categorieBlock(
  cat: string,
  libelle: string,
  description: string,
): Content {
  return {
    margin: [0, 6, 0, 6],
    table: {
      widths: ['auto', '*'],
      body: [
        [
          {
            text: cat || '—',
            fontSize: 16,
            bold: true,
            color: COLORS.navy,
            alignment: 'center',
            margin: [10, 8, 10, 8],
          },
          {
            stack: [
              { text: libelle || '—', fontSize: 10, bold: true },
              {
                text: description || '',
                fontSize: 8.5,
                color: COLORS.muted,
                margin: [0, 1, 0, 0],
              },
            ],
            margin: [0, 7, 8, 7],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => COLORS.rule,
    },
  };
}

/** Bandeau d'avertissement (miroir des encadrés `emWarn`/`calibWarn`/`pelWarn`),
 * fond doux accent, texte déjà rédigé (pas d'intermédiaire de calcul). */
function warnBox(text: string): Content {
  return {
    margin: [0, 4, 0, 4],
    table: {
      widths: ['*'],
      body: [
        [
          {
            text,
            fontSize: 8.5,
            color: COLORS.textSec2,
            fillColor: COLORS.navyFillSoft,
            margin: [10, 7, 10, 7],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
  };
}

/** Bandeau d'analyse (sans verdict de conformité) — miroir de l'en-tête d'analyse
 * partagé par les moteurs d'extraction/classification. */
function analyseBanner(): Content {
  return {
    margin: [0, 10, 0, 6],
    table: {
      widths: ['*'],
      body: [
        [
          {
            text: 'Résultat d’analyse — extraction / classification (sans verdict de conformité)',
            color: COLORS.textSec2,
            fontSize: 9,
            fillColor: COLORS.groupFill,
            margin: [12, 7, 12, 7],
          },
        ],
      ],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
  };
}

/** Ligne (libellé, valeur, unité) d'une table « Paramètres normalisés » (`.ptbl`). */
function normRow(label: string, value: string, unit: string): TableCell[] {
  return [
    { text: label, style: 'cell' },
    { text: value, style: 'cell', alignment: 'right' },
    { text: unit, style: 'cellMuted', alignment: 'right' },
  ];
}

// ---------------------------------------------------------------------------
// Corps du PV pressiométrique.
// ---------------------------------------------------------------------------

export function buildPressiometreBody(sealed: SealedContent): Content[] {
  const o = (sealed.output ?? {}) as Record<string, unknown>;
  const input = (sealed.input ?? {}) as Record<string, unknown>;
  // Paramètres d'appareillage = ENTRÉE de l'opérateur (sa propre donnée) — affichés
  // par la synthèse native. `a` est en cm³/bar interne (déjà /10 par l'appelant,
  // parité `getParams()`) : la synthèse le ré-exprime en cm³/MPa (×10).
  const params = isPlainObject(input.params) ? input.params : {};
  const body: Content[] = [];

  body.push(analyseBanner());

  // En-tête de la note (chrome GEOFAM + référentiel de l'essai).
  body.push({
    stack: [
      {
        text: 'PressioPro — dépouillement pressiométrique',
        fontSize: 11,
        bold: true,
        color: COLORS.navy,
      },
      {
        text: 'Essai Ménard · NF EN ISO 22476-4 · GEOFAM',
        fontSize: 8.5,
        color: COLORS.muted,
        margin: [0, 1, 0, 0],
      },
    ],
    margin: [0, 8, 0, 2],
  });

  // === Garde-fous AFFICHÉS (miroir de emWarn / calibWarn / pelWarn) ===
  // EM = 0 : plage pseudo-élastique invalide.
  if (fin(o.EM) === 0) {
    body.push(
      warnBox(
        'EM = 0 — plage pseudo-élastique invalide : p₀ ≥ pf ou ΔV ≤ 0. Ajustez les seuils p₀/pf sur la partie linéaire de la courbe.',
      ),
    );
  }
  // Résultat non corrigé : a écrêté à 0 (aForced) ou calibrage non renseigné (a = 0).
  if (fin(o.aUsed) === 0) {
    const cause =
      o.aForced === true
        ? 'coefficient a trop grand → forcé à 0 : correction de volume désactivée (vérifiez le calibrage)'
        : 'a = 0 : aucune correction de volume — calibrage non renseigné';
    body.push(warnBox(`Résultat non corrigé — ${cause}.`));
  }
  // Résistance propre de la sonde élevée (§A.2) — pel comparé à la limite fonction
  // de pLM. pel = Pe (entrée) en MPa ; pLM = pL (sortie) en MPa.
  const pelMPa = fin(params.Pe) !== null ? (params.Pe as number) * 0.1 : null;
  const pLMPa = fin(o.pL) !== null ? (o.pL as number) * 0.1 : null;
  if (pelMPa !== null && pLMPa !== null) {
    const pelMax =
      pLMPa <= 0.9 ? pLMPa / 4 + 0.025 : Math.min(pLMPa / 18 + 0.2, 0.35);
    if (pelMPa > pelMax) {
      body.push(
        warnBox(
          `Appareillage : résistance propre élevée — pel ≈ ${fmt(pelMPa, 3)} MPa > limite §A.2 (${fmt(pelMax, 3)} MPa pour pLM = ${fmt(pLMPa, 2)} MPa). Membrane/gaine trop raide pour ce sol.`,
        ),
      );
    }
  }

  // === Grille KPI 1 : EM · pL · Pf · E/PLM (+ classement) ===
  // Classement rhéologique (miroir : ratio<5 Remanié · <12 N.C. · sinon Précons.).
  const ratio = fin(o.ratioEMpL);
  const classement =
    ratio === null
      ? ''
      : ratio < 5
        ? 'Remanié'
        : ratio < 12
          ? 'N.C.'
          : 'Précons.';
  body.push(pmSection('Dépouillement — synthèse'));
  body.push(
    kpiRow([
      kpiCell('EM', fmt(o.EM, 2), 'MPa'),
      kpiCell('pL (limite)', mpa(o.pL, 3, ''), 'MPa'),
      kpiCell('Pf', mpa(o.pf, 3, ''), 'MPa'),
      kpiCell('EM / PLM', fmt(o.ratioEMpL, 1), '—', classement),
    ]),
  );
  // === Grille KPI 2 : P*LM · P*f · α Ménard · Ey = E/α ===
  body.push(
    kpiRow([
      kpiCell('P*LM', mpa(o.pLNette, 3, ''), 'MPa net'),
      kpiCell('P*f', mpa(o.pfNette, 3, ''), 'MPa net'),
      kpiCell('α Ménard', fmt(o.alpha, 2), '—'),
      kpiCell('Ey = E/α', fmt(o.Ey, 1), 'MPa'),
    ]),
  );

  // === Encadré catégorie de sol ===
  body.push(
    categorieBlock(
      typeof o.categorie === 'string' ? o.categorie : '',
      typeof o.categorieLibelle === 'string' ? o.categorieLibelle : '',
      typeof o.categorieDescription === 'string' ? o.categorieDescription : '',
    ),
  );

  // === Extrapolation pLM (§D.4.3.2) ===
  const ext = isPlainObject(o.extrapolation) ? o.extrapolation : {};
  const pLDirect = o.pLDirect === true;
  body.push(pmSection('Extrapolation pLM — NF EN ISO 22476-4 §D.4.3'));
  {
    const rows: TableCell[][] = [
      [
        pmHead('Courbe inverse : 1/(V−Vs) = A + B·p'),
        pmHead('Valeur', 'right'),
      ],
      [
        { text: 'A', style: 'cell' },
        { text: expo(ext.a), style: 'cell', alignment: 'right' },
      ],
      [
        { text: 'B', style: 'cell' },
        { text: expo(ext.b), style: 'cell', alignment: 'right' },
      ],
      [
        { text: 'pLM à V = Vs + 2·V(p₀)', style: 'cell' },
        { text: mpa(ext.plmVLim, 3), style: 'cell', alignment: 'right' },
      ],
      [
        { text: 'pLM asymptote (réf.)', style: 'cell' },
        { text: mpa(ext.plmAsymptote, 3), style: 'cell', alignment: 'right' },
      ],
      [
        { text: 'Ajustement moyen', style: 'cell' },
        {
          text: fin(ext.errV) === null ? '—' : fmt(ext.errV, 2, 'cm³'),
          style: 'cell',
          alignment: 'right',
        },
      ],
    ];
    body.push({
      table: { headerRows: 1, widths: ['*', 'auto'], body: rows },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 2],
    });
    body.push({
      text: pLDirect
        ? 'pL obtenue par interpolation directe (§D.4.2) — extrapolation indicative.'
        : 'pL retenue = extrapolation par courbe inverse au volume conventionnel Vs+2·V(p₀) (§D.4.3.2).',
      style: 'cellMuted',
      margin: [0, 1, 0, 4],
    });
  }

  // === Paramètres normalisés : pressions + volumes ===
  body.push(pmSection('Paramètres normalisés NF EN ISO 22476-4'));
  const plmMethode = pLDirect
    ? `${mpa(o.pL, 3, '')} MPa (direct)`
    : 'extrapolé';
  const zTxt = fin(o.z) === null ? '' : ` (z = ${fmt(o.z, 1)} m)`;
  const pRows: TableCell[][] = [
    [pmHead('Pression'), pmHead('Valeur', 'right'), pmHead('Unité', 'right')],
    normRow('pE', mpa(o.pE, 4, ''), 'MPa'),
    normRow('p₀ — début pseudo-élast.', mpa(o.p0, 4, ''), 'MPa'),
    normRow('pf — fin zone plate', mpa(o.pf, 3, ''), 'MPa'),
    normRow(`σh0 = K₀·σ′v0 + u₀${zTxt}`, mpa(o.sigmaH0, 4, ''), 'MPa'),
    normRow('pf* nette = pf − σh0', mpa(o.pfNette, 3, ''), 'MPa'),
    normRow('pL — pression limite', mpa(o.pL, 3, ''), 'MPa'),
    normRow('pL* nette = pL − σh0', mpa(o.pLNette, 3, ''), 'MPa'),
    normRow('pL méthode', plmMethode, ''),
    normRow('P*LM', mpa(o.pLNette, 3, ''), 'MPa net'),
  ];
  const vol = isPlainObject(o.volumes) ? o.volumes : {};
  const vRows: TableCell[][] = [
    [pmHead('Volume'), pmHead('Valeur', 'right'), pmHead('Unité', 'right')],
    normRow('VE — restitution', fmt(vol.vE, 0), 'cm³'),
    normRow('V(p₀) — début pseudo-élast.', fmt(vol.v0, 0), 'cm³'),
    normRow('V(pf) — fluage', fmt(vol.vf, 0), 'cm³'),
    normRow('Vs + 2×V(p₀) = VLim', fmt(vol.vLim, 0), 'cm³'),
  ];
  body.push({
    columns: [
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: pRows },
        layout: FINE_TABLE_LAYOUT,
      },
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: vRows },
        layout: FINE_TABLE_LAYOUT,
      },
    ],
    columnGap: 10,
    margin: [0, 2, 0, 4],
  });

  // === Synthèse (bandeau « Synthèse » du client) ===
  const synth = isPlainObject(o.synthese) ? o.synthese : {};
  const debut = fin(synth.plageAutoDebut);
  const finPlage = fin(synth.plageAutoFin);
  const plageTxt =
    debut !== null && finPlage !== null
      ? `Plage auto L${debut + 1}→L${finPlage + 1}`
      : 'Plage auto —';
  // mE affiché ×10 (cm³/bar interne → cm³/MPa), parité `(r.mE*10).toFixed(0)`.
  const mEval = fin(synth.mE);
  const mETxt = mEval === null ? '—' : `${fmt(mEval * 10, 0)} cm³/MPa`;
  // Corrections = ENTRÉE opérateur. a en cm³/bar → cm³/MPa (×10).
  const aVal = fin(params.a);
  const corrTxt =
    `Corrections NF EN ISO 22476-4 : a = ${aVal === null ? '—' : fmt(aVal * 10, 3)} cm³/MPa` +
    ` · Ph = ${fmt(params.Ph, 3)} bar · Pe = ${fmt(params.Pe, 2)} bar · Vs = ${fmt(params.V0, 0)} cm³`;
  body.push(pmSection('Synthèse'));
  body.push({
    stack: [
      {
        text: `EM = ${fmt(o.EM, 2)} MPa · pf = ${mpa(o.pf, 3, '')} MPa · pL = ${mpa(o.pL, 3, '')} MPa (${plmMethode})`,
        fontSize: 8.5,
        color: COLORS.textSec2,
      },
      {
        text: `β = ${fmt(synth.beta, 3)} · mE = ${mETxt} · ${plageTxt}`,
        fontSize: 8.5,
        color: COLORS.muted,
        margin: [0, 1, 0, 0],
      },
      {
        text: `EM/PLM = ${fmt(o.ratioEMpL, 1)} → ${typeof o.consolidation === 'string' ? o.consolidation : '—'}`,
        fontSize: 8.5,
        color: COLORS.textSec2,
        margin: [0, 1, 0, 0],
      },
      {
        text: `α = ${fmt(o.alpha, 2)} · Ey = E/α = ${fmt(o.Ey, 1)} MPa`,
        fontSize: 8.5,
        color: COLORS.textSec2,
        margin: [0, 1, 0, 0],
      },
      {
        text: corrTxt,
        fontSize: 8,
        color: COLORS.muted,
        margin: [0, 1, 0, 0],
      },
    ],
    margin: [0, 2, 0, 4],
  });

  // === Table des mesures corrigées (colonnes exactes du client) ===
  const courbe = (Array.isArray(o.courbe) ? o.courbe : []).filter(
    isPlainObject,
  );
  if (courbe.length > 0) {
    body.push(pmSection('Tableau des mesures corrigées'));
    const cb: TableCell[][] = [
      [
        pmHead('#', 'right'),
        pmHead('P brut', 'right'),
        pmHead('P corr.', 'right'),
        pmHead('V60 corr.', 'right'),
        pmHead('Δ60/30', 'right'),
        pmHead('Phase'),
      ],
    ];
    courbe.forEach((c, i) => {
      cb.push([
        { text: String(i + 1), style: 'cell', alignment: 'right' },
        { text: fmt(c.p, 3), style: 'cell', alignment: 'right' },
        { text: fmt(c.pCorr, 4), style: 'cell', alignment: 'right' },
        { text: fmt(c.v60, 0), style: 'cell', alignment: 'right' },
        { text: fmt(c.d6030, 0), style: 'cell', alignment: 'right' },
        {
          text: typeof c.phase === 'string' ? c.phase : '—',
          style: 'cell',
        },
      ]);
    });
    body.push({
      table: {
        headerRows: 1,
        widths: [18, '*', '*', '*', '*', 'auto'],
        body: cb,
      },
      layout: FINE_TABLE_LAYOUT,
      margin: [0, 2, 0, 4],
    });
  }

  return body;
}
