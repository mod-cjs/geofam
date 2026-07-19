/**
 * Tests — Skeleton (wrapper client), variant='row'.
 *
 * FX-9 : `case 'row'` rendait `<SkeletonRow/>` (un `<tr>`) sous un `<div>` —
 * un `<tr>` hors `<table>` est du HTML invalide et déclenche l'erreur
 * d'hydratation React (« <tr> cannot be a child of <div> ») au chargement de
 * PV & Livrables et Informations. Sentinelle : le HTML rendu ne contient
 * JAMAIS `<tr` pour variant='row'.
 *
 * DoD §9 : given/when/then, zéro faux-vert (assertions non triviales sur le
 * contenu réel, pas seulement "ne plante pas").
 */

import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import { Skeleton } from '../Skeleton.client';

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("Skeleton variant='row' — FX-9 (pas de <tr> hors <table>)", () => {
  it('GIVEN variant="row" WHEN rendu THEN aucun <tr> dans le HTML produit (évite l’erreur d’hydratation)', () => {
    const html = render(<Skeleton variant="row" />);
    expect(html).not.toContain('<tr');
    expect(html).not.toContain('<td');
  });

  it('GIVEN variant="row" WHEN rendu THEN un conteneur div avec aria-busy et un bloc icône + barres shimmer', () => {
    const html = render(<Skeleton variant="row" />);
    expect(html).toContain('<div');
    expect(html).toContain('aria-busy="true"');
    // Icône (36x36) + au moins 2 barres shimmer (titre + sous-titre)
    const shimmerCount = (html.match(/roadsen-shimmer/g) ?? []).length;
    expect(shimmerCount).toBeGreaterThanOrEqual(3);
  });

  it('GIVEN variant="row" WHEN rendu THEN hauteur par défaut ~80px (proportions liste, CLS = 0)', () => {
    const html = render(<Skeleton variant="row" />);
    expect(html).toContain('height:80px');
  });

  it('GIVEN variant="row" avec un style personnalisé (PvListClient) WHEN rendu THEN le style personnalisé est appliqué sans réintroduire de <tr>', () => {
    const html = render(
      <Skeleton variant="row" style={{ marginBottom: 8, height: 80 }} />,
    );
    expect(html).toContain('margin-bottom:8px');
    expect(html).not.toContain('<tr');
  });

  it('GIVEN variant="row" WHEN rendu deux fois (liste, comme dans PvListClient) THEN chaque instance reste valide (pas de <tr>)', () => {
    const html = renderToString(
      <div>
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>,
    );
    expect(html).not.toContain('<tr');
  });
});

describe('Skeleton — autres variantes non régressées par le correctif FX-9', () => {
  it('GIVEN variant="output-table" WHEN rendu THEN reste un <table> avec des <tr> (usage légitime, non touché)', () => {
    const html = render(<Skeleton variant="output-table" />);
    expect(html).toContain('<table');
    expect(html).toContain('<tr');
  });

  it('GIVEN variant="card-projet" WHEN rendu THEN carte div classique (comportement inchangé)', () => {
    const html = render(<Skeleton variant="card-projet" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('<tr');
  });

  it('GIVEN variant="text" WHEN rendu THEN texte div classique (comportement inchangé)', () => {
    const html = render(<Skeleton variant="text" />);
    expect(html).toContain('Chargement');
  });

  it('GIVEN variant="badge" WHEN rendu THEN shimmer seul (comportement inchangé)', () => {
    const html = render(<Skeleton variant="badge" />);
    expect(html).toContain('roadsen-shimmer');
  });
});
