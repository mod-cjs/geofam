'use client';

/**
 * Accueil GEOFAM — galerie des logiciels géotechniques.
 * L'utilisateur choisit un logiciel et y entre. Chaque logiciel a sa
 * pastille-logo (accent propre) ; statut « live » (front disponible) ou
 * « bientôt » (moteur intégré côté serveur, interface à venir).
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Logiciel {
  id: string;
  nom: string;
  tagline: string;
  domaine: string;
  accent: string;
  status: 'live' | 'soon';
}

const LOGICIELS: Logiciel[] = [
  { id: 'roadsens', nom: 'ROADSENS', tagline: 'Dimensionnement des chaussées', domaine: 'Burmister · AGEROUTE 2015', accent: '#1b3a5b', status: 'live' },
  { id: 'terzaghi', nom: 'Terzaghi', tagline: 'Fondations superficielles', domaine: 'NF P 94-261 / Eurocode 7', accent: '#a65a1e', status: 'live' },
  { id: 'casagrande', nom: 'CASAGRANDE', tagline: 'Fondations profondes — pieux', domaine: 'NF P 94-262 / Eurocode 7', accent: '#1f4e4a', status: 'live' },
  { id: 'geoplaque', nom: 'GEOPLAQUE', tagline: 'Radier & plaque', domaine: 'Éléments finis · EC7 annexe H', accent: '#5a3e7c', status: 'live' },
  { id: 'pressiopro', nom: 'PressioPro', tagline: 'Essai pressiométrique', domaine: 'Pressiomètre Ménard', accent: '#963b28', status: 'soon' },
  { id: 'fastlab', nom: 'FASTLAB', tagline: 'Classification laboratoire', domaine: 'GTR · œdomètre', accent: '#6b7a2e', status: 'soon' },
];

export default function LogicielsGallery() {
  const params = useParams<{ orgSlug: string }>();
  const orgSlug = params?.orgSlug ?? '';

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px 56px' }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary, #6b7178)' }}>Suite géotechnique</div>
        <h1 style={{ fontSize: 24, margin: '4px 0 6px', color: 'var(--text-primary, #16212e)' }}>GEOFAM</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary, #6b7178)', margin: 0, maxWidth: 620 }}>
          Choisissez un logiciel pour lancer un calcul et produire un PV scellé. Chaque module reprend fidèlement l&apos;outil de calcul, avec exécution côté serveur.
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {LOGICIELS.map((l) => {
          const inner = (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 12 }}>
                <div aria-hidden="true" style={{
                  width: 46, height: 46, borderRadius: 12, flex: 'none', display: 'grid', placeItems: 'center',
                  color: '#fff', fontWeight: 800, fontSize: 19, letterSpacing: 0.5,
                  background: `linear-gradient(150deg, ${l.accent}, ${shade(l.accent)})`,
                  boxShadow: `0 6px 16px -8px ${l.accent}`,
                }}>{l.nom[0]}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #16212e)' }}>{l.nom}</span>
                    <span style={{
                      fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20,
                      background: l.status === 'live' ? '#e4efe6' : '#efece3',
                      color: l.status === 'live' ? '#2e7d4f' : '#8a8474',
                    }}>{l.status === 'live' ? 'Disponible' : 'Bientôt'}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary, #6b7178)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.tagline}</div>
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #6b7178)', borderTop: '1px solid var(--border-tertiary, #e6eaef)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{l.domaine}</span>
                {l.status === 'live' && <span style={{ color: l.accent, fontWeight: 700 }}>Ouvrir →</span>}
              </div>
            </>
          );
          const cardStyle: React.CSSProperties = {
            display: 'block', background: 'var(--surface-panel, #fff)', border: '1px solid var(--border-tertiary, #e6eaef)',
            borderRadius: 14, padding: '16px 18px', textDecoration: 'none',
            opacity: l.status === 'soon' ? 0.72 : 1,
            cursor: l.status === 'soon' ? 'default' : 'pointer',
            boxShadow: '0 1px 2px rgba(22,33,46,.04)',
          };
          return l.status === 'live' ? (
            <Link key={l.id} href={`/app/${orgSlug}/logiciels/${l.id}`} style={cardStyle} className="geofam-card">{inner}</Link>
          ) : (
            <div key={l.id} style={cardStyle} aria-disabled="true">{inner}</div>
          );
        })}
      </div>

      <style>{`.geofam-card{transition:box-shadow .15s,transform .15s}.geofam-card:hover{box-shadow:0 10px 28px -14px rgba(22,33,46,.28);transform:translateY(-1px)}`}</style>
    </div>
  );
}

/** Assombrit une couleur hex pour le dégradé de la pastille. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40);
  const g = Math.max(0, ((n >> 8) & 255) - 40);
  const b = Math.max(0, (n & 255) - 40);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
