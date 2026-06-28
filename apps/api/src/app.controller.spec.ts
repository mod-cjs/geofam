import { Test, TestingModule } from '@nestjs/testing';

import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('landing (racine /)', () => {
    it('renvoie une page HTML d orientation vers /docs (pas le stub par defaut)', () => {
      const html = appController.landing();
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('/docs');
      expect(html).toContain('ROADSEN');
      // Plus le stub NestJS « Hello World ».
      expect(html).not.toContain('Hello World');
    });

    it('affiche la banniere recette quand l environnement est @science-unsigned', () => {
      const saved = process.env.ROADSEN_SCIENCE_SIGNED;
      delete process.env.ROADSEN_SCIENCE_SIGNED; // defaut = unsigned
      try {
        expect(appController.landing()).toContain('RECETTE');
      } finally {
        if (saved === undefined) delete process.env.ROADSEN_SCIENCE_SIGNED;
        else process.env.ROADSEN_SCIENCE_SIGNED = saved;
      }
    });
  });
});
