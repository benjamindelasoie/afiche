// Afiche UI primitives — the shared design-system layer.
//
// Presentational, domain-agnostic building blocks composed by the pages and
// the domain components in ../. Tokens (Caps, Pill) and class-recipe helpers
// (focusRing, hoverRail) sit at the bottom; layout primitives (PageShell,
// ContentColumn) and shared chrome (PageFooter, BackLink, NotFoundShell,
// StretchedLink) build on them.
export { Caps } from './Caps';
export { Pill } from './Pill';
export { SectionHeading } from './SectionHeading';
export { StretchedLink } from './StretchedLink';
export { focusRing, hoverRail } from './recipes';
export { PageShell, LAYOUT_WIDTHS } from './PageShell';
export { ContentColumn } from './ContentColumn';
export { PageFooter } from './PageFooter';
export { BackLink } from './BackLink';
export { NotFoundShell } from './NotFoundShell';
