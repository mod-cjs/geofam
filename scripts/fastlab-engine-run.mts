/**
 * Helper de test (qa-test) — exécute le MOTEUR SOURCE FASTLAB (essais de laboratoire
 * & classification GTR, NF P 11-300) sur l'entrée reçue en stdin (JSON = ÉTAT du
 * formulaire que le clone poste au serveur, forme `readForm()` + `cfg`) et écrit sur
 * stdout `{ ok, output }` (sortie whitelistée du contrat, LaboOutputSchema).
 *
 * POURQUOI en sous-processus : c'est la façon d'obtenir la « sortie serveur » du cas
 * SANS importer le moteur (confidentiel, DoD §8) dans le bundle du spec Playwright /
 * du navigateur. Le processus tourne côté Node uniquement (comme le ferait le
 * serveur), via la SOURCE `.ts` (`tsx`). L'équivalence module↔origine de FASTLAB est
 * prouvée par ailleurs (`packages/engines/src/labo/*.test.ts` : clone-render,
 * equivalence, detail-equivalence) : cette sortie est donc numériquement celle que
 * renverrait l'API serveur pour le même état.
 *
 * PARTICULARITÉ FASTLAB (vs terzaghi/pressiopro) : le clone poste l'ÉTAT COMPLET du
 * formulaire (`readForm()` = ~20 essais dans un seul objet) et le serveur renvoie
 * TOUTES les valeurs dérivées (`output.detail.*` + agrégats + `classe` GTR). Le POST
 * est BATCHÉ (un seul appel `/calc/labo`). Le module PUR `runLabo` reproduit `recalc()`
 * (même ordre d'appel des kernels : CBR lit `D.rdmax`/`D.wopn` produits par Proctor).
 * Aucun polyfill `structuredClone` requis ici : ce besoin ne concerne QUE le chargement
 * du HTML d'origine sous jsdom ; le module TS extrait n'appelle pas `structuredClone`.
 *
 * Usage : echo '<state JSON>' | npx tsx scripts/fastlab-engine-run.mts
 */
import { runLabo } from '../packages/engines/src/labo/index.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: `stdin non-JSON: ${(e as Error).message}` }),
    );
    process.exit(2);
  }
  const env = runLabo(input as never);
  if (!env.ok) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: 'runLabo ok=false', envelope: env }),
    );
    return;
  }
  process.stdout.write(JSON.stringify({ ok: true, output: env.output }));
}

main().catch((e: unknown) => {
  process.stdout.write(
    JSON.stringify({ ok: false, error: (e as Error)?.message ?? String(e) }),
  );
  process.exit(1);
});
