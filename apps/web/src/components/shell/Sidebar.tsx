'use client';

/**
 * B-05 — Sidebar globale ROADSEN
 * Expanded 240px / Collapsed 64px
 * Responsive : drawer mobile < 1024px
 *
 * a11y : aside aria-label, nav, aria-current="page", aria-pressed collapse,
 *        skip-link cible #main, labels sr-only en collapsed, tooltips 250ms
 */

import {
  FolderOpen,
    Settings,
  HelpCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  LogOut,
  Menu,
  X,
  Route,
  Layers,
  LayoutGrid,
  Columns3,
  Grid3x3,
  Gauge,
  FlaskConical,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Logotype, StrataBar } from '@/components/ui/Logotype';
import { logout, getStoredUser, getStoredOrgs, getEntitlements } from '@/lib/api/client';
import { engineIdForSoftware } from '@/lib/software-catalog';
import { useOrgId } from '@/lib/org-context';
import type { OrgClaim } from '@/lib/api/types';

const SIDEBAR_STATE_KEY = 'sidebar-desktop-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
}

function useNavItems(orgSlug: string): NavItem[] {
  return [
    {
      id: 'accueil',
      label: 'Accueil — Logiciels',
      icon: <LayoutGrid size={20} strokeWidth={1.5} aria-hidden="true" />,
      href: `/app/${orgSlug}/logiciels`,
    },
    {
      id: 'projets',
      label: 'Mes projets',
      icon: <FolderOpen size={20} strokeWidth={1.5} aria-hidden="true" />,
      href: `/app/${orgSlug}/projets`,
    },
  ];
}

/** Items de navigation pour les logiciels (section dédiée). */
const ALL_LOGICIELS: NavItem[] = [
  { id: 'roadsens', label: 'ROADSENS — Chaussées', icon: <Route size={20} strokeWidth={1.5} aria-hidden="true" />, href: '/logiciels/roadsens' },
  { id: 'terzaghi', label: 'Terzaghi — Fondations superficielles', icon: <Layers size={20} strokeWidth={1.5} aria-hidden="true" />, href: '/logiciels/terzaghi' },
  { id: 'casagrande', label: 'CASAGRANDE — Pieux', icon: <Columns3 size={20} strokeWidth={1.5} aria-hidden="true" />, href: '/logiciels/casagrande' },
  { id: 'geoplaque', label: 'GEOPLAQUE — Radier', icon: <Grid3x3 size={20} strokeWidth={1.5} aria-hidden="true" />, href: '/logiciels/geoplaque' },
  { id: 'pressiopro', label: 'PressioPro — Pressiomètre', icon: <Gauge size={20} strokeWidth={1.5} aria-hidden="true" />, href: '/logiciels/pressiopro' },
  { id: 'fastlab', label: 'FASTLAB — Laboratoire', icon: <FlaskConical size={20} strokeWidth={1.5} aria-hidden="true" />, href: '/logiciels/fastlab' },
];

// La sidebar ne liste QUE les logiciels INCLUS dans le pack de l'org (entitlements).
// Un module hors pack n'apparait pas (fail-closed : tant que les entitlements ne sont pas
// charges, on n'affiche rien plutot que de flasher un module non inclus). Le slug de gate
// est derive de l'id logiciel via software-catalog (roadsens->burmister, casagrande->pieux...).
function useLogicielsItems(orgSlug: string): NavItem[] {
  const orgId = useOrgId(orgSlug);
  const [modules, setModules] = useState<string[] | null>(null);
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    getEntitlements(orgId)
      .then((e) => { if (alive) setModules(e.modules ?? []); })
      .catch(() => { if (alive) setModules([]); });
    return () => { alive = false; };
  }, [orgId]);

  if (modules === null) return [];
  return ALL_LOGICIELS.filter((it) => {
    const slug = engineIdForSoftware(it.id);
    return slug != null && modules.includes(slug);
  }).map((it) => ({ ...it, href: `/app/${orgSlug}${it.href}` }));
}

// ---------------------------------------------------------------------------
// Tooltip interne (pour mode collapsed)
// ---------------------------------------------------------------------------

function NavTooltip({ label, visible }: { label: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: '100%',
        top: '50%',
        transform: 'translateY(-50%)',
        marginLeft: 8,
        background: '#1f2329',
        color: '#f7f6f4',
        fontSize: 'var(--text-xs)',
        padding: '4px 8px',
        borderRadius: 'var(--radius-base)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 100,
        boxShadow: 'var(--elevation-popover)',
      }}
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar content (partagé expanded + drawer)
// ---------------------------------------------------------------------------

interface SidebarContentProps {
  orgSlug: string;
  collapsed: boolean;
  onClose?: () => void;
}

function SidebarContent({ orgSlug, collapsed, onClose }: SidebarContentProps) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = useNavItems(orgSlug);
  const logicielsItems = useLogicielsItems(orgSlug);
  const [tooltipId, setTooltipId] = useState<string | null>(null);
  const tooltipTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Valeurs hydratées après montage pour éviter les divergences SSR/client (#418).
  // Les fonctions getStoredUser/getStoredOrgs lisent sessionStorage : null/[] côté
  // serveur, valeur réelle côté client → mismatch garanti si appelées pendant le rendu.
  const [user, setUser] = useState<{ name: string; email: string }>({
    name: 'Utilisateur',
    email: '',
  });
  const [orgs, setOrgs] = useState<OrgClaim[]>([]);
  useEffect(() => {
    const u = getStoredUser();
    if (u) setUser(u);
    setOrgs(getStoredOrgs());
  }, []);

  const currentOrg = orgs.find((o) => o.slug === orgSlug);

  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const orgMenuRef = useRef<HTMLDivElement>(null);

  // Fermer le menu org en cliquant hors zone
  useEffect(() => {
    if (!orgMenuOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (orgMenuRef.current && !orgMenuRef.current.contains(e.target as Node)) {
        setOrgMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [orgMenuOpen]);

  function isActive(href: string, exact = false) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  function showTooltip(id: string) {
    if (!collapsed) return;
    tooltipTimers.current[id] = setTimeout(() => setTooltipId(id), 250);
  }

  function hideTooltip(id: string) {
    clearTimeout(tooltipTimers.current[id]);
    if (tooltipId === id) setTooltipId(null);
  }

  async function handleLogout() {
    await logout();
    document.cookie = 'roadsen_mock_auth=; path=/; max-age=0';
    router.push('/login');
  }

  function handleOrgSwitch(slug: string) {
    setOrgMenuOpen(false);
    if (slug !== orgSlug) {
      // queryClient.clear() équivalent — ici on navigue simplement
      router.push(`/app/${slug}/projets`);
    }
  }

  return (
    <div
      style={
        {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          '--surface-current': 'var(--surface-nav)',
        } as React.CSSProperties
      }
    >
      {/* Logotype */}
      <div
        style={{
          padding: collapsed ? '20px 0' : '20px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          flexShrink: 0,
        }}
      >
        {collapsed ? <StrataBar /> : <Logotype size={36} />}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Fermer la navigation"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-on-nav)',
              padding: 4,
              borderRadius: 'var(--radius-base)',
              display: 'flex',
            }}
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Séparateur */}
      <div style={{ height: 1, background: 'var(--border-nav)', flexShrink: 0 }} />

      {/* OrgSwitcher */}
      <div
        ref={orgMenuRef}
        style={{
          position: 'relative',
          padding: collapsed ? '8px 4px' : '8px 8px',
          flexShrink: 0,
        }}
      >
        <button
          aria-haspopup="listbox"
          aria-expanded={orgMenuOpen}
          onClick={() => setOrgMenuOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: collapsed ? '8px 0' : '8px 10px',
            background: orgMenuOpen ? 'var(--nav-selected)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-base)',
            cursor: 'pointer',
            color: 'var(--text-on-nav)',
            textAlign: 'left',
            justifyContent: collapsed ? 'center' : 'flex-start',
            transition: `background var(--dur-fast) var(--ease-state)`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--nav-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = orgMenuOpen
              ? 'var(--nav-selected)'
              : 'transparent';
          }}
        >
          <Avatar name={currentOrg?.slug ?? orgSlug} size="sm" />
          {!collapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 500,
                    color: 'var(--text-on-nav)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {orgSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-on-nav)' }}>
                  {currentOrg?.role ?? 'MEMBER'}
                </div>
              </div>
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                aria-hidden="true"
                style={{
                  color: 'var(--muted-on-nav)',
                  flexShrink: 0,
                  transform: orgMenuOpen ? 'rotate(180deg)' : 'none',
                  transition: `transform var(--dur-fast) var(--ease-state)`,
                }}
              />
            </>
          )}
        </button>

        {/* Dropdown orgs */}
        {orgMenuOpen && (
          <div
            role="listbox"
            aria-label="Choisir une organisation"
            style={{
              position: 'absolute',
              top: '100%',
              left: 8,
              right: 8,
              background: 'var(--surface-base)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--elevation-popover)',
              zIndex: 50,
              overflow: 'hidden',
              animation: `slideDown var(--dur-base) var(--ease-entrance)`,
            }}
          >
            {orgs.length === 0 ? (
              <div
                style={{
                  padding: '12px 14px',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                }}
              >
                Aucune organisation
              </div>
            ) : (
              orgs.map((org) => (
                <button
                  key={org.id}
                  role="option"
                  aria-selected={org.slug === orgSlug}
                  onClick={() => handleOrgSwitch(org.slug)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--row-hover-bg)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'none';
                  }}
                >
                  <Avatar name={org.slug} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-primary)',
                        fontWeight: org.slug === orgSlug ? 500 : 400,
                      }}
                    >
                      {org.slug
                        .replace(/-/g, ' ')
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </div>
                    <div
                      style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}
                    >
                      {org.role}
                    </div>
                  </div>
                  {org.slug === orgSlug && (
                    <Check
                      size={14}
                      strokeWidth={1.5}
                      aria-hidden="true"
                      style={{ color: 'var(--struct-petrole)' }}
                    />
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Séparateur */}
      <div
        style={{
          height: 1,
          background: 'var(--border-nav)',
          flexShrink: 0,
          margin: '0 8px',
        }}
      />

      {/* Navigation principale */}
      <nav
        aria-label="Navigation principale"
        style={{ flex: 1, overflow: 'auto', padding: '8px 8px 0' }}
      >
        {/* Section label */}
        {!collapsed && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--muted-on-nav)',
              padding: '12px 10px 6px',
            }}
          >
            Espace de travail
          </div>
        )}

        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {navItems.slice(0, 1).map((item) => {
            // "Accueil — Logiciels" est une page racine exacte (/logiciels) : en
            // startsWith, elle resterait active sur toute sous-page /logiciels/<x>,
            // ce qui double l'état actif avec l'item logiciel correspondant.
            const active = isActive(item.href, true);
            return (
              <li key={item.id} style={{ position: 'relative' }}>
                <a
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onMouseEnter={() => showTooltip(item.id)}
                  onMouseLeave={() => hideTooltip(item.id)}
                  onFocus={() => showTooltip(item.id)}
                  onBlur={() => hideTooltip(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: collapsed ? '10px 0' : '10px 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 'var(--radius-base)',
                    textDecoration: 'none',
                    color: active ? 'var(--accent-action-on-nav)' : 'var(--text-on-nav)',
                    background: active ? 'rgba(31,78,74,0.12)' : 'transparent',
                    borderLeft: active
                      ? '3px solid var(--struct-petrole)'
                      : '3px solid transparent',
                    fontSize: 'var(--text-sm)',
                    fontWeight: active ? 500 : 400,
                    transition: `background var(--dur-fast) var(--ease-state), color var(--dur-fast) var(--ease-state)`,
                    position: 'relative',
                  }}
                  onMouseOver={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--nav-hover)';
                  }}
                  onMouseOut={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {item.icon}
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </a>
                <NavTooltip
                  label={item.label}
                  visible={collapsed && tooltipId === item.id}
                />
              </li>
            );
          })}
        </ul>

        {/* Séparateur */}
        <div style={{ height: 1, background: 'var(--border-nav)', margin: '8px 2px' }} />

        {/* LOGICIELS */}
        {!collapsed && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--muted-on-nav)',
              padding: '12px 10px 6px',
            }}
          >
            Logiciels
          </div>
        )}

        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {logicielsItems.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.id} style={{ position: 'relative' }}>
                <a
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onMouseEnter={() => showTooltip(item.id)}
                  onMouseLeave={() => hideTooltip(item.id)}
                  onFocus={() => showTooltip(item.id)}
                  onBlur={() => hideTooltip(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: collapsed ? '10px 0' : '10px 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 'var(--radius-base)',
                    textDecoration: 'none',
                    color: active ? 'var(--accent-action-on-nav)' : 'var(--text-on-nav)',
                    background: active ? 'rgba(31,78,74,0.12)' : 'transparent',
                    borderLeft: active
                      ? '3px solid var(--struct-petrole)'
                      : '3px solid transparent',
                    fontSize: 'var(--text-sm)',
                    fontWeight: active ? 500 : 400,
                    transition: `background var(--dur-fast) var(--ease-state), color var(--dur-fast) var(--ease-state)`,
                    position: 'relative',
                  }}
                  onMouseOver={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--nav-hover)';
                  }}
                  onMouseOut={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {item.icon}
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </a>
                <NavTooltip
                  label={item.label}
                  visible={collapsed && tooltipId === item.id}
                />
              </li>
            );
          })}
        </ul>

        {/* Séparateur */}
        <div style={{ height: 1, background: 'var(--border-nav)', margin: '8px 2px' }} />

        {/* RESSOURCES */}
        {!collapsed && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--muted-on-nav)',
              padding: '12px 10px 6px',
            }}
          >
            Ressources
          </div>
        )}

        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {navItems.slice(1).map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.id} style={{ position: 'relative' }}>
                <a
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onMouseEnter={() => showTooltip(item.id)}
                  onMouseLeave={() => hideTooltip(item.id)}
                  onFocus={() => showTooltip(item.id)}
                  onBlur={() => hideTooltip(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: collapsed ? '10px 0' : '10px 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 'var(--radius-base)',
                    textDecoration: 'none',
                    color: active ? 'var(--accent-action-on-nav)' : 'var(--text-on-nav)',
                    background: active ? 'rgba(31,78,74,0.12)' : 'transparent',
                    borderLeft: active
                      ? '3px solid var(--struct-petrole)'
                      : '3px solid transparent',
                    fontSize: 'var(--text-sm)',
                    fontWeight: active ? 500 : 400,
                    transition: `background var(--dur-fast) var(--ease-state)`,
                    position: 'relative',
                  }}
                  onMouseOver={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--nav-hover)';
                  }}
                  onMouseOut={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {item.icon}
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </a>
                <NavTooltip
                  label={item.label}
                  visible={collapsed && tooltipId === item.id}
                />
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Pied de sidebar */}
      <div style={{ padding: '8px 8px', flexShrink: 0 }}>
        <div style={{ height: 1, background: 'var(--border-nav)', marginBottom: 8 }} />

        {/* Paramètres + Aide */}
        {[
          {
            id: 'settings',
            label: 'Paramètres',
            icon: <Settings size={20} strokeWidth={1.5} aria-hidden="true" />,
            href: `/app/${orgSlug}/parametres/general`,
          },
          {
            id: 'aide',
            label: 'Aide',
            icon: <HelpCircle size={20} strokeWidth={1.5} aria-hidden="true" />,
            href: `/app/${orgSlug}/aide`,
          },
        ].map((item) => (
          <div key={item.id} style={{ position: 'relative' }}>
            <a
              href={item.href}
              onMouseEnter={() => showTooltip(item.id)}
              onMouseLeave={() => hideTooltip(item.id)}
              onFocus={() => showTooltip(item.id)}
              onBlur={() => hideTooltip(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed ? '10px 0' : '10px 10px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 'var(--radius-base)',
                textDecoration: 'none',
                color: 'var(--muted-on-nav)',
                fontSize: 'var(--text-sm)',
                marginBottom: 2,
                transition: `background var(--dur-fast) var(--ease-state)`,
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover)';
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {item.icon}
              {collapsed ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span>{item.label}</span>
              )}
            </a>
            <NavTooltip label={item.label} visible={collapsed && tooltipId === item.id} />
          </div>
        ))}

        {/* Pied user */}
        <div style={{ height: 1, background: 'var(--border-nav)', margin: '8px 0' }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: collapsed ? '8px 0' : '8px 10px',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          {!collapsed && <Avatar name={user.name} size="sm" />}
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-on-nav)',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user.name}
              </div>
            </div>
          )}
          {/* Le logout doit rester accessible dans TOUS les états de la sidebar
              (replié inclus) : c'est le seul point de sortie du shell. */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => showTooltip('logout')}
            onMouseLeave={() => hideTooltip('logout')}
          >
            <button
              onClick={handleLogout}
              aria-label="Se déconnecter"
              title="Se déconnecter"
              onFocus={() => showTooltip('logout')}
              onBlur={() => hideTooltip('logout')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--muted-on-nav)',
                display: 'flex',
                padding: 4,
                borderRadius: 'var(--radius-base)',
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.color = 'var(--text-on-nav)';
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.color = 'var(--muted-on-nav)';
              }}
            >
              <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
              {collapsed && <span className="sr-only">Se déconnecter</span>}
            </button>
            <NavTooltip label="Se déconnecter" visible={collapsed && tooltipId === 'logout'} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar principale exportée
// ---------------------------------------------------------------------------

interface SidebarProps {
  orgSlug: string;
}

export function Sidebar({ orgSlug }: SidebarProps) {
  // Init à false (même valeur que le SSR) ; la préférence localStorage est lue
  // après hydratation pour éviter l'erreur React #418.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_STATE_KEY) === 'collapsed') {
        setCollapsed(true);
      }
    } catch {
      /* storage indisponible */
    }
  }, []);

  // Synchronise le décalage du contenu (.shell-main) avec la largeur réelle de la
  // sidebar : sans ça, au repli (240→64) un espace vide reste à gauche.
  useEffect(() => {
    document.documentElement.style.setProperty('--shell-sidebar-w', collapsed ? '64px' : '240px');
  }, [collapsed]);

  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_STATE_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        /* storage indisponible */
      }
      return next;
    });
  }, []);

  // Fermer le drawer mobile sur navigation.
  const pathname = usePathname();
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Gérer l'inert sur le main au drawer mobile
  useEffect(() => {
    const main = document.getElementById('main');
    if (main) {
      if (mobileOpen) {
        main.setAttribute('inert', '');
        main.setAttribute('aria-hidden', 'true');
      } else {
        main.removeAttribute('inert');
        main.removeAttribute('aria-hidden');
      }
    }
    return () => {
      const m = document.getElementById('main');
      if (m) {
        m.removeAttribute('inert');
        m.removeAttribute('aria-hidden');
      }
    };
  }, [mobileOpen]);

  // ESC ferme le drawer
  useEffect(() => {
    if (!mobileOpen) return;
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mobileOpen]);

  const sidebarWidth = collapsed ? 64 : 240;

  return (
    <>
      {/* Hamburger mobile — affiché < 1024px via CSS */}
      <button
        id="mobile-nav-trigger"
        aria-label="Ouvrir la navigation"
        aria-expanded={mobileOpen}
        aria-controls="sidebar-drawer"
        onClick={() => setMobileOpen(true)}
        style={{
          display: 'none', // CSS media query l'active
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 60,
          background: 'var(--surface-nav)',
          border: 'none',
          borderRadius: 'var(--radius-base)',
          color: 'var(--text-on-nav)',
          cursor: 'pointer',
          padding: 8,
        }}
        className="mobile-nav-trigger"
      >
        <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>

      {/* Backdrop mobile */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,18,16,0.6)',
            zIndex: 40,
            display: 'none',
          }}
          className="mobile-backdrop"
        />
      )}

      {/* Drawer mobile */}
      <aside
        id="sidebar-drawer"
        aria-label="Navigation principale"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 280,
          background: 'var(--surface-nav)',
          zIndex: 50,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform var(--dur-base) var(--ease-state)',
          display: 'none', // CSS media query l'active
          flexDirection: 'column',
          boxShadow: mobileOpen ? 'var(--elevation-modal)' : 'none',
        }}
        className="sidebar-mobile"
      >
        <SidebarContent
          orgSlug={orgSlug}
          collapsed={false}
          onClose={() => setMobileOpen(false)}
        />
      </aside>

      {/* Sidebar desktop */}
      <aside
        aria-label="Navigation principale"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: sidebarWidth,
          background: 'var(--surface-nav)',
          borderRight: '1px solid var(--border-nav)',
          transition: 'width var(--dur-base) var(--ease-state)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        className="sidebar-desktop"
      >
        <SidebarContent orgSlug={orgSlug} collapsed={collapsed} />

        {/* Bouton réduire */}
        <button
          onClick={toggleCollapse}
          aria-pressed={collapsed}
          aria-label="Réduire la navigation"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: collapsed ? '12px 0' : '12px 16px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            background: 'none',
            border: 'none',
            borderTop: '1px solid var(--border-nav)',
            cursor: 'pointer',
            color: 'var(--muted-on-nav)',
            fontSize: 'var(--text-xs)',
            width: '100%',
            flexShrink: 0,
            transition: `background var(--dur-fast) var(--ease-state)`,
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover)';
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'none';
          }}
        >
          {collapsed ? (
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <>
              <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>Réduire la navigation</span>
            </>
          )}
        </button>
      </aside>

      {/* Styles responsive (CSS media queries) */}
      <style>{`
        @media (max-width: 1023px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile { display: flex !important; }
          .mobile-nav-trigger { display: flex !important; }
          .mobile-backdrop { display: block !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sidebar-mobile, .sidebar-desktop { transition: none !important; }
        }
      `}</style>
    </>
  );
}

// Export pour le bouton hamburger accessible hors sidebar
export { type SidebarProps };
