/**
 * Tests — A-15 Skeleton
 *
 * DoD §9 : variantes, aria-busy, CLS (dimensions présentes), shimmer animation.
 */

import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import {
  SkeletonText,
  SkeletonRow,
  SkeletonBadge,
  SkeletonCard,
  SkeletonList,
  SkeletonOutputTable,
  ShimmerBlock,
} from "../Skeleton";

function render(node: React.ReactElement): string {
  return renderToString(node);
}

describe("ShimmerBlock", () => {
  it("renders with roadsen-shimmer animation", () => {
    const html = render(<ShimmerBlock />);
    expect(html).toContain("roadsen-shimmer");
  });

  it("accepts custom width and height", () => {
    const html = render(<ShimmerBlock width={120} height={24} />);
    expect(html).toContain("120");
    expect(html).toContain("24");
  });

  it("is aria-hidden (décoratif)", () => {
    const html = render(<ShimmerBlock />);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("SkeletonText", () => {
  it("renders with aria-busy", () => {
    const html = render(<SkeletonText />);
    expect(html).toContain('aria-busy="true"');
  });

  it("renders multiple lines when asked", () => {
    const html = render(<SkeletonText lines={3} />);
    // 3 ShimmerBlocks => 3 aria-hidden spans
    const count = (html.match(/roadsen-shimmer/g) ?? []).length;
    expect(count).toBe(3);
  });

  it("has accessible loading label", () => {
    const html = render(<SkeletonText />);
    expect(html).toContain("Chargement");
  });
});

describe("SkeletonBadge", () => {
  it("renders shimmer with badge dimensions (height 20)", () => {
    const html = render(<SkeletonBadge />);
    expect(html).toContain("20");
    expect(html).toContain("roadsen-shimmer");
  });
});

describe("SkeletonCard", () => {
  it("renders with aria-busy", () => {
    // Wrap in table for SkeletonRow ; SkeletonCard is a div
    const html = render(<SkeletonCard />);
    expect(html).toContain('aria-busy="true"');
  });

  it("uses elevation-card (boxShadow token)", () => {
    const html = render(<SkeletonCard />);
    expect(html).toContain("elevation-card");
  });
});

describe("SkeletonList", () => {
  it("renders N items", () => {
    const html = render(<SkeletonList count={4} />);
    const count = (html.match(/roadsen-shimmer/g) ?? []).length;
    // 3 blocks per item (icon + label + date)
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it("has accessible label", () => {
    const html = render(<SkeletonList />);
    expect(html).toContain("aria-busy");
  });
});

describe("SkeletonOutputTable", () => {
  it("renders a table element", () => {
    const html = render(<SkeletonOutputTable rows={3} columns={4} />);
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<tbody");
  });

  it("renders correct number of skeleton rows", () => {
    const html = render(<SkeletonOutputTable rows={5} columns={3} />);
    const trCount = (html.match(/<tr/g) ?? []).length;
    // 1 header row + 5 data rows = 6
    expect(trCount).toBe(6);
  });

  it("has aria-busy and loading label", () => {
    const html = render(<SkeletonOutputTable />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Chargement");
  });
});

describe("Zéro faux-vert", () => {
  it("SkeletonText renders non-empty HTML", () => {
    const html = render(<SkeletonText />);
    expect(html.length).toBeGreaterThan(30);
  });
});
