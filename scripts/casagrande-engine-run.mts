/**
 * Helper de test (qa-test) — exécute le MOTEUR SOURCE pieux (CASAGRANDE, calcul de
 * fondations profondes NF P 94-262 / Eurocode 7) sur l'entrée reçue en stdin
 * (JSON = input moteur PUR que le clone poste au serveur, forme `buildPieuxInput`)
 * et écrit sur stdout `{ ok, output }` (sortie whitelistée du contrat, PieuxOutput).
 *
 * POURQUOI en sous-processus : c'est la façon d'obtenir la « sortie serveur » du
 * cas SANS importer le moteur (confidentiel, DoD §8) dans le bundle du spec
 * Playwright / du navigateur. Le processus tourne côté Node uniquement (comme le
 * ferait le serveur), via la SOURCE `.ts` (`tsx`). L'équivalence module↔origine du
 * moteur est prouvée par ailleurs (`packages/engines/src/pieux/*.equivalence.test.ts`
 * et `clone-render.test.ts`) : cette sortie est donc numériquement celle que
 * renverrait l'API serveur pour la même entrée. La spec e2e INTERCEPTE la requête de
 * calcul du clone et fulfille avec cette sortie (input = ce que le VRAI clone a
 * construit ; output = ce que le VRAI moteur renvoie) — chemin fidèle de bout en
 * bout, calcul jamais dans le navigateur.
 *
 * Note pieux (leçon Terzaghi) : `runPieux` renvoie TOUJOURS `ok:true` et encode les
 * erreurs de garde/saisie dans `output.erreur`. On propage `ok:false` uniquement si
 * l'enveloppe elle-même est en échec ; l'erreur en bande reste dans `output` (le
 * clone la gère via sa garde §5). La sortie « vide » (output falsy) est un échec dur.
 *
 * Usage : echo '<input JSON>' | npx tsx scripts/casagrande-engine-run.mts
 */
import { runPieux } from '../packages/engines/src/pieux/index.ts';

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
  const env = runPieux(input);
  if (!env.ok) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: 'runPieux ok=false', envelope: env }),
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
