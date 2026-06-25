import { timingSafeEqual } from 'node:crypto';

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';

import { RECETTE_KEY_HEADER, getRecetteApiKey } from './recette.config';

/**
 * RecetteAccessGuard — barriere de PERIMETRE de l'environnement de RECETTE.
 *
 * Decision titulaire : l'acces a la recette se fait par CLE D'API partagee. Ce
 * guard est une porte EXTERNE, INDEPENDANTE de l'auth JWT/tenant : il s'applique
 * a TOUTES les routes (/auth/login, /calc/*...), car la recette entiere est
 * fermee tant qu'on ne presente pas la cle.
 *
 * --- EXEMPTION : la sonde de sante ---
 * `/v1/health` est EXEMPTE : c'est l'endpoint que l'hebergeur (Render) interroge
 * pour savoir si l'instance est vivante — il n'envoie pas d'en-tete applicatif.
 * S'il etait protege, la sonde recevrait 401 et le service serait marque
 * « unhealthy ». /health ne renvoie que { status, env, science } (aucune donnee
 * sensible), donc l'ouvrir est sans risque de confidentialite.
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
/** Chemins toujours ouverts (sonde de sante de l'hebergeur). */
const EXEMPT_PATHS: readonly string[] = ['/v1/health', '/health'];

@Injectable()
export class RecetteAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = getRecetteApiKey();
    // Guard inerte : aucune cle configuree -> on ne ferme pas la recette.
    if (expected === null) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      url?: string;
      originalUrl?: string;
    }>();
    // Exemption sonde de sante : on isole le PATH (sans query string) et on le
    // compare aux chemins ouverts. Render interroge /v1/health sans en-tete.
    const rawPath = req.originalUrl ?? req.url ?? '';
    const path = rawPath.split('?')[0]?.replace(/\/+$/, '') || '/';
    if (EXEMPT_PATHS.includes(path)) return true;

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
