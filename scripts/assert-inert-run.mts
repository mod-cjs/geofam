/**
 * Harnais tsx — passe un HTML (lu sur STDIN) dans la VRAIE garde §8 serveur
 * `assertInertHtml` (apps/api/src/pv/html-guard.ts), JAMAIS une copie. Utilisé par
 * le spec Playwright de scellement roadsens (DoD §8) pour prouver que le printHtml
 * RÉELLEMENT capturé par le clone passe la garde d'inertie/confidentialité.
 *
 * Sortie JSON sur STDOUT :
 *   { ok:true }                      -> HTML inerte et sans marqueur confidentiel.
 *   { ok:false, error:"<message>" }  -> refus (script/handler/javascript:/marqueur/taille).
 *
 * Le champ est fixé à 'printHtml' (message d'erreur borné, sans divulgation du HTML).
 */
import { assertInertHtml } from '../apps/api/src/pv/html-guard';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main(): Promise<void> {
  const html = await readStdin();
  try {
    assertInertHtml(html, 'printHtml');
    process.stdout.write(JSON.stringify({ ok: true }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
  }
}

void main();
