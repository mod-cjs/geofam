import { timingSafeEqual } from 'node:crypto';

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RECETTE_EXEMPT_KEY } from './recette-exempt.decorator';
import { RECETTE_KEY_HEADER, getRecetteApiKey } from './recette.config';

/**
 * RecetteAccessGuard — barriere de PERIMETRE de l'environnement de RECETTE.
 *
 * Decision titulaire : l'acces a la recette se fait par CLE D'API partagee. Ce
 * guard est une porte EXTERNE, INDEPENDANTE de l'auth JWT/tenant : il s'applique
 * a TOUTES les routes (/auth/login, /calc/*...), car la recette entiere est
 * fermee tant qu'on ne presente pas la cle.
 *
 * --- EXEMPTION : par DECORATEUR sur la ROUTE, pas par texte d'URL (#73) ---
 * L'exemption est portee par la metadonnee @RecetteExempt() posee sur les
 * handlers reellement publics au sens perimetre (la landing `GET /` et la sonde
 * `GET /v1/health`). On la lit via le Reflector sur la ROUTE REELLEMENT MATCHEE
 * (handler + classe). Consequence de securite : un endpoint NON decore — au
 * premier chef `/calc/*` — NE PEUT PAS etre exempte, quelle que soit la forme de
 * l'URL (dot-segments, %2f, double-encodage). Plus de comparaison de chaine
 * d'URL brute => plus de surface de contournement par manipulation de path.
 *
 * Pourquoi PAS d'exemption pour /docs : la doc Swagger (`/docs`, `/docs-json`,
 * assets `/docs/*`) est servie par un MIDDLEWARE Express (SwaggerModule.setup),
 * en AMONT de la chaine de gardes Nest — ce guard ne s'execute donc JAMAIS pour
 * ces routes (verifie empiriquement : canActivate n'est pas invoque pour /docs).
 * Toute exemption texte « /docs » serait du code MORT ET une surface inutile :
 * on l'a retiree. La doc reste accessible sans cle parce qu'elle ne passe pas par
 * le guard, pas parce qu'on l'exempte.
 *
 * --- Activation conditionnelle (fail-safe pour les e2e) ---
 * Le guard n'est ACTIF que si la variable d'env `RECETTE_API_KEY` est posee :
 *   - cle posee   -> exige l'en-tete `X-Recette-Key` == RECETTE_API_KEY, sinon 401 ;
 *   - cle ABSENTE -> guard INERTE (laisse passer). Les suites e2e existantes, qui
 *     ne posent pas d'en-tete recette, restent donc VERTES sans modification.
 *
 * --- Comparaison en TEMPS CONSTANT ---
 * On compare via crypto.timingSafeEqual pour ne pas fuiter la cle par un canal
 * temporel (une comparaison `===` court-circuite au premier octet different).
 * timingSafeEqual exige des buffers de MEME longueur : on egalise d'abord la
 * longueur (un mismatch de longueur est traite comme un echec, sans branche
 * dependante du contenu de la cle attendue).
 */
@Injectable()
export class RecetteAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = getRecetteApiKey();
    if (expected === null) {
      // FAIL-CLOSED hors dev/test. En local et en e2e (pas de cle posee), le guard reste
      // INERTE pour ne pas casser les suites. Mais un environnement DEPLOYE sans
      // RECETTE_API_KEY est une MISCONFIGURATION dangereuse : elle ouvrirait notamment les
      // endpoints moteurs @Public /calc/* en ORACLE PUBLIC (calcul confidentiel sans auth).
      // On refuse donc par defaut (meme logique fail-fast que le CORS en prod).
      const env = process.env.NODE_ENV ?? '';
      if (env === 'development' || env === 'test') return true;
      throw new UnauthorizedException(
        'Perimetre recette non configure (RECETTE_API_KEY absente hors developpement) — acces refuse (fail-closed).',
      );
    }

    // Exemption decidee sur la ROUTE MATCHEE (handler/classe), pas sur l'URL.
    // `/calc/*` n'est pas decore -> jamais exempte, quelle que soit l'URL.
    const exempt = this.reflector.getAllAndOverride<boolean>(
      RECETTE_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exempt) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = headerValue(req.headers[RECETTE_KEY_HEADER]);
    if (provided === null || !constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException(
        "Cle d'acces recette absente ou invalide",
      );
    }
    return true;
  }
}

/** Normalise un en-tete HTTP (possiblement multi-valeur) en une chaine ou null. */
function headerValue(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Egalite de chaines en temps constant. timingSafeEqual leve si les longueurs
 * different : on encode les deux cotes, et on FORCE la comparaison sur des
 * buffers de meme taille pour eviter une fuite de longueur de la cle attendue.
 * Une difference de longueur reste un echec (return false).
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Compare bb contre lui-meme (temps ~constant) puis renvoie false : on ne
    // court-circuite pas sur la longueur d'une maniere qui depende du SECRET.
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
