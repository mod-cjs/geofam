/**
 * Tests du scanner de non-determinisme.
 *
 * Prouve qu il ECHOUE pour la bonne raison : il doit detecter Date.now(),
 * Math.random(), new Date() sans argument, etc., et respecter l echappement
 * explicite `determinism-allow`. On ecrit des fichiers temporaires (pas de
 * dependance au code moteur reel).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanForNonDeterminism } from './determinism-scan.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'roadsen-det-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  writeFileSync(join(dir, name), content, 'utf8');
}

describe('scanForNonDeterminism', () => {
  it('repertoire vide / inexistant -> aucun hit (socle sans moteurs)', () => {
    expect(scanForNonDeterminism(join(dir, 'inexistant'))).toEqual([]);
    expect(scanForNonDeterminism(dir)).toEqual([]);
  });

  it('code pur -> aucun hit', () => {
    write('pur.ts', 'export const f = (x: number): number => x * 2;\n');
    expect(scanForNonDeterminism(dir)).toEqual([]);
  });

  it('detecte Date.now()', () => {
    write('bad.ts', 'export const t = Date.now();\n');
    const hits = scanForNonDeterminism(dir);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.patternId).toBe('Date.now');
  });

  it('detecte Math.random()', () => {
    write('bad.ts', 'export const r = Math.random();\n');
    expect(scanForNonDeterminism(dir).some((h) => h.patternId === 'Math.random')).toBe(
      true,
    );
  });

  it('detecte new Date() sans argument mais PAS new Date(2020,0,1)', () => {
    write('a.ts', 'export const a = new Date();\n');
    write('b.ts', 'export const b = new Date(2020, 0, 1);\n');
    const hits = scanForNonDeterminism(dir);
    expect(hits.some((h) => h.file.endsWith('a.ts'))).toBe(true);
    expect(hits.some((h) => h.file.endsWith('b.ts'))).toBe(false);
  });

  it('detecte process.env', () => {
    write('bad.ts', 'export const k = process.env.SECRET;\n');
    expect(scanForNonDeterminism(dir).some((h) => h.patternId === 'env-access')).toBe(
      true,
    );
  });

  it('respecte l echappement explicite determinism-allow', () => {
    write(
      'ok.ts',
      'export const t = Date.now(); // determinism-allow: horodatage de log non-calcul\n',
    );
    expect(scanForNonDeterminism(dir)).toEqual([]);
  });

  it('ignore les fichiers de test et le marqueur', () => {
    write('x.test.ts', 'const t = Date.now();\n');
    write('marker.ts', 'const t = Math.random();\n');
    expect(scanForNonDeterminism(dir)).toEqual([]);
  });
});
