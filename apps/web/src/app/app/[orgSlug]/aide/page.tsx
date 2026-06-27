/**
 * B-32 — Aide (statique P1) : raccourcis clavier, support, version.
 * Rendu dans le shell (sidebar + topbar via le layout d'org).
 */

import { Kbd } from '@/components/ui/Kbd';

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '⌘K', label: 'Ouvrir la recherche / palette de commandes' },
  { keys: 'N', label: 'Nouveau calcul (dans un projet)' },
  { keys: 'D', label: 'Dupliquer le calcul sélectionné' },
  { keys: 'Ctrl + Entrée', label: 'Lancer le calcul' },
  { keys: 'E', label: 'Émettre un PV (résultat conforme)' },
];

export default function AidePage() {
  return (
    <div style={{ padding: 24, maxWidth: 760 }}>
      <h1
        style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 4,
        }}
      >
        Aide
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: 24 }}>
        Raccourcis et informations utiles. Pour toute question, contactez votre administrateur.
      </p>

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
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
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

      <section style={{ marginBottom: 28 }}>
        <h2
          style={{
            fontSize: 'var(--text-md)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}
        >
          Support
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
          Votre organisation et votre abonnement sont gérés par l'équipe ROADSEN. Pour une
          extension de pack, un renouvellement ou un accès supplémentaire, adressez votre demande à
          votre interlocuteur habituel.
        </p>
      </section>

      <footer
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          paddingTop: 12,
        }}
      >
        ROADSEN — plateforme de calcul géotechnique &amp; routier. Version de démonstration.
      </footer>
    </div>
  );
}
