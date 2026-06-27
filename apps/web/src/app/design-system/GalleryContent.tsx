"use client";

/**
 * Galerie design system ROADSEN — contenu complet (Client Component)
 *
 * Tous les composants UI avec event handlers nécessitent un Client Component.
 * La page `/design-system` est un shell Server Component minimal.
 */

import { useState } from "react";
import { Logotype, StrataBar } from "@/components/ui/Logotype";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea, Checkbox, Radio, Switch } from "@/components/ui/Field";
import { Badge, BadgeCompact } from "@/components/ui/Badge";
import { DomainTag } from "@/components/ui/DomainTag";
import { VerdictBanner } from "@/components/ui/VerdictBanner";
import { Card, CollapsiblePanel } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Avatar } from "@/components/ui/Avatar";
import { Kbd, KbdChord } from "@/components/ui/Kbd";
/* Lot 1 batch 2 */
import { OutputTable, type TableColumn, type TableRow } from "@/components/ui/OutputTable";
import { Metric } from "@/components/ui/Metric";
import { Modal } from "@/components/ui/Modal";
import { Dropdown, type DropdownItem } from "@/components/ui/Dropdown";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import {
  SkeletonText,
  SkeletonBadge,
  SkeletonCard,
  SkeletonList,
  SkeletonOutputTable,
} from "@/components/ui/Skeleton";
import {
  EmptyState,
  PreCalcEmptyState,
  NoCalcEmptyState,
  NoPvEmptyState,
  NetworkErrorEmptyState,
  FilterEmptyState,
} from "@/components/ui/EmptyState";
import { Tooltip, TooltipRich } from "@/components/ui/Tooltip";
import {
  CommandPalette,
  DEMO_COMMAND_ITEMS,
} from "@/components/ui/CommandPalette";
import {
  FolderOpen,
  Calculator,
  FileText,
  BarChart2,
  Trash2,
  Edit2,
  Copy,
  Archive,
} from "lucide-react";

export function GalleryContent() {
  return (
    <ToastProvider>
      <GalleryInner />
    </ToastProvider>
  );
}

function GalleryInner() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--surface-canvas)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: "var(--surface-nav)",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          gap: 24,
          ["--surface-current" as string]: "var(--surface-nav)",
        }}
      >
        <Logotype size={48} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono)" }}>
          Design System v1 · Lot 0 + Lot 1 (batch 1 + batch 2)
        </span>
      </header>

      <main id="main-content" style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 32px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>
          Galerie composants ROADSEN
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 48 }}>
          Référence visuelle interne — validation des tokens et états avant intégration.
        </p>

        {/* TOKENS */}
        <Section title="Tokens couleur — identite-v3.md">
          <ColorTokens />
        </Section>

        {/* TYPOGRAPHIE */}
        <Section title="Échelle typographique">
          <TypographyScale />
        </Section>

        {/* LOGOTYPE */}
        <Section title="A-18 Logotype">
          <LogotypeSection />
        </Section>

        {/* BADGE */}
        <Section title="A-06 Badge statut">
          <BadgeSection />
        </Section>

        {/* DOMAIN TAG */}
        <Section title="A-07 Domain Tag">
          <DomainTagSection />
        </Section>

        {/* VERDICT BANNER */}
        <Section title="A-08 Verdict Banner">
          <VerdictBannerSection />
        </Section>

        {/* CARD */}
        <Section title="A-11 Card / Panel">
          <CardSection />
        </Section>

        {/* BREADCRUMB */}
        <Section title="A-22 Breadcrumb">
          <BreadcrumbSection />
        </Section>

        {/* AVATAR */}
        <Section title="A-23 Avatar / Monogramme">
          <AvatarSection />
        </Section>

        {/* KBD */}
        <Section title="A-24 Kbd (raccourcis clavier)">
          <KbdSection />
        </Section>

        {/* BUTTON */}
        <ButtonSection />

        {/* FIELDS */}
        <FieldSection />

        {/* TABS */}
        <TabsSection />

        {/* ELEVATION */}
        <Section title="Élévation zéro-offset — 3 niveaux">
          <ElevationDemo />
        </Section>

        {/* MOTION TOKENS */}
        <Section title="Tokens de motion">
          <MotionTokens />
        </Section>

        {/* ============================================================ */}
        {/* LOT 1 BATCH 2                                                */}
        {/* ============================================================ */}

        {/* METRIC */}
        <Section title="A-10 Metric — valeur numérique géotechnique">
          <MetricSection />
        </Section>

        {/* OUTPUT TABLE */}
        <Section title="A-09 OutputTable — gabarit résultats de calcul">
          <OutputTableSection />
        </Section>

        {/* SKELETON */}
        <Section title="A-15 Skeleton — états de chargement (>400ms)">
          <SkeletonSection />
        </Section>

        {/* EMPTY STATE */}
        <Section title="A-16 EmptyState — variantes distinctes">
          <EmptyStateSection />
        </Section>

        {/* MODAL */}
        <Section title="A-12 Modal / Dialog — sm / md / lg">
          <ModalSection />
        </Section>

        {/* DROPDOWN */}
        <Section title="A-13 Dropdown / Menu d'actions">
          <DropdownSection />
        </Section>

        {/* TOAST */}
        <Section title="A-14 Toast / Notification — 4 types">
          <ToastSection />
        </Section>

        {/* TOOLTIP */}
        <Section title="A-19 Tooltip — hover/focus délai 250ms">
          <TooltipSection />
        </Section>

        {/* COMMAND PALETTE */}
        <Section title="A-20 Command Palette (Cmd+K)">
          <CommandPaletteSection />
        </Section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wrapper section                                                      */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 56 }}>
      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 16,
          paddingBottom: 8,
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sections statiques                                                   */
/* ------------------------------------------------------------------ */

function LogotypeSection() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-end" }}>
      <div
        style={{
          background: "var(--surface-nav)",
          padding: 20,
          borderRadius: 6,
          ["--surface-current" as string]: "var(--surface-nav)",
        }}
      >
        <p className="label-caps" style={{ color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
          Variante complète ≥ 32px
        </p>
        <Logotype size={48} variant="full" />
      </div>
      <div
        style={{
          background: "var(--surface-nav)",
          padding: 20,
          borderRadius: 6,
        }}
      >
        <p className="label-caps" style={{ color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>
          Variante glyphe &lt; 32px
        </p>
        <Logotype size={24} variant="glyph" />
      </div>
      <div style={{ padding: 20 }}>
        <p className="label-caps" style={{ marginBottom: 12 }}>Barre de strates seule</p>
        <StrataBar width={80} />
      </div>
    </div>
  );
}

function BadgeSection() {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <Badge variant="conforme" />
        <Badge variant="non-conforme" />
        <Badge variant="neutre" />
        <Badge variant="recalculable" />
        <Badge variant="scelle" />
        <Badge variant="en-cours" />
        <Badge variant="erreur" />
      </div>
      <p className="label-caps" style={{ marginBottom: 8 }}>Variante compacte (listes)</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <BadgeCompact variant="conforme" />
        <BadgeCompact variant="non-conforme" />
        <BadgeCompact variant="neutre" />
        <BadgeCompact variant="scelle" />
      </div>
    </>
  );
}

function DomainTagSection() {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <DomainTag domain="road" />
        <DomainTag domain="foundation" />
        <DomainTag domain="lab" />
      </div>
      <p className="label-caps" style={{ marginBottom: 8 }}>Variante compacte</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <DomainTag domain="road" size="compact" />
        <DomainTag domain="foundation" size="compact" />
        <DomainTag domain="lab" size="compact" />
      </div>
    </>
  );
}

function VerdictBannerSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 600 }}>
      <VerdictBanner
        verdict="pass"
        message="Le calcul de portance satisfait aux exigences de la norme AGEROUTE 2015. CBR ≥ 10 sur 30 cm."
      />
      <VerdictBanner
        verdict="fail"
        message="Le module de rigidité calculé (E = 4 200 MPa) est hors tolérance. Vérifier la consistance des paramètres de sol."
      />
      <p className="label-caps" style={{ marginTop: 8 }}>Mode compact</p>
      <div style={{ display: "flex", gap: 8 }}>
        <VerdictBanner verdict="pass" mode="compact" />
        <VerdictBanner verdict="fail" mode="compact" />
      </div>
    </div>
  );
}

function CardSection() {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <Card style={{ width: 260 }}>
          <p className="label-caps" style={{ marginBottom: 6 }}>Card standard</p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Elevation zéro-offset uniquement. Jamais border + elevation.
          </p>
        </Card>
        <Card clickable style={{ width: 260 }}>
          <p className="label-caps" style={{ marginBottom: 6 }}>Card cliquable</p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Hover background subtle. Transition 150ms.
          </p>
        </Card>
        <Card disabled style={{ width: 260 }}>
          <p className="label-caps" style={{ marginBottom: 6 }}>Card désactivée</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Opacity 0.55. Non interactive.
          </p>
        </Card>
      </div>
      <div style={{ marginTop: 16, maxWidth: 400 }}>
        <CollapsiblePanel title="Panel repliable — Section formulaire">
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Contenu du panel. Peut contenir des champs, des résultats, des paramètres.
          </p>
        </CollapsiblePanel>
      </div>
    </>
  );
}

function BreadcrumbSection() {
  return (
    <>
      <div
        style={{
          background: "var(--surface-nav)",
          padding: "12px 16px",
          borderRadius: 6,
          marginBottom: 12,
          ["--surface-current" as string]: "var(--surface-nav)",
        }}
      >
        <Breadcrumb
          onDark
          segments={[
            { label: "Projets", href: "/projets" },
            { label: "RN2-PK45 Thiès–Diourbel", href: "/projets/rn2" },
            { label: "Calculs", href: "/projets/rn2/calculs" },
            { label: "Burmister n°12" },
          ]}
        />
      </div>
      <p className="label-caps" style={{ marginBottom: 8 }}>Troncature &gt; 4 niveaux</p>
      <div
        style={{
          background: "var(--surface-nav)",
          padding: "12px 16px",
          borderRadius: 6,
        }}
      >
        <Breadcrumb
          onDark
          segments={[
            { label: "Projets", href: "/projets" },
            { label: "RN2-PK45", href: "/projets/rn2" },
            { label: "Chaussées", href: "/projets/rn2/chaussees" },
            { label: "Campagne 2026", href: "/projets/rn2/campagne" },
            { label: "Calculs", href: "/projets/rn2/calculs" },
            { label: "Burmister n°12" },
          ]}
        />
      </div>
    </>
  );
}

function AvatarSection() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
      <Avatar name="Mouhammadou Oury Diallo" size="sm" />
      <Avatar name="Mouhammadou Oury Diallo" size="md" />
      <Avatar name="Mouhammadou Oury Diallo" size="lg" />
      <Avatar name="Alioune Badara Fall" size="md" />
      <Avatar name="Khadija Traoré" size="md" />
      <Avatar name="STARFIRE TECHNOLOGY" size="md" />
      <Avatar name="Loading State" size="md" loading />
    </div>
  );
}

function KbdSection() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Kbd>N</Kbd>
      <Kbd>D</Kbd>
      <Kbd>E</Kbd>
      <KbdChord keys={["Ctrl", "Entrée"]} />
      <KbdChord keys={["Cmd", "K"]} />
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        Dans un tooltip : <Kbd>Esc</Kbd> pour fermer
      </span>
    </div>
  );
}

function ColorTokens() {
  const groups = [
    {
      label: "Surfaces",
      tokens: [
        { name: "--surface-canvas", value: "#f7f6f4", text: "#1f2329" },
        { name: "--surface-base", value: "#ffffff", text: "#1f2329" },
        { name: "--surface-nav", value: "#22262b", text: "#f7f6f4" },
      ],
    },
    {
      label: "Action / marque",
      tokens: [
        { name: "--accent-brand", value: "#b86a2e", text: "#ffffff" },
        { name: "--accent-action (5,11:1)", value: "#a05226", text: "#ffffff" },
        { name: "--accent-action-on-nav (5,4:1)", value: "#d9954e", text: "#22262b" },
        { name: "--struct-petrole", value: "#1f4e4a", text: "#ffffff" },
      ],
    },
    {
      label: "Verdicts (exclusifs)",
      tokens: [
        { name: "--status-pass-bg", value: "#e9f1ec", text: "#2f6b46" },
        { name: "--status-pass-tx (5,13:1)", value: "#2f6b46", text: "#ffffff" },
        { name: "--status-fail-bg", value: "#fbeceb", text: "#8b1a1a" },
        { name: "--status-fail-tx (8,12:1)", value: "#8b1a1a", text: "#ffffff" },
      ],
    },
    {
      label: "Texte (ratios figés WCAG 2.2)",
      tokens: [
        { name: "--text-primary (~13:1)", value: "#1f2329", text: "#f7f6f4" },
        { name: "--text-secondary (7,1:1)", value: "#4a5158", text: "#f7f6f4" },
        { name: "--text-muted (4,6:1)", value: "#6b7077", text: "#ffffff" },
      ],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {groups.map((group) => (
        <div key={group.label}>
          <p className="label-caps" style={{ marginBottom: 8 }}>{group.label}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {group.tokens.map((token) => (
              <div
                key={token.name}
                style={{
                  width: 180,
                  borderRadius: 6,
                  overflow: "hidden",
                  boxShadow: "var(--elevation-card)",
                }}
              >
                <div
                  style={{
                    height: 48,
                    background: token.value,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: token.text,
                  }}
                >
                  {token.value}
                </div>
                <div
                  style={{
                    padding: "6px 8px",
                    background: "var(--surface-base)",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {token.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TypographyScale() {
  const scale = [
    { token: "--text-2xl", px: 32, usage: "Valeur de synthèse principale (plafond)", weight: 600 },
    { token: "--text-xl", px: 24, usage: "Titre de page", weight: 500 },
    { token: "--text-lg", px: 20, usage: "Titre de section", weight: 500 },
    { token: "--text-base", px: 16, usage: "Corps confort", weight: 400 },
    { token: "--text-sm", px: 14, usage: "Corps dense (défaut)", weight: 400 },
    { token: "--text-xs", px: 12, usage: "Texte support, chips", weight: 400 },
    { token: "--text-2xs", px: 11, usage: "Labels .label-caps uniquement", weight: 500 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {scale.map((item) => (
        <div
          key={item.token}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 16,
            borderBottom: "1px solid var(--border-subtle)",
            paddingBottom: 10,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--accent-action)",
              background: "var(--color-alt, #eef0f1)",
              padding: "1px 5px",
              borderRadius: 3,
              whiteSpace: "nowrap",
              flexShrink: 0,
              width: 110,
            }}
          >
            {item.token}
          </span>
          <span
            style={{
              fontSize: item.px,
              fontWeight: item.weight,
              lineHeight: 1.2,
              color: "var(--text-primary)",
            }}
          >
            1 243,5 kPa
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginLeft: "auto",
              whiteSpace: "nowrap",
              alignSelf: "center",
            }}
          >
            {item.px}px · {item.usage}
          </span>
        </div>
      ))}
    </div>
  );
}

function ElevationDemo() {
  const levels = [
    { label: "Niveau 0 — Canvas", shadow: "none", bg: "var(--surface-canvas)" },
    { label: "Niveau 1 — elevation-card", shadow: "var(--elevation-card)", bg: "var(--surface-base)" },
    { label: "Niveau 2 — elevation-modal", shadow: "var(--elevation-modal)", bg: "var(--surface-overlay)" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
      {levels.map((l) => (
        <div
          key={l.label}
          style={{
            width: 200,
            height: 80,
            borderRadius: 6,
            background: l.bg,
            boxShadow: l.shadow,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "var(--text-secondary)",
            textAlign: "center",
            padding: 12,
          }}
        >
          {l.label}
        </div>
      ))}
    </div>
  );
}

function MotionTokens() {
  const tokens = [
    { name: "--dur-instant", value: "100ms", usage: "Focus, états haute fréquence" },
    { name: "--dur-fast", value: "150ms", usage: "Hover, badges, transitions légères" },
    { name: "--dur-base", value: "200ms", usage: "Ouverture dropdown, entrance" },
    { name: "--dur-moderate", value: "250ms", usage: "Modales (entrance)" },
    { name: "--dur-slow", value: "300ms — MAX", usage: "Animations complexes" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {tokens.map((t) => (
        <div
          key={t.name}
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            padding: "8px 0",
            borderBottom: "1px solid var(--border-subtle)",
            fontSize: 13,
          }}
        >
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--accent-action)",
              background: "var(--color-alt, #eef0f1)",
              padding: "2px 6px",
              borderRadius: 3,
              width: 150,
              flexShrink: 0,
            }}
          >
            {t.name}
          </code>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--text-primary)",
              fontWeight: 500,
              width: 100,
            }}
          >
            {t.value}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.usage}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sections interactives                                                */
/* ------------------------------------------------------------------ */

function ButtonSection() {
  const [loading, setLoading] = useState(false);

  function simulateLoad() {
    setLoading(true);
    setTimeout(() => setLoading(false), 2500);
  }

  return (
    <Section title="A-01 Button — 4 variantes × 3 tailles × états">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {(["action", "secondary", "ghost", "danger"] as const).map((variant) => (
          <div key={variant}>
            <p
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {variant}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Button variant={variant} size="sm">Petit</Button>
              <Button variant={variant} size="md">Moyen</Button>
              <Button variant={variant} size="lg">Grand</Button>
              <Button variant={variant} size="md" iconLeft={<Calculator size={16} strokeWidth={1.5} />}>
                Avec icône
              </Button>
              <Button variant={variant} size="md" disabled>Désactivé</Button>
            </div>
          </div>
        ))}

        <div>
          <p
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              marginBottom: 8,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            État loading (cliquer pour déclencher)
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="action" loading={loading} onClick={simulateLoad}>
              Calculer
            </Button>
            <Button variant="action" loading={true}>
              Calcul en cours (forcé)
            </Button>
          </div>
        </div>

        {/* Sur fond asphalte */}
        <div
          style={{
            background: "var(--surface-nav)",
            padding: 20,
            borderRadius: 6,
            ["--surface-current" as string]: "var(--surface-nav)",
          }}
        >
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              marginBottom: 12,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Sur fond asphalte (onDark) — --accent-action-on-nav
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="action" onDark>Calculer</Button>
            <Button variant="ghost" onDark>Annuler</Button>
          </div>
        </div>

        {/* Nav items simulés */}
        <div
          style={{
            background: "var(--surface-nav)",
            padding: "12px 8px",
            borderRadius: 6,
            width: 240,
          }}
        >
          {[
            { icon: <FolderOpen size={16} strokeWidth={1.5} />, label: "Projets", active: true },
            { icon: <Calculator size={16} strokeWidth={1.5} />, label: "Calculs", active: false },
            { icon: <FileText size={16} strokeWidth={1.5} />, label: "PV & Livrables", active: false },
            { icon: <BarChart2 size={16} strokeWidth={1.5} />, label: "Bibliothèque", active: false },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: "var(--radius-base)",
                color: item.active ? "var(--accent-action-on-nav)" : "rgba(255,255,255,0.82)",
                background: item.active ? "rgba(255,255,255,0.08)" : "transparent",
                fontSize: 13,
                fontWeight: item.active ? 500 : 400,
                cursor: "pointer",
                position: "relative",
              }}
            >
              {item.active && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 6,
                    bottom: 6,
                    width: 2,
                    borderRadius: 1,
                    background: "var(--struct-petrole)",
                  }}
                />
              )}
              <span style={{ color: item.active ? "var(--accent-action-on-nav)" : "rgba(255,255,255,0.6)" }}>
                {item.icon}
              </span>
              {item.label}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function FieldSection() {
  const [inputValue, setInputValue] = useState("");
  const [selectValue, setSelectValue] = useState("");
  const [textareaValue, setTextareaValue] = useState("");
  const [checked, setChecked] = useState(false);
  const [switchOn, setSwitchOn] = useState(false);
  const [radio, setRadio] = useState("r1");

  function validateModule(value: string) {
    const n = parseFloat(value.replace(",", "."));
    if (!value) return { error: "Ce champ est obligatoire." };
    if (isNaN(n)) return { error: "Valeur numérique attendue." };
    if (n < 0) return { error: "Le module doit être positif." };
    if (n < 50 || n > 15000)
      return { warning: "Hors plage physique plausible (50–15 000 MPa). L'ingénieur outrepasse consciemment." };
    return {};
  }

  return (
    <Section title="A-02/A-03/A-04/A-05 Fields — Input · Select · Textarea · Checkbox · Radio · Switch">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 24,
        }}
      >
        <Input
          label="Module élastique E1"
          id="e1-defaut"
          unit="MPa"
          hint="Valeur déterminée par essais in situ (50–15 000 MPa)"
          placeholder="ex. 4 200"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onValidate={validateModule}
        />

        <Input
          label="Module élastique E2"
          id="e2-erreur"
          unit="MPa"
          error="Attendu : module en MPa, ex. 50–15 000. Valeur négative non admise."
          fieldState="error"
          defaultValue="-100"
        />

        <Input
          label="CBR (portance)"
          id="cbr-valide"
          unit="%"
          fieldState="valid"
          defaultValue="12"
        />

        <Input
          label="Contrainte admissible"
          id="sigma-warning"
          unit="kPa"
          warning="Hors plage physique plausible (10–5 000 kPa). L'ingénieur outrepasse consciemment."
          fieldState="warning"
          defaultValue="9 500"
        />

        <Input
          label="Référence calcul"
          id="ref-disabled"
          defaultValue="CALC-2026-045"
          disabled
          hint="Généré automatiquement"
        />

        <Select
          label="Type de fondation"
          id="type-fond"
          value={selectValue}
          onChange={(e) => setSelectValue(e.target.value)}
        >
          <option value="">Sélectionner…</option>
          <option value="semelle">Semelle filante</option>
          <option value="radier">Radier général</option>
          <option value="pieu">Pieux forés</option>
        </Select>

        <Select
          label="Méthode de calcul"
          id="methode-erreur"
          error="Sélection obligatoire avant de lancer le calcul."
        >
          <option value="">Sélectionner…</option>
          <option value="meyerhof">Meyerhof</option>
          <option value="vesic">Vesic</option>
        </Select>

        <Textarea
          label="Notes de calcul"
          id="notes"
          hint="Description des hypothèses, références, conditions de terrain."
          placeholder="Ex. : Sol limoneux, prélèvement à 2,5 m de profondeur, nappe à 4 m..."
          value={textareaValue}
          onChange={(e) => setTextareaValue(e.target.value)}
        />

        <Textarea
          label="Commentaire (obligatoire pour PV)"
          id="comment-erreur"
          error="Le commentaire est requis pour l'émission du PV."
          fieldState="error"
        />
      </div>

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <p className="label-caps">Sélections booléennes</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          <Checkbox
            id="nappe"
            label="Présence de nappe phréatique"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <Checkbox id="nappe-disabled" label="Paramètre désactivé" disabled />
          <Checkbox id="nappe-error" label="Confirmation obligatoire" error="Cette case doit être cochée." />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {["Méthode A", "Méthode B", "Méthode C (désactivée)"].map((label, i) => (
            <Radio
              key={label}
              id={`radio-${i}`}
              name="methode"
              label={label}
              value={`r${i + 1}`}
              checked={radio === `r${i + 1}`}
              onChange={() => setRadio(`r${i + 1}`)}
              disabled={i === 2}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Switch id="recalc" label="Recalcul automatique" checked={switchOn} onChange={setSwitchOn} />
          <Switch id="recalc-off" label="Option désactivée" checked={false} disabled />
        </div>
      </div>
    </Section>
  );
}

function TabsSection() {
  const tabs = [
    {
      id: "overview",
      label: "Vue d'ensemble",
      content: (
        <div style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>
          Contenu Vue d'ensemble — swap instantané (0 ms). Pas de transition sur le contenu.
        </div>
      ),
    },
    {
      id: "calculs",
      label: "Calculs",
      content: (
        <div style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>
          Liste des calculs — master-detail.
        </div>
      ),
    },
    {
      id: "pv",
      label: "PV & Livrables",
      content: (
        <div style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>
          Liste des PV scellés.
        </div>
      ),
    },
    {
      id: "info",
      label: "Informations",
      content: (
        <div style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>
          Métadonnées projet — renommage léger optimistic.
        </div>
      ),
    },
  ];

  return (
    <Section title="A-21 Tabs — underline pétrole · navigation clavier ←/→ · swap instantané">
      <div
        style={{
          background: "var(--surface-base)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--elevation-card)",
          overflow: "hidden",
        }}
      >
        <Tabs tabs={tabs} defaultActiveId="calculs" />
      </div>
    </Section>
  );
}

/* ================================================================== */
/* LOT 1 BATCH 2 — Sections galerie                                   */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* A-10 Metric                                                         */
/* ------------------------------------------------------------------ */
function MetricSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante isolated (valeur phare 32px)</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center" }}>
          <Metric value={1243.5} unit="kPa" variant="isolated" decimals={1} />
          <Metric value={4200} unit="MPa" variant="isolated" decimals={0} />
        </div>
      </div>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante table (14px 600 + unité muted)</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <Metric value={4200} unit="MPa" variant="table" decimals={0} />
          <Metric value={12.5} unit="%" variant="table" decimals={2} />
          <Metric value={0.0025} variant="table" decimals={4} />
        </div>
      </div>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Valeurs indisponibles (NaN / Infinity / null / undefined → '—')</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <Metric value={NaN} unit="kPa" />
          <Metric value={Infinity} unit="MPa" />
          <Metric value={null} />
          <Metric value={undefined} unit="%" />
        </div>
      </div>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante out-of-range (hors plage physique)</p>
        <Metric value={999999} unit="kPa" variant="out-of-range" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-09 OutputTable                                                    */
/* ------------------------------------------------------------------ */
const TABLE_COLS: TableColumn[] = [
  { key: "e1", label: "E1", unit: "MPa", numeric: true, decimals: 0 },
  { key: "cbr", label: "CBR", unit: "%", numeric: true, decimals: 2 },
  { key: "verdict", label: "Verdict", numeric: false, width: 120 },
];

const TABLE_ROWS: TableRow[] = [
  { id: "Section A", groupLabel: "Section A — Route nationale RN2" },
  { id: "Couche 1", cells: { e1: 4200, cbr: 12.5, verdict: "Conforme" } },
  { id: "Couche 2", cells: { e1: 1800, cbr: 8.0, verdict: "Non conforme" } },
  { id: "Couche 3", cells: { e1: NaN, cbr: null, verdict: "—" } },
  { id: "Section B", groupLabel: "Section B — Déviation PK45" },
  { id: "Couche 4", cells: { e1: 3100, cbr: 15.2, verdict: "Conforme" } },
];

function OutputTableSection() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error" | "empty">("idle");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["idle", "loading", "success", "empty", "error"] as const).map((s) => (
          <Button
            key={s}
            variant={status === s ? "action" : "secondary"}
            size="sm"
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>
      <div
        style={{
          background: "var(--surface-base)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--elevation-card)",
          overflow: "hidden",
        }}
      >
        <OutputTable
          columns={TABLE_COLS}
          rows={status === "success" ? TABLE_ROWS : []}
          status={status}
          error={status === "error" ? "Non-convergence du calcul Burmister. Vérifier la cohérence des paramètres." : undefined}
          idColumnLabel="Couche / section"
          skeletonRows={5}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-15 Skeleton                                                       */
/* ------------------------------------------------------------------ */
function SkeletonSection() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante text (1 et 3 lignes)</p>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <div style={{ width: 200 }}><SkeletonText lines={1} /></div>
          <div style={{ width: 260 }}><SkeletonText lines={3} /></div>
        </div>
      </div>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante badge</p>
        <SkeletonBadge />
      </div>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante card</p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <SkeletonCard style={{ width: 240 }} />
          <SkeletonCard style={{ width: 240 }} />
        </div>
      </div>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante liste calculs (colonne gauche 280px)</p>
        <div style={{ width: 280, background: "var(--surface-base)", borderRadius: 6, boxShadow: "var(--elevation-card)" }}>
          <SkeletonList count={5} />
        </div>
      </div>
      <div>
        <p className="label-caps" style={{ marginBottom: 12 }}>Variante OutputTable (dimensions réelles, CLS=0)</p>
        <div style={{ background: "var(--surface-base)", borderRadius: 6, boxShadow: "var(--elevation-card)", overflow: "hidden" }}>
          <SkeletonOutputTable rows={4} columns={4} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-16 EmptyState                                                     */
/* ------------------------------------------------------------------ */
function EmptyStateSection() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 16,
      }}
    >
      {[
        <div key="blank" style={{ background: "var(--surface-base)", borderRadius: 6, boxShadow: "var(--elevation-card)" }}>
          <p className="label-caps" style={{ padding: "12px 16px 0", color: "var(--text-muted)" }}>Vide absolu (premier usage)</p>
          <NoCalcEmptyState onNewCalc={() => alert("Nouveau calcul")} />
        </div>,
        <div key="pv" style={{ background: "var(--surface-base)", borderRadius: 6, boxShadow: "var(--elevation-card)" }}>
          <p className="label-caps" style={{ padding: "12px 16px 0", color: "var(--text-muted)" }}>Liste PV vide</p>
          <NoPvEmptyState />
        </div>,
        <div key="precalc" style={{ background: "var(--surface-base)", borderRadius: 6, boxShadow: "var(--elevation-card)" }}>
          <p className="label-caps" style={{ padding: "12px 16px 0", color: "var(--text-muted)" }}>Zone pré-calcul (CLS=0)</p>
          <PreCalcEmptyState minHeight={160} />
        </div>,
        <div key="network" style={{ background: "var(--surface-base)", borderRadius: 6, boxShadow: "var(--elevation-card)" }}>
          <p className="label-caps" style={{ padding: "12px 16px 0", color: "var(--text-muted)" }}>Erreur réseau</p>
          <NetworkErrorEmptyState onRetry={() => alert("Réessayer")} />
        </div>,
        <div key="filter" style={{ background: "var(--surface-base)", borderRadius: 6, boxShadow: "var(--elevation-card)" }}>
          <p className="label-caps" style={{ padding: "12px 16px 0", color: "var(--text-muted)" }}>Filtre sans résultat</p>
          <FilterEmptyState onClear={() => alert("Effacer")} />
        </div>,
      ]}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-12 Modal                                                          */
/* ------------------------------------------------------------------ */
function ModalSection() {
  const [openModal, setOpenModal] = useState<"sm" | "md" | "lg" | "loading" | "error" | null>(null);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {(["sm", "md", "lg"] as const).map((size) => (
        <Button key={size} variant="secondary" size="sm" onClick={() => setOpenModal(size)}>
          Ouvrir {size.toUpperCase()}
        </Button>
      ))}
      <Button variant="ghost" size="sm" onClick={() => setOpenModal("loading")}>
        Avec loading
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setOpenModal("error")}>
        Avec erreur
      </Button>

      {(["sm", "md", "lg"] as const).map((size) => (
        <Modal
          key={size}
          open={openModal === size}
          onClose={() => setOpenModal(null)}
          title={`Émission du PV n°12 — ${size.toUpperCase()}`}
          description="Vérifiez les paramètres avant de sceller ce procès-verbal."
          size={size}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setOpenModal(null)}>Annuler</Button>
              <Button variant="action" size="sm">Émettre et sceller le PV n°12</Button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Module E1 : <Metric value={4200} unit="MPa" /> — CBR : <Metric value={12.5} unit="%" decimals={1} />
          </p>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginTop: 12 }}>
            Ingénieur : Mouhammadou Oury Diallo · {new Date().toLocaleDateString("fr-FR")}
          </p>
        </Modal>
      ))}

      <Modal
        open={openModal === "loading"}
        onClose={() => setOpenModal(null)}
        title="Scellement en cours…"
        size="sm"
        loading
      >
        <p>Ce texte n'est pas visible pendant le chargement.</p>
      </Modal>

      <Modal
        open={openModal === "error"}
        onClose={() => setOpenModal(null)}
        title="Émission du PV"
        size="sm"
        error="Les paramètres ont changé depuis le dernier calcul. Relancez le calcul avant d'émettre."
        footer={<Button variant="action" size="sm" onClick={() => setOpenModal(null)}>Fermer</Button>}
      >
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Vérifiez les champs et relancez.</p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-13 Dropdown                                                       */
/* ------------------------------------------------------------------ */
const DD_ITEMS: DropdownItem[] = [
  { id: "edit", label: "Modifier", icon: <Edit2 size={16} strokeWidth={1.5} />, onClick: () => alert("Modifier") },
  { id: "duplicate", label: "Dupliquer", icon: <Copy size={16} strokeWidth={1.5} />, onClick: () => alert("Dupliquer") },
  { id: "archive", label: "Archiver", icon: <Archive size={16} strokeWidth={1.5} />, disabled: true },
  {
    id: "delete",
    label: "Supprimer",
    icon: <Trash2 size={16} strokeWidth={1.5} />,
    danger: true,
    separator: true,
    onClick: () => alert("Supprimer"),
  },
];

function DropdownSection() {
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <Dropdown trigger={<Button variant="secondary" size="sm">Actions ▾</Button>} items={DD_ITEMS} />
      <Dropdown
        trigger={<Button variant="ghost" size="sm">Menu droite ▾</Button>}
        items={DD_ITEMS}
        align="right"
        width={240}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-14 Toast                                                          */
/* ------------------------------------------------------------------ */
function ToastSection() {
  const { addToast } = useToast();
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Button
        variant="action"
        size="sm"
        onClick={() => addToast({ type: "success", message: "PV n°12 émis et scellé avec succès." })}
      >
        Succès (4s)
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={() =>
          addToast({
            type: "error",
            message: "Impossible de joindre le serveur de calcul.",
            actionLabel: "Réessayer",
            onAction: () => alert("Réessayer"),
          })
        }
      >
        Erreur (6s + Réessayer)
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => addToast({ type: "warning", message: "Paramètres hors plage physique plausible. L'ingénieur outrepasse consciemment." })}
      >
        Warning
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => addToast({ type: "info", message: "Densité compacte disponible — activer dans les paramètres." })}
      >
        Info
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-19 Tooltip                                                        */
/* ------------------------------------------------------------------ */
function TooltipSection() {
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
      <Tooltip content="Module élastique de la couche 1 (50–15 000 MPa)">
        <Button variant="secondary" size="sm">Hover/focus moi</Button>
      </Tooltip>
      <TooltipRich
        text="Lancer le calcul"
        shortcut={["Ctrl", "Entrée"]}
      >
        <Button variant="action" size="sm">Calculer</Button>
      </TooltipRich>
      <TooltipRich text="Dupliquer comme gabarit" shortcut="D">
        <Button variant="ghost" size="sm">Dupliquer</Button>
      </TooltipRich>
      <Tooltip content="Raccourci : N" position="bottom">
        <Button variant="ghost" size="sm">Nouveau (bas)</Button>
      </Tooltip>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A-20 CommandPalette                                                 */
/* ------------------------------------------------------------------ */
function CommandPaletteSection() {
  const [open, setOpen] = useState(false);
  const [hasProject, setHasProject] = useState(true);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="action" size="sm" onClick={() => setOpen(true)}>
          Ouvrir la palette
        </Button>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          ou <Kbd>Cmd</Kbd>+<Kbd>K</Kbd>
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={hasProject}
            onChange={(e) => setHasProject(e.target.checked)}
          />
          Contexte projet actif
        </label>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Sans contexte projet : "Nouveau calcul" et "Émettre un PV" absents.
        Les récents ne croisent jamais les orgs (à câbler par le tenant).
      </p>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        items={DEMO_COMMAND_ITEMS}
        hasProject={hasProject}
      />
    </div>
  );
}
