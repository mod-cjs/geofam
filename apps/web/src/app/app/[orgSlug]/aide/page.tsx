/**
 * B-32 — Aide & support (item PRODUIT #3).
 * Raccourcis clavier + contact direct (WhatsApp, e-mail) + tutoriels vidéo +
 * FAQ en accordéon. Rendu dans le shell (sidebar + topbar via le layout d'org).
 */

import { MessageCircle, PlaySquare, Mail } from 'lucide-react';

import { CollapsiblePanel } from '@/components/ui/Card';
import { Kbd } from '@/components/ui/Kbd';

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '⌘K', label: 'Ouvrir la recherche / palette de commandes' },
  { keys: 'N', label: 'Nouveau calcul (dans un projet)' },
  { keys: 'D', label: 'Dupliquer le calcul sélectionné' },
  { keys: 'Ctrl + Entrée', label: 'Lancer le calcul' },
  { keys: 'E', label: 'Émettre un PV (résultat conforme)' },
];

const WHATSAPP_NUMBER = '221768745508';
const WHATSAPP_MESSAGE = "Bonjour, j'ai besoin d'aide sur GEOFAM";
const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;
const YOUTUBE_HREF = 'https://www.youtube.com/@GEOTECHNIQUE-c7h';
const SUPPORT_EMAIL = 'direction@geofam.tech';

const FAQ: { question: string; reponse: string }[] = [
  {
    question: 'Comment lancer un calcul ?',
    reponse:
      "Ouvrez le logiciel concerné depuis l'accueil ou la galerie des logiciels, sélectionnez (ou créez) un projet, renseignez les paramètres puis lancez le calcul. Le calcul s'exécute côté serveur — le résultat s'affiche une fois terminé.",
  },
  {
    question: 'Comment émettre un PV scellé ?',
    reponse:
      "Une fois un calcul terminé avec un résultat exploitable, le bouton « Émettre le PV » devient disponible dans le logiciel. Le PV est recalculé et scellé côté serveur (horodatage, intégrité, numérotation) puis reste consultable et téléchargeable depuis l'onglet PV du projet.",
  },
  {
    question: 'Comment comprendre mon quota ?',
    reponse:
      'Le quota compte les calculs exécutés sur la période de votre abonnement (pas seulement les PV émis). Il est visible en permanence dans la barre du haut (N/M calculs · X %) et en détail sur le tableau de bord et la galerie des logiciels. Au-delà de la limite, contactez votre interlocuteur pour un renouvellement ou une extension.',
  },
  {
    question: 'Comment installer GEOFAM sur mobile ou sur ordinateur (PWA) ?',
    reponse:
      "Sur ordinateur (Chrome/Edge), utilisez l'icône d'installation dans la barre d'adresse, ou le menu du navigateur → « Installer l'application ». Sur mobile (Android/Chrome), menu → « Ajouter à l'écran d'accueil » ; sur iPhone/iPad (Safari), bouton Partager → « Sur l'écran d'accueil ». L'application s'ouvre alors en plein écran, comme une app native. Elle nécessite une connexion réseau pour calculer et émettre des PV — il n'y a pas de mode hors-ligne complet.",
  },
  {
    question: 'Quelle est la différence entre les 6 logiciels ?',
    reponse:
      "ROADSENS dimensionne les chaussées (Burmister/AGEROUTE). Terzaghi et CASAGRANDE couvrent les fondations, superficielles pour l'un, profondes (pieux) pour l'autre. GEOPLAQUE calcule radiers et plaques par éléments finis. PressioPro traite l'essai pressiométrique Ménard. FASTLAB couvre la classification de laboratoire (GTR). Chaque logiciel n'apparaît que s'il est inclus dans le pack de votre abonnement.",
  },
  {
    question: 'Que faire si un calcul échoue ?',
    reponse:
      "Vérifiez d'abord les valeurs saisies (unités, plages attendues) — le message d'erreur affiché précise la cause quand elle est connue. Si le calcul échoue sans raison apparente, ou de façon répétée, contactez le support (WhatsApp ou e-mail ci-dessus) en précisant le logiciel et le projet concernés.",
  },
  {
    question: 'Où retrouver mes projets et mes PV déjà émis ?',
    reponse:
      "Le tableau de bord (accueil) affiche les projets et PV les plus récents. Pour l'historique complet, ouvrez « Mes projets » puis le projet concerné : les onglets Calculs et PV y listent tout l'historique de ce projet.",
  },
  {
    question: 'Qui gère mon abonnement (pack, quota, échéance) ?',
    reponse:
      "Votre organisation et votre abonnement sont gérés par l'équipe GEOFAM. Pour une extension de pack, un renouvellement ou un accès supplémentaire, contactez votre interlocuteur habituel ou le support ci-dessus.",
  },
];

export default function AidePage() {
  return (
    <div style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
      <h1
        style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        Aide &amp; support
      </h1>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--text-sm)',
          marginBottom: 24,
        }}
      >
        Raccourcis, contact direct et réponses aux questions les plus fréquentes.
      </p>

      {/* Contact direct */}
      <section style={{ marginBottom: 28 }}>
        <h2
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 12,
          }}
        >
          Nous contacter
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contacter le support par WhatsApp (ouvre WhatsApp dans un nouvel onglet)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 40,
              padding: '0 18px',
              borderRadius: 'var(--radius-base)',
              background: '#25963f',
              color: '#fff',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <MessageCircle size={18} strokeWidth={1.5} aria-hidden="true" />
            Contacter sur WhatsApp
          </a>
          <a
            href={YOUTUBE_HREF}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Voir les tutoriels vidéo sur YouTube (ouvre YouTube dans un nouvel onglet)"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 40,
              padding: '0 18px',
              borderRadius: 'var(--radius-base)',
              background: 'transparent',
              color: 'var(--struct-petrole-text)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: 'inset 0 0 0 1px var(--struct-petrole-text)',
            }}
          >
            <PlaySquare size={18} strokeWidth={1.5} aria-hidden="true" />
            Tutoriels vidéo
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            aria-label={`Écrire à ${SUPPORT_EMAIL}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 40,
              padding: '0 18px',
              borderRadius: 'var(--radius-base)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              textDecoration: 'none',
              boxShadow: 'inset 0 0 0 1px var(--border-default)',
            }}
          >
            <Mail size={18} strokeWidth={1.5} aria-hidden="true" />
            {SUPPORT_EMAIL}
          </a>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ marginBottom: 28 }}>
        <h2
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 12,
          }}
        >
          Questions fréquentes
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FAQ.map((item) => (
            <CollapsiblePanel
              key={item.question}
              title={item.question}
              defaultOpen={false}
            >
              <p
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-secondary)',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {item.reponse}
              </p>
            </CollapsiblePanel>
          ))}
        </div>
      </section>

      {/* Raccourcis clavier */}
      <section style={{ marginBottom: 28 }}>
        <h2
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 12,
          }}
        >
          Raccourcis clavier
        </h2>
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                fontSize: 'var(--text-sm)',
                color: 'var(--text-secondary)',
              }}
            >
              <span style={{ minWidth: 120 }}>
                <Kbd>{s.keys}</Kbd>
              </span>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          paddingTop: 12,
        }}
      >
        GEOFAM — plateforme de calcul géotechnique &amp; routier.
      </footer>
    </div>
  );
}
