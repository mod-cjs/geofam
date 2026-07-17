/**
 * Helper de test (qa-test) — exécute le MOTEUR SOURCE burmister (chaussées,
 * AGEROUTE 2015) sur l'entrée reçue en stdin (JSON = BurmisterInput) et écrit sur
 * stdout `{ ok, output }` (sortie whitelistée du contrat, BurmisterOutputSchema).
 *
 * POURQUOI en sous-processus : c'est la façon d'obtenir la « sortie serveur » de
 * référence du cas de validation SANS importer le moteur (confidentiel, DoD §8)
 * dans le bundle du spec Playwright / du navigateur. Le processus tourne côté
 * Node uniquement (comme le ferait le serveur), via la SOURCE `.ts` (`tsx`).
 * L'équivalence module↔origine du moteur est prouvée par ailleurs
 * (`engine.equivalence.test.ts`, tol rel 1e-9) : cette sortie est donc
 * numériquement celle que renverrait l'API serveur pour le même cas. Le clone
 * (`buildDFromOutput`) la consomme comme le fait `ToolFrame` en production.
 *
 * Usage : echo '<BurmisterInput JSON>' | npx tsx scripts/burmister-engine-run.mts
 */
import { runBurmister } from '../packages/engines/src/burmister/index.ts';

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
  const env = runBurmister(input as never);
  if (!env.ok) {
    process.stdout.write(
      JSON.stringify({ ok: false, error: 'runBurmister ok=false', envelope: env }),
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
