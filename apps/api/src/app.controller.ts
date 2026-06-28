import { Controller, Get, Header } from '@nestjs/common';

import { Public } from './auth/decorators';
import { RecetteExempt } from './recette/recette-exempt.decorator';
import { getDeployEnv, getScienceStatus } from './recette/recette.config';

@Controller()
export class AppController {
  // Page d'accueil sobre (racine `/`). Ouverte (exemptee du guard recette via
  // @RecetteExempt, decide sur la ROUTE et non sur l'URL) : un visiteur arrive
  // sur une page d'orientation, pas sur un 401 sec ni le stub « Hello World » de
  // NestJS. Aucune donnee sensible : pointe vers /docs et rappelle l'etat de
  // recette (@science-unsigned). Le calcul reste ferme par cle.
  @Public()
  @RecetteExempt()
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  landing(): string {
    const env = getDeployEnv();
    const science = getScienceStatus();
    const banner =
      env === 'recette' || science === 'unsigned'
        ? '<p><strong>Environnement de RECETTE</strong> — justesse scientifique non validée ' +
          '(@science-unsigned). Ne pas utiliser en production.</p>'
        : '';
    return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ROADSEN — API de calcul géotechnique &amp; routier</title>
<style>
  body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
       max-width:42rem;margin:4rem auto;padding:0 1.25rem;color:#1a1a1a}
  h1{font-size:1.4rem;margin:0 0 .25rem} code{background:#f2f2f2;padding:.1em .35em;border-radius:4px}
  a{color:#0b5} .muted{color:#666;font-size:.9rem}
</style></head><body>
<h1>ROADSEN — API de calcul géotechnique &amp; routier</h1>
<p class="muted">Recalcul serveur des moteurs (chaussées &amp; fondations). Calcul confidentiel côté serveur.</p>
${banner}
<p>Documentation interactive de l'API : <a href="/docs">/docs</a></p>
<p>Les endpoints de calcul (<code>POST /calc/*</code>) requièrent une clé d'accès,
transmise dans l'en-tête <code>X-Recette-Key</code> (sur demande).</p>
<p class="muted">État du service : <a href="/v1/health">/v1/health</a></p>
</body></html>`;
  }
}
