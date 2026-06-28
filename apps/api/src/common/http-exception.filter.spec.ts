import type { ArgumentsHost } from '@nestjs/common';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';

import {
  AllExceptionsFilter,
  type ApiErrorBody,
} from './http-exception.filter';
import type { TracedRequest } from './trace';

/**
 * Densification B — AllExceptionsFilter.
 *
 * On teste la PROJECTION d'erreur reelle : ZodError -> 400 ne contenant QUE
 * {path, code} ; HttpException -> statut + libelle + traceId ; erreur inconnue
 * -> 500 generique SANS fuite de stack/secret. detailsFrom normalise a
 * {path, code} (pas de pass-through du payload amont).
 */
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;

  /** Capture le corps JSON renvoye. */
  function captured(): ApiErrorBody {
    const calls = json.mock.calls as unknown as ApiErrorBody[][];
    return calls[0][0];
  }

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    const req = { traceId: 'trace-123' } as TracedRequest;
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => req,
      }),
    } as unknown as ArgumentsHost;
    // On fait taire le logger pour ne pas polluer la sortie de test, sans
    // alterer le comportement teste.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('given une ZodError', () => {
    it("renvoie 400 et n'expose QUE {path, code} (jamais la valeur recue)", () => {
      const err = new ZodError([
        {
          code: 'invalid_type',
          path: ['profondeur'],
          message: 'attendu un nombre',
          expected: 'number',
          received: 'string',
        } as never,
      ]);

      filter.catch(err, host);

      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      const body = captured();
      expect(body.statusCode).toBe(400);
      expect(body.traceId).toBe('trace-123');
      expect(body.details).toEqual([
        { path: 'profondeur', code: 'invalid_type' },
      ]);
      // Anti-fuite : ni la valeur recue ni le message Zod ne doivent sortir.
      const detail = (body.details as Array<Record<string, unknown>>)[0];
      expect(detail).not.toHaveProperty('message');
      expect(detail).not.toHaveProperty('received');
    });
  });

  describe('given une HttpException Nest', () => {
    it('reprend le statut, le libelle stable et le traceId', () => {
      filter.catch(new ForbiddenException('Acces refuse'), host);

      const body = captured();
      expect(body.statusCode).toBe(HttpStatus.FORBIDDEN);
      expect(body.error).toBe('Forbidden');
      expect(body.message).toBe('Acces refuse');
      expect(body.traceId).toBe('trace-123');
    });

    it('normalise des issues maison a {path, code} (pas de pass-through du payload)', () => {
      // HttpException dont le payload porte des issues "riches" (valeur, message).
      const ex = new HttpException(
        {
          message: 'Entree invalide',
          issues: [
            {
              path: ['a', 'b'],
              code: 'too_small',
              message: 'verbeux',
              value: 'SECRET_LEAK',
            },
          ],
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(ex, host);

      const body = captured();
      const details = body.details as Array<Record<string, unknown>>;
      expect(details).toEqual([{ path: 'a.b', code: 'too_small' }]);
      // Le filtre ne propage QUE path+code, pas les champs sensibles amont.
      expect(JSON.stringify(body)).not.toContain('SECRET_LEAK');
      expect(JSON.stringify(body)).not.toContain('verbeux');
    });
  });

  describe('given une erreur inconnue', () => {
    it('renvoie 500 generique SANS fuite de stack/message interne', () => {
      const leaky = new Error('connexion postgres user=admin password=hunter2');
      filter.catch(leaky, host);

      const body = captured();
      expect(body.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toBe('Erreur interne');
      // Le secret ne doit jamais atteindre le client.
      expect(JSON.stringify(body)).not.toContain('hunter2');
      expect(JSON.stringify(body)).not.toContain('postgres');
      expect(body).not.toHaveProperty('stack');
    });

    it("utilise traceId=unknown si le middleware n'a pas pose de traceId", () => {
      const req = {} as TracedRequest;
      const hostNoTrace = {
        switchToHttp: () => ({
          getResponse: () => ({ status }),
          getRequest: () => req,
        }),
      } as unknown as ArgumentsHost;

      filter.catch(new Error('x'), hostNoTrace);
      expect(captured().traceId).toBe('unknown');
    });
  });
});
