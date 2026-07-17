/**
 * Route handler authentifié servant les clones d'outils (ADR 0015).
 *
 * `GET /api/tools/:toolId?orgId=<id>` — sert le HTML du clone
 * (`apps/web/src/tools-cloned/<toolId>.html`) à `ToolFrame`, qui l'injecte en
 * `srcdoc`. Deux portes avant de servir le fichier :
 *  1. Session requise (Authorization: Bearer <token>, avec repli cookie —
 *     mêmes noms que http-client.ts / middleware.ts).
 *  2. Entitlement du module vérifié (`evaluateGate`, fail-closed) — pas
 *     seulement l'authentification : un tenant sans le module ne doit même
 *     pas recevoir l'UI de l'outil.
 *
 * Bascule mock/réel : ce handler tourne côté serveur (jamais de sessionStorage
 * disponible) — l'entitlement est donc résolu soit par un appel réel à
 * `GET /me/entitlements` (mode réel), soit via `getMockEntitlements` (mode
 * démo). LIMITE CONNUE (documentée au rapport de mission) : en mode démo, le
 * scénario `?demo=` piloté par le DemoPanel (localStorage navigateur) n'est
 * PAS visible depuis ce contexte serveur — on suppose le scénario `active`.
 *
 * Confidentialité DoD §8 : ce fichier ne fait QUE de la distribution de HTML
 * déjà excisé (clone) — aucun import @roadsen/engines, aucun calcul.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type NextRequest, NextResponse } from 'next/server';

import { adaptEntitlements, type BackendEntitlements } from '@/lib/api/adapters';
import { getMockEntitlements } from '@/lib/api/mock-data';
import type { EntitlementsResponse } from '@/lib/api/types';
import { engineIdForSoftware } from '@/lib/software-catalog';
import { evaluateGate } from '@/lib/subscription-gate';

export const runtime = 'nodejs';

const CLONES_DIR = path.join(process.cwd(), 'src', 'tools-cloned');

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';
const USE_REAL_BACKEND = API_BASE !== '';

/**
 * CSP dédiée au clone : aucun réseau sortant depuis l'iframe (tout le calcul
 * transite par le bridge postMessage vers l'hôte, jamais par un fetch direct
 * de l'outil cloné). `unsafe-inline` requis : le clone est un artefact HTML
 * monolithique (style + script inline), comme l'outil client d'origine.
 */
const CLONE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";

function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim();
  }
  // Repli : cookie JS-readable posé par http-client.ts (mode réel) ou par
  // LoginClient (mode mock) — mêmes noms que middleware.ts.
  return (
    request.cookies.get('roadsen_access_token')?.value ??
    request.cookies.get('roadsen_mock_auth')?.value ??
    null
  );
}

async function fetchEntitlements(
  token: string,
  orgId: string,
): Promise<EntitlementsResponse> {
  if (!USE_REAL_BACKEND) {
    return getMockEntitlements('active', orgId);
  }
  const res = await fetch(`${API_BASE}/me/entitlements`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': orgId },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`entitlements ${res.status}`);
  }
  const raw = (await res.json()) as BackendEntitlements;
  return adaptEntitlements(raw);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ toolId: string }> },
): Promise<NextResponse> {
  const { toolId } = await params;

  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { reason: 'UNAUTHORIZED', message: 'Session requise.' },
      { status: 401 },
    );
  }

  const orgId = request.nextUrl.searchParams.get('orgId');
  if (!orgId) {
    return NextResponse.json(
      { reason: 'SERVER_ERROR', message: 'Paramètre orgId requis.' },
      { status: 400 },
    );
  }

  const engineId = engineIdForSoftware(toolId);
  if (!engineId) {
    return NextResponse.json(
      { reason: 'NOT_FOUND', message: 'Outil inconnu.' },
      { status: 404 },
    );
  }

  let entitlements: EntitlementsResponse;
  try {
    entitlements = await fetchEntitlements(token, orgId);
  } catch {
    return NextResponse.json(
      { reason: 'UNAUTHORIZED', message: 'Session invalide ou expirée.' },
      { status: 401 },
    );
  }

  const gate = evaluateGate(entitlements, engineId);
  if (!gate.allowed) {
    return NextResponse.json(
      { reason: 'MODULE_NOT_IN_PACK', message: gate.message ?? 'Module non inclus.' },
      { status: 403 },
    );
  }

  let html: string;
  try {
    html = await readFile(path.join(CLONES_DIR, `${toolId}.html`), 'utf8');
  } catch {
    return NextResponse.json(
      { reason: 'NOT_FOUND', message: 'Clone indisponible pour cet outil.' },
      { status: 404 },
    );
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CLONE_CSP,
      'Cache-Control': 'no-store',
    },
  });
}
