import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';

import { assertInertHtml, MAX_HTML_BYTES } from './html-guard';

/**
 * GARDE §8 — spec unitaire (given/when/then). Chemins de REFUS testés autant que
 * le chemin heureux : un HTML inerte passe, tout HTML exécutable ou porteur d'un
 * marqueur confidentiel LÈVE (fail-closed). Sentinelles de non-régression :
 * supprimer une règle rend le cas correspondant ROUGE.
 */
describe('assertInertHtml (garde §8 — inertie + confidentialité)', () => {
  const DOC = "<div class='pv'><h1>Procès-verbal</h1><svg><rect/></svg></div>";

  describe('given un HTML inerte légitime', () => {
    it('when validé then ne lève pas', () => {
      expect(() => assertInertHtml(DOC, 'printHtml')).not.toThrow();
    });

    it('when un texte contient « onset » hors balise then ne lève pas (pas de faux positif)', () => {
      // « onset = 3 » est du TEXTE, pas un attribut de balise -> toléré.
      expect(() =>
        assertInertHtml('<p>onset = 3 mm au premier essai</p>', 'printHtml'),
      ).not.toThrow();
    });
  });

  describe('given un HTML exécutable', () => {
    it('when il contient <script> then lève 400', () => {
      expect(() =>
        assertInertHtml('<div><script>alert(1)</script></div>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    it('when il contient <SCRIPT> (casse mixte) then lève', () => {
      expect(() =>
        assertInertHtml('<SCRIPT src=x></SCRIPT>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    it('when une balise porte un gestionnaire onload= then lève', () => {
      expect(() =>
        assertInertHtml('<img src=x onload="steal()">', 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('when une balise porte onclick= then lève', () => {
      expect(() =>
        assertInertHtml('<button onclick="x()">go</button>', 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('when un href porte une URI javascript: then lève', () => {
      expect(() =>
        assertInertHtml('<a href="javascript:evil()">x</a>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    // --- M1 : contournements de la garde (bypass connus) --------------------

    it('when un handler est colle par « / » (<svg/onload=>) then lève', () => {
      // Les navigateurs acceptent « / » comme separateur d'attribut : sans [\s/]
      // avant « on… », ce vecteur passait.
      expect(() =>
        assertInertHtml('<svg/onload=alert(1)>', 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('when un handler onerror est colle par « / » (<img/onerror=>) then lève', () => {
      expect(() =>
        assertInertHtml('<img/onerror=alert(1)>', 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('when un attribut a un tiret apres on (on-… garde-fou) then lève', () => {
      expect(() =>
        assertInertHtml('<div onpointer-down=x()>y</div>', 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('when il contient une URI data: then lève', () => {
      expect(() =>
        assertInertHtml('<a href="data:text/html,<h1>x">y</a>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    it('when il contient un <iframe> then lève', () => {
      expect(() =>
        assertInertHtml('<iframe src="/x"></iframe>', 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('when il contient un <object>/<embed> then lève', () => {
      expect(() =>
        assertInertHtml('<object data="/x"></object>', 'printHtml'),
      ).toThrow(BadRequestException);
      expect(() => assertInertHtml('<embed src="/x">', 'printHtml')).toThrow(
        BadRequestException,
      );
    });

    it('when il contient un <foreignObject> (SVG->HTML) then lève', () => {
      expect(() =>
        assertInertHtml(
          '<svg><foreignObject>x</foreignObject></svg>',
          'printHtml',
        ),
      ).toThrow(BadRequestException);
    });

    it('when javascript: est obfusque par une entite (javascript&#58;) then lève', () => {
      expect(() =>
        assertInertHtml('<a href="javascript&#58;evil()">x</a>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    it('when le « j » de javascript est une entite (&#106;avascript:) then lève', () => {
      expect(() =>
        assertInertHtml(
          '<a href="&#106;avascript:evil()">x</a>',
          'displayHtml',
        ),
      ).toThrow(BadRequestException);
    });

    it('when data: est obfusque par une entite hex then lève', () => {
      expect(() =>
        assertInertHtml('<a href="&#x64;ata:text/html,x">y</a>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    // --- M2 : bypass 1 — `>` dans une valeur d'attribut guillemetée ----------
    // Le navigateur IGNORE ce `>` (il est dans la valeur) et parse un seul tag
    // ACTIF avec handler ; le regex `[^>]` naïf, lui, croyait le tag fermé à `a>`.

    it('when un handler onerror suit un `>` guillemeté (<img title="a>b" onerror=>) then lève', () => {
      // ROUGE avant fix (EVENT_HANDLER_RE `[^>]` s'arrête au `>` de "a>b"),
      // VERT après (test aussi sur la copie blanchie où le `>` factice disparaît).
      expect(() =>
        assertInertHtml('<img title="a>b" onerror="alert(1)">', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    it('when un handler onload suit un `>` guillemeté (<svg title="x>y" onload=>) then lève', () => {
      expect(() =>
        assertInertHtml(
          '<svg title="x>y" onload="steal()"></svg>',
          'printHtml',
        ),
      ).toThrow(BadRequestException);
    });

    it('when plusieurs `>` guillemetés précèdent le handler then lève', () => {
      expect(() =>
        assertInertHtml(
          '<div data-x="a>b>c" data-y="d>e" onmouseover="x()">z</div>',
          'printHtml',
        ),
      ).toThrow(BadRequestException);
    });

    // --- M3 : bypass 2 — blancs de contrôle À L'INTÉRIEUR du schéma d'URL ------
    // Le navigateur retire tab/CR/LF dans un schéma : `java\tscript:` = actif.

    it('when le schéma javascript est coupé par &Tab; (href="java&Tab;script:…") then lève', () => {
      expect(() =>
        assertInertHtml(
          '<a href="java&Tab;script:alert(1)">x</a>',
          'displayHtml',
        ),
      ).toThrow(BadRequestException);
    });

    it('when le schéma javascript est coupé par une TABULATION littérale then lève', () => {
      expect(() =>
        assertInertHtml('<a href="java\tscript:alert(1)">x</a>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    it('when le schéma javascript est coupé par &NewLine; then lève', () => {
      expect(() =>
        assertInertHtml(
          '<a href="java&NewLine;script:alert(1)">x</a>',
          'displayHtml',
        ),
      ).toThrow(BadRequestException);
    });

    it('when le schéma data: est coupé par un CR/LF littéral then lève', () => {
      expect(() =>
        assertInertHtml(
          '<a href="da\r\nta:text/html,<h1>x">y</a>',
          'displayHtml',
        ),
      ).toThrow(BadRequestException);
    });

    it('when le schéma data: est coupé par &Tab; then lève', () => {
      expect(() =>
        assertInertHtml('<a href="da&Tab;ta:text/html,x">y</a>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });

    it('when un schéma javascript: est dans un attribut NON guillemeté then lève', () => {
      expect(() =>
        assertInertHtml('<a href=javascript:alert(1)>x</a>', 'displayHtml'),
      ).toThrow(BadRequestException);
    });
  });

  describe('given un texte legitime proche des motifs interdits (anti faux-positif)', () => {
    it('when le texte contient « metadata: » then ne lève pas', () => {
      // « data: » precede d'une lettre (metadata) n'est PAS une URI -> tolere.
      expect(() =>
        assertInertHtml('<p>metadata: essai n°3</p>', 'printHtml'),
      ).not.toThrow();
    });

    it('when un TEXTE contient une entité fabriquant « data: » ((&#100;ata: 42)) then ne lève pas', () => {
      // Faux-positif du décodeur large : hors valeur d'attribut, un schéma décodé
      // n'est PAS navigable -> ne doit plus déclencher (bornage aux attributs).
      expect(() =>
        assertInertHtml(
          '<p>voir la note (&#100;ata: 42) ci-dessous</p>',
          'printHtml',
        ),
      ).not.toThrow();
    });

    it('when un attribut data-* et un href https normal then ne lève pas', () => {
      expect(() =>
        assertInertHtml(
          '<a data-ref="essai-3" href="https://exemple.sn/pv/42">lien</a>',
          'printHtml',
        ),
      ).not.toThrow();
    });

    it('when un attribut title contient un `>` légitime (sans handler) then ne lève pas', () => {
      // `>` dans une valeur guillemetée SANS `on…=` derrière = inerte.
      expect(() =>
        assertInertHtml(
          '<span title="σ > σadm à 50 %">alerte</span>',
          'printHtml',
        ),
      ).not.toThrow();
    });

    it('when un SVG de coupe inline légitime (path/rect/url(#R)) then ne lève pas', () => {
      expect(() =>
        assertInertHtml(
          '<svg viewBox="0 0 100 40"><rect fill="url(#R)" width="100" height="40"/><path d="M0 0 L100 40" stroke="#1a4a7a"/></svg>',
          'printHtml',
        ),
      ).not.toThrow();
    });

    it('when le style inline contient « background:url(#R) » et des « : » CSS then ne lève pas', () => {
      expect(() =>
        assertInertHtml(
          '<div style="color:#1a4a7a;background:url(#R);font-size:12px">x</div>',
          'printHtml',
        ),
      ).not.toThrow();
    });
  });

  describe('given le printHtml roadsens RÉEL capturé (non-régression cas légitime)', () => {
    it('when validé then ne lève pas', () => {
      const capturePath = join(
        __dirname,
        '../../../../docs/audits-fidelite/roadsens-capture-printhtml.html',
      );
      let html: string;
      try {
        html = readFileSync(capturePath, 'utf8');
      } catch {
        // Capture absente de l'environnement CI : on ne fabrique pas un faux-vert.
        throw new Error(
          `Capture de référence introuvable (${capturePath}) — test non exécutable.`,
        );
      }
      expect(html.length).toBeGreaterThan(1000);
      expect(() => assertInertHtml(html, 'printHtml')).not.toThrow();
    });
  });

  describe('given un HTML porteur d un marqueur/symbole confidentiel', () => {
    it('when il contient le marqueur moteur then lève', () => {
      expect(() =>
        assertInertHtml(
          '<p>__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__</p>',
          'printHtml',
        ),
      ).toThrow(BadRequestException);
    });

    it('when il contient le specifier @roadsen/engines then lève', () => {
      expect(() =>
        assertInertHtml("<p>import '@roadsen/engines'</p>", 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('when il contient un symbole moteur connu then lève', () => {
      expect(() =>
        assertInertHtml('<p>burIntegrateMLWithPSC()</p>', 'printHtml'),
      ).toThrow(BadRequestException);
    });

    it('then le message d erreur ne divulgue PAS le contenu fautif', () => {
      try {
        assertInertHtml('<p>burIntegrateMLWithPSC()</p>', 'printHtml');
        throw new Error('aurait dû lever');
      } catch (err) {
        const msg = (err as BadRequestException).message;
        expect(msg).not.toContain('burIntegrateMLWithPSC');
      }
    });
  });

  describe('given un HTML hors bornes', () => {
    it('when vide then lève', () => {
      expect(() => assertInertHtml('', 'printHtml')).toThrow(
        BadRequestException,
      );
    });

    it('when au-delà de la taille max then lève', () => {
      const big = '<p>' + 'a'.repeat(MAX_HTML_BYTES) + '</p>';
      expect(() => assertInertHtml(big, 'printHtml')).toThrow(
        BadRequestException,
      );
    });
  });
});
