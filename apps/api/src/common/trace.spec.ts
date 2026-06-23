import type { NextFunction, Response } from 'express';

import {
  TRACE_ID_HEADER,
  TraceIdMiddleware,
  type TracedRequest,
} from './trace';

/**
 * Densification B — TraceIdMiddleware.
 *
 * Genere un uuid ; respecte un x-trace-id conforme ; REJETTE un id non conforme
 * (espaces, CRLF, longueur) et en regenere un propre. La regeneration est la
 * defense contre la log-injection et ERR_INVALID_CHAR au setHeader.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('TraceIdMiddleware', () => {
  let mw: TraceIdMiddleware;
  let setHeader: jest.Mock;
  let next: NextFunction;

  function run(incoming?: string): TracedRequest {
    const req = {
      headers: incoming === undefined ? {} : { [TRACE_ID_HEADER]: incoming },
    } as unknown as TracedRequest;
    const res = { setHeader } as unknown as Response;
    mw.use(req, res, next);
    return req;
  }

  beforeEach(() => {
    mw = new TraceIdMiddleware();
    setHeader = jest.fn();
    next = jest.fn();
  });

  describe('given aucun x-trace-id entrant', () => {
    it("genere un uuid, le pose sur req ET sur l'en-tete de reponse, puis next()", () => {
      const req = run();
      expect(req.traceId).toMatch(UUID_RE);
      expect(setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, req.traceId);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('given un x-trace-id conforme', () => {
    it('le respecte tel quel (correlation de bout en bout)', () => {
      const req = run('req-2026-06-22_abc.DEF-123');
      expect(req.traceId).toBe('req-2026-06-22_abc.DEF-123');
      expect(setHeader).toHaveBeenCalledWith(
        TRACE_ID_HEADER,
        'req-2026-06-22_abc.DEF-123',
      );
    });
  });

  describe('given un x-trace-id non conforme', () => {
    it('rejette un id contenant des espaces -> uuid regenere', () => {
      const req = run('avec espace');
      expect(req.traceId).not.toBe('avec espace');
      expect(req.traceId).toMatch(UUID_RE);
    });

    it('rejette un id contenant un CRLF (anti log-injection) -> uuid regenere', () => {
      const req = run('ok\r\nSet-Cookie: evil=1');
      expect(req.traceId).toMatch(UUID_RE);
    });

    it('rejette un id trop long (>128) -> uuid regenere', () => {
      const req = run('a'.repeat(129));
      expect(req.traceId).toMatch(UUID_RE);
    });

    it('rejette une valeur tableau (en-tete duplique) -> uuid regenere', () => {
      const req = {
        headers: { [TRACE_ID_HEADER]: ['x', 'y'] },
      } as unknown as TracedRequest;
      mw.use(req, { setHeader } as unknown as Response, next);
      expect(req.traceId).toMatch(UUID_RE);
    });
  });
});
