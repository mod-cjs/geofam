/**
 * Barrel export — design system ROADSEN
 * Lot 0 (tokens dans globals.css) + Lot 1 batch 1 + Lot 1 batch 2
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines ici.
 */

export { Logotype, StrataBar } from "./Logotype";
export type { } from "./Logotype";

export { Button } from "./Button";
export type { ButtonVariant, ButtonSize } from "./Button";

export { Input, Select, Textarea, Checkbox, Radio, Switch } from "./Field";
export type { FieldState } from "./Field";

export { Badge, BadgeCompact } from "./Badge";
export type { BadgeVariant } from "./Badge";

export { DomainTag } from "./DomainTag";
export type { Domain } from "./DomainTag";

export { VerdictBanner } from "./VerdictBanner";
export type { VerdictType } from "./VerdictBanner";

export { Card, CollapsiblePanel } from "./Card";

export { Tabs } from "./Tabs";

export { Breadcrumb } from "./Breadcrumb";
export type { BreadcrumbSegment } from "./Breadcrumb";

export { Avatar } from "./Avatar";
export type { AvatarSize } from "./Avatar";

export { Kbd, KbdChord } from "./Kbd";

/* ------------------------------------------------------------------ */
/* Lot 1 batch 2 — A-09/A-10/A-12/A-13/A-14/A-15/A-16/A-19/A-20     */
/* ------------------------------------------------------------------ */

export { OutputTable, fmt } from "./OutputTable";
export type { TableColumn, TableRow, OutputTableStatus } from "./OutputTable";

export { Metric } from "./Metric";
export type { MetricVariant } from "./Metric";

export { Modal } from "./Modal";
export type { ModalSize } from "./Modal";

export { Dropdown } from "./Dropdown";
export type { DropdownItem } from "./Dropdown";

export {
  ToastProvider,
  useToast,
} from "./Toast";
export type { ToastType, ToastItem } from "./Toast";

export {
  ShimmerBlock,
  SkeletonText,
  SkeletonRow,
  SkeletonBadge,
  SkeletonCard,
  SkeletonList,
  SkeletonOutputTable,
  useDelayedFlag,
} from "./Skeleton";

export {
  EmptyState,
  PreCalcEmptyState,
  NoCalcEmptyState,
  NoPvEmptyState,
  NetworkErrorEmptyState,
  FilterEmptyState,
} from "./EmptyState";
export type { EmptyVariant } from "./EmptyState";

export { Tooltip, TooltipRich } from "./Tooltip";

export {
  CommandPalette,
  CommandPaletteProvider,
  useCommandPalette,
  DEMO_COMMAND_ITEMS,
} from "./CommandPalette";
export type { CommandItem } from "./CommandPalette";
