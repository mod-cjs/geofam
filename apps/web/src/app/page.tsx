/**
 * Landing publique GEOFAM (`/`).
 *
 * Servie aux visiteurs NON authentifiés (middleware.ts laisse passer `/` quand
 * le cookie d'accès est absent/invalide — cf. commentaire du middleware).
 * Un visiteur déjà authentifié n'atteint jamais ce composant : le middleware
 * le redirige directement vers `/app/[orgSlug]/projets` avant que Next ne
 * rende cette page (comportement identique en mode réel et en mode mock).
 *
 * Design system existant uniquement (tokens globals.css, Button/Card/Logotype/
 * DomainTag) — aucune palette parallèle. Un seul token nouveau : --marketing-navy
 * (fond du hero + de la nav transparente), contraste vérifié ≥ 4,5:1 (cf. rapport
 * de mission — ~11,6:1 avec du texte blanc, largement AAA).
 *
 * Aucun import @roadsen/engines — page 100% vitrine, aucun calcul.
 */

import type { Metadata } from 'next';
import Image from 'next/image';
import {
  Building2,
  Mail,
  MessageCircle,
  PlaySquare,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { DomainTag } from '@/components/ui/DomainTag';
import { Logotype } from '@/components/ui/Logotype';
import { SOFTWARE_CATALOG } from '@/lib/software-catalog';

import { LandingNav } from './LandingNav';
import {
  ESSAI_GRATUIT_HREF,
  SUPPORT_EMAIL,
  WHATSAPP_HREF,
  YOUTUBE_HREF,
  domainForSoftware,
} from './landing-constants';

export const metadata: Metadata = {
  title: 'GEOFAM — Logiciels de géotechnique, calcul routier & fondations',
  description:
    "GEOFAM réunit les 6 logiciels de calcul géotechnique et routier que vous utilisez déjà (chaussées, fondations superficielles et profondes, radier, pressiomètre, laboratoire), recalculés côté serveur et scellés à chaque procès-verbal.",
};

const REASSURANCE_ITEMS: { icon: typeof ShieldCheck; label: string }[] = [
  { icon: ShieldCheck, label: 'Un PV impossible à modifier après coup' },
  { icon: Building2, label: 'Vos données restent les vôtres' },
  { icon: Smartphone, label: "S'installe comme une application, sur PC ou téléphone" },
];

const DIFFERENTIATEURS: { titre: string; texte: string }[] = [
  {
    titre: 'Le même outil, sur le web',
    texte:
      "Chaque logiciel reprend l'interface et la logique de l'outil de calcul que vous utilisez déjà — pas de réapprentissage.",
  },
  {
    titre: "Un PV qu'on ne peut pas trafiquer",
    texte:
      "Le calcul ne se fait jamais dans votre navigateur : impossible de modifier un résultat avant de l'imprimer. Chaque PV est numéroté, horodaté et régénérable à tout moment si vous le perdez.",
  },
  {
    titre: 'Vos données restent les vôtres',
    texte:
      "Un autre bureau d'études sur la plateforme ne voit jamais vos projets, vos clients ni vos calculs.",
  },
  {
    titre: 'Installable comme un vrai logiciel',
    texte:
      "S'installe sur votre ordinateur ou votre téléphone en une icône — plus besoin de retrouver l'adresse à chaque fois.",
  },
];

const ETAPES: { numero: string; titre: string; texte: string }[] = [
  {
    numero: '1',
    titre: 'Choisissez un logiciel',
    texte: 'ROADSENS, Terzaghi, CASAGRANDE, GEOPLAQUE, PressioPro ou FASTLAB.',
  },
  {
    numero: '2',
    titre: 'Renseignez vos paramètres',
    texte: 'Les mêmes champs que dans le logiciel que vous connaissez déjà.',
  },
  {
    numero: '3',
    titre: 'Recevez un PV scellé',
    texte: 'Un PV scellé et numéroté, prêt à joindre à votre rapport.',
  },
];

const FORMULES: {
  nom: string;
  prix: string;
  description: string;
  miseEnAvant?: boolean;
  cta: { label: string; href: string; external?: boolean };
}[] = [
  {
    nom: 'Mensuel',
    prix: '32 800 FCFA / mois',
    description: 'Accès aux 6 logiciels sur un poste. Renouvelé chaque mois ; vous arrêtez quand vous voulez.',
    cta: { label: 'Demander un essai', href: WHATSAPP_HREF, external: true },
  },
  {
    nom: 'Annuel',
    prix: '196 800 FCFA / an',
    description:
      'Accès aux 6 logiciels sur un poste, pour un an — 16 400 FCFA/mois en moyenne, deux fois moins cher que la formule mensuelle.',
    miseEnAvant: true,
    cta: { label: 'Demander un essai', href: WHATSAPP_HREF, external: true },
  },
  {
    nom: 'À vie',
    prix: '1 968 000 FCFA',
    description: 'Licence permanente, jusqu’à 5 postes — idéale pour un bureau d’études.',
    cta: { label: 'Nous contacter', href: '#contact' },
  },
  {
    nom: 'Bureau — multi-postes',
    prix: 'Sur devis',
    description:
      "Au-delà de 5 postes pour un même bureau d'études : tarif adapté à votre effectif, sur devis.",
    cta: { label: 'Nous contacter', href: '#contact' },
  },
];

export default function Home() {
  return (
    <>
      <a href="#contenu" className="landing-skip-link">
        Aller au contenu principal
      </a>

      <LandingNav />

      <main id="contenu">
        {/* ------------------------------------------------------------ */}
        {/* Hero */}
        {/* ------------------------------------------------------------ */}
        <section
          style={{
            background: 'var(--marketing-navy)',
            padding: '56px 20px 64px',
          }}
        >
          <div
            style={{
              maxWidth: 1180,
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr)',
              gap: 40,
              alignItems: 'center',
            }}
            className="landing-hero-grid"
          >
            <div>
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--accent-action-on-nav)',
                  marginBottom: 16,
                }}
              >
                Pour les bureaux d&apos;études — Sénégal &amp; Afrique de l&apos;Ouest
              </p>
              <h1
                style={{
                  fontSize: 'clamp(32px, 4.4vw, 56px)',
                  lineHeight: 1.12,
                  fontWeight: 600,
                  color: '#ffffff',
                  margin: '0 0 20px',
                  maxWidth: 720,
                }}
              >
                Les mêmes logiciels de calcul géotechnique et routier que vous utilisez déjà
                — désormais sur le web, avec un PV inaltérable à chaque résultat.
              </h1>
              <p
                style={{
                  fontSize: 'var(--text-base)',
                  lineHeight: 1.6,
                  color: 'rgba(255,255,255,0.82)',
                  margin: '0 0 32px',
                  maxWidth: 620,
                }}
              >
                ROADSENS (chaussées, AGEROUTE 2015), Terzaghi (fondations superficielles, NF
                P 94-261), CASAGRANDE (pieux, NF P 94-262), GEOPLAQUE (radier), PressioPro
                (pressiomètre Ménard), FASTLAB (labo GTR) : les mêmes logiciels, avec un
                procès-verbal scellé et numéroté pour chaque calcul abouti.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <a
                  href={WHATSAPP_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Demander un accès d'essai par WhatsApp (ouvre WhatsApp dans un nouvel onglet)"
                  className="landing-cta landing-cta--action landing-cta--lg"
                >
                  <MessageCircle size={18} strokeWidth={1.5} aria-hidden="true" />
                  Demander un essai (WhatsApp)
                </a>
                <a href="#logiciels" className="landing-cta landing-cta--ghost-on-dark landing-cta--lg">
                  Découvrir les 6 logiciels
                </a>
              </div>
              <a href={ESSAI_GRATUIT_HREF} className="landing-hero-secondary-link">
                ou par e-mail
              </a>
            </div>

            {/* Logo GEOFAM — plaque claire obligatoire (JPEG à fond blanc) */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 'var(--radius-xl)',
                  padding: 28,
                  boxShadow: 'var(--elevation-float)',
                }}
              >
                <Image
                  src="/geofam.jpeg"
                  alt="GEOFAM — géotechnique, logiciels, formation, innovation"
                  width={220}
                  height={220}
                  priority
                  style={{ width: 200, height: 'auto', display: 'block' }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Les 6 logiciels — juste après le hero : répond en 5 s à            */}
        {/* « est-ce que ça couvre mon métier » */}
        {/* ------------------------------------------------------------ */}
        <section id="logiciels" style={{ padding: '72px 20px', scrollMarginTop: 64 }}>
          <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            <h2
              style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: '0 0 12px',
              }}
            >
              Les 6 logiciels
            </h2>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', margin: '0 0 32px', maxWidth: 640 }}>
              Chaque logiciel reprend fidèlement l&apos;outil que vous utilisez déjà — mêmes
              paramètres, mêmes formulaires, mêmes résultats.
            </p>
            <div className="landing-software-grid">
              {SOFTWARE_CATALOG.map((entry) => {
                const domain = domainForSoftware(entry);
                return (
                  <Card key={entry.id} padding="lg" className="landing-software-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {entry.nom}
                      </span>
                      {domain && <DomainTag domain={domain} size="compact" />}
                    </div>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 8px' }}>
                      {entry.tagline}
                    </p>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: 0 }}>
                      {entry.domaine}
                    </p>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Bandeau réassurance */}
        {/* ------------------------------------------------------------ */}
        <section style={{ background: 'var(--color-alt)', padding: '32px 20px' }}>
          <div
            style={{
              maxWidth: 1180,
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 20,
            }}
          >
            {REASSURANCE_ITEMS.map(({ icon: Icon, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Icon
                  size={20}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{ color: 'var(--marketing-navy)', flexShrink: 0 }}
                />
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
          <p
            style={{
              maxWidth: 1180,
              margin: '20px auto 0',
              paddingTop: 20,
              borderTop: '1px solid rgba(0,0,0,0.08)',
              fontSize: 'var(--text-sm)',
              color: 'var(--text-secondary)',
              textAlign: 'center',
            }}
          >
            Édité par STARFIRE Technology — moteurs de calcul conçus et validés par un
            ingénieur expert en géotechnique.
          </p>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Comment ça marche */}
        {/* ------------------------------------------------------------ */}
        <section style={{ padding: '72px 20px' }}>
          <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 32px' }}>
              Comment ça marche
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 24,
              }}
            >
              {ETAPES.map((e) => (
                <div key={e.numero} style={{ display: 'flex', gap: 14 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'var(--marketing-navy)',
                      color: '#ffffff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 600,
                    }}
                  >
                    {e.numero}
                  </span>
                  <div>
                    <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                      {e.titre}
                    </h3>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
                      {e.texte}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Pourquoi GEOFAM */}
        {/* ------------------------------------------------------------ */}
        <section id="pourquoi" style={{ background: 'var(--color-alt)', padding: '72px 20px', scrollMarginTop: 64 }}>
          <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 32px' }}>
              Pourquoi GEOFAM
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 24,
              }}
            >
              {DIFFERENTIATEURS.map((d) => (
                <div key={d.titre}>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px' }}>
                    {d.titre}
                  </h3>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.55 }}>
                    {d.texte}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Tarifs */}
        {/* ------------------------------------------------------------ */}
        <section id="tarifs" style={{ padding: '72px 20px', scrollMarginTop: 64 }}>
          <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
              Tarifs
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', margin: '0 0 32px' }}>
              Accès à la suite complète — les 6 logiciels. Essai sur demande, sans engagement.
            </p>
            <div className="landing-pricing-grid">
              {FORMULES.map((f) => (
                <Card
                  key={f.nom}
                  padding="lg"
                  style={
                    f.miseEnAvant
                      ? { boxShadow: '0 0 0 2px var(--marketing-navy), var(--elevation-float)' }
                      : undefined
                  }
                >
                  <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                    {f.nom}
                  </h3>
                  <p style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: 'var(--marketing-navy)', margin: '0 0 12px' }}>
                    {f.prix}
                  </p>
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 20px' }}>
                    {f.description}
                  </p>
                  <a
                    href={f.cta.href}
                    {...(f.cta.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    aria-label={f.cta.external ? `${f.cta.label} par WhatsApp (ouvre WhatsApp dans un nouvel onglet)` : undefined}
                    className={`landing-cta landing-cta--${f.miseEnAvant ? 'action' : 'secondary'}`}
                    style={{ width: '100%' }}
                  >
                    {f.cta.label}
                  </a>
                </Card>
              ))}
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 24 }}>
              Paiement sécurisé via PayTech (Wave, Orange Money, Free Money). Facturation en
              FCFA.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Contact */}
        {/* ------------------------------------------------------------ */}
        <section id="contact" style={{ background: 'var(--color-alt)', padding: '72px 20px', scrollMarginTop: 64 }}>
          <div style={{ maxWidth: 1180, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 20px' }}>
              Nous contacter
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Nous contacter par WhatsApp (ouvre WhatsApp dans un nouvel onglet)"
                className="landing-cta landing-cta--action"
              >
                <MessageCircle size={18} strokeWidth={1.5} aria-hidden="true" />
                WhatsApp
              </a>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                aria-label={`Nous écrire à ${SUPPORT_EMAIL}`}
                className="landing-cta landing-cta--secondary"
              >
                <Mail size={18} strokeWidth={1.5} aria-hidden="true" />
                {SUPPORT_EMAIL}
              </a>
            </div>
            <a
              href={YOUTUBE_HREF}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Voir nos tutoriels vidéo sur YouTube (ouvre YouTube dans un nouvel onglet)"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 20,
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
                textDecoration: 'underline',
              }}
            >
              <PlaySquare size={16} strokeWidth={1.5} aria-hidden="true" />
              Tutoriels vidéo sur YouTube
            </a>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Bandeau de clôture */}
        {/* ------------------------------------------------------------ */}
        <section style={{ background: 'var(--marketing-navy)', padding: '56px 20px', textAlign: 'center' }}>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, color: '#ffffff', margin: '0 0 20px' }}>
              Prêt à essayer GEOFAM sur vos propres calculs ?
            </h2>
            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Demander un accès d'essai par WhatsApp (ouvre WhatsApp dans un nouvel onglet)"
              className="landing-cta landing-cta--action landing-cta--lg"
            >
              <MessageCircle size={18} strokeWidth={1.5} aria-hidden="true" />
              Demander un essai (WhatsApp)
            </a>
          </div>
        </section>
      </main>

      {/* ------------------------------------------------------------ */}
      {/* Footer */}
      {/* ------------------------------------------------------------ */}
      <footer style={{ background: 'var(--surface-nav)', padding: '48px 20px 32px' }}>
        <div
          style={{
            maxWidth: 1180,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 32,
          }}
        >
          <div>
            <Logotype variant="full" />
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-on-nav)', marginTop: 16, maxWidth: 260 }}>
              Sénégal &amp; Afrique de l&apos;Ouest.
            </p>
          </div>

          <div>
            <p className="label-caps" style={{ color: 'var(--muted-on-nav)', marginBottom: 12 }}>
              Produit
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <li><a href="#logiciels" className="landing-footer-link">Logiciels</a></li>
              <li><a href="#tarifs" className="landing-footer-link">Tarifs</a></li>
              <li><a href="#pourquoi" className="landing-footer-link">Pourquoi GEOFAM</a></li>
            </ul>
          </div>

          <div>
            <p className="label-caps" style={{ color: 'var(--muted-on-nav)', marginBottom: 12 }}>
              Support
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <li>
                <a href={YOUTUBE_HREF} target="_blank" rel="noopener noreferrer" className="landing-footer-link">
                  Tutoriels
                </a>
              </li>
              <li><a href="#contact" className="landing-footer-link">Contact</a></li>
              <li>
                <a href={WHATSAPP_HREF} target="_blank" rel="noopener noreferrer" className="landing-footer-link">
                  WhatsApp
                </a>
              </li>
            </ul>
          </div>

          {/*
            Colonne « Légal » masquée volontairement : les pages Mentions
            légales / Confidentialité ne sont pas encore rédigées (à câbler
            après rédaction fiscal-juridique/CDP — cf. mission déclarations
            CDP / loi 2008-12). Un lien href="#" en prod serait un lien mort ;
            on préfère l'absence à la promesse non tenue.
          */}
        </div>

        <div
          style={{
            maxWidth: 1180,
            margin: '32px auto 0',
            paddingTop: 20,
            borderTop: '1px solid var(--border-nav)',
            fontSize: 'var(--text-xs)',
            color: 'var(--muted-on-nav)',
          }}
        >
          © 2026 STARFIRE Technology SAS
        </div>
      </footer>

      <style>{`
        .landing-skip-link {
          position: absolute;
          top: -40px;
          left: 8px;
          z-index: 100;
          background: var(--surface-base);
          color: var(--text-primary);
          padding: 8px 14px;
          border-radius: var(--radius-base);
          font-size: var(--text-sm);
          font-weight: 500;
          text-decoration: none;
        }
        .landing-skip-link:focus {
          top: 8px;
        }

        .landing-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 40px;
          padding: 0 20px;
          border-radius: var(--radius-base);
          font-weight: 500;
          font-size: var(--text-sm);
          text-decoration: none;
          white-space: nowrap;
          transition: background-color var(--dur-fast) var(--ease-state);
        }
        .landing-cta--lg { height: 44px; padding: 0 24px; font-size: var(--text-base); }

        .landing-cta--action { background: var(--accent-action); color: var(--accent-fg); }
        .landing-cta--action:hover { background: var(--accent-action-hover); }

        .landing-cta--secondary { background: transparent; color: var(--accent-action); box-shadow: inset 0 0 0 1px var(--accent-action); }
        .landing-cta--secondary:hover { background: rgba(160,82,38,0.06); }

        .landing-cta--action-on-dark { background: transparent; color: var(--accent-action-on-nav); box-shadow: inset 0 0 0 1px rgba(217,149,78,0.45); }
        .landing-cta--action-on-dark:hover { background: rgba(217,149,78,0.12); }

        .landing-cta--ghost-on-dark { background: transparent; color: var(--text-on-nav); box-shadow: inset 0 0 0 1px var(--border-nav); }
        .landing-cta--ghost-on-dark:hover { background: var(--nav-hover); }

        .landing-hero-secondary-link {
          display: inline-block;
          margin-top: 12px;
          font-size: var(--text-sm);
          color: rgba(255,255,255,0.72);
          text-decoration: underline;
        }
        .landing-hero-secondary-link:hover { color: #ffffff; }

        .landing-software-card { transition: box-shadow var(--dur-fast) var(--ease-state); }
        .landing-software-card:hover { box-shadow: var(--elevation-float); }

        .landing-software-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
        @media (min-width: 900px) {
          .landing-software-grid { grid-template-columns: repeat(3, 1fr); }
        }

        .landing-pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; }
        @media (min-width: 620px) {
          .landing-pricing-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 1100px) {
          .landing-pricing-grid { grid-template-columns: repeat(4, 1fr); }
        }

        .landing-footer-link { color: var(--muted-on-nav); font-size: var(--text-sm); text-decoration: none; }
        .landing-footer-link:hover { color: var(--text-on-nav); }

        @media (min-width: 900px) {
          .landing-hero-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 380px) !important; }
        }
      `}</style>
    </>
  );
}
