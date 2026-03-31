import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import ThiingsGrid, { type ItemConfig } from "../lib/ThiingsGrid";

/**
 * Lorem Picsum — `id/{n}` addresses one catalog photo. (`seed/` can collide:
 * different seeds sometimes resolve to the same image.)
 * https://picsum.photos/
 */
const PICSUM_W = 1600;
const PICSUM_H = 1067;

/** Globally unique catalog ids (non-overlapping slices → no duplicate URLs across categories). */
const PICSUM_MASTER_IDS: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77,
  78, 79, 80, 81, 82, 83, 84, 85, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 98,
  99, 100, 101, 102, 103, 104, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
  116, 117, 118,
];

/** Original pool sizes × 4 — many distinct images per category. */
const PHOTO_CATEGORY_SPECS = [
  { id: "nature" as const, label: "Nature", baseCount: 8 },
  { id: "ocean" as const, label: "Ocean", baseCount: 6 },
  { id: "urban" as const, label: "Urban", baseCount: 5 },
  { id: "architecture" as const, label: "Architecture", baseCount: 5 },
  { id: "minimal" as const, label: "Minimal", baseCount: 5 },
] as const;

const POOL_MULTIPLIER = 4;

type CategoryId = (typeof PHOTO_CATEGORY_SPECS)[number]["id"];

function idUrl(id: number): string {
  return `https://picsum.photos/id/${id}/${PICSUM_W}/${PICSUM_H}`;
}

function buildCategories(): {
  id: CategoryId;
  label: string;
  images: string[];
}[] {
  let offset = 0;
  return PHOTO_CATEGORY_SPECS.map((spec) => {
    const n = spec.baseCount * POOL_MULTIPLIER;
    const slice = PICSUM_MASTER_IDS.slice(offset, offset + n);
    if (slice.length < n) {
      throw new Error(
        `PICSUM_MASTER_IDS too short: need ${offset + n}, have ${PICSUM_MASTER_IDS.length}`
      );
    }
    offset += n;
    return {
      id: spec.id,
      label: spec.label,
      images: slice.map(idUrl),
    };
  });
}

const PHOTO_CATEGORIES = buildCategories();
type ActiveFilter = "all" | CategoryId;

const PRELOADED_IMAGE_URLS = new Set<string>();
function preloadImage(url: string) {
  if (PRELOADED_IMAGE_URLS.has(url)) return;
  PRELOADED_IMAGE_URLS.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

function cellCategoryIndex(gridIndex: number): number {
  const n = PHOTO_CATEGORIES.length;
  return ((gridIndex % n) + n) % n;
}

function toUint32(n: number): number {
  return n >>> 0;
}

/** Mix grid + tile position so neighbors rarely share the same pool slot (and URLs are unique per id). */
function imageForCell(
  gridIndex: number,
  position: ItemConfig["position"]
): string {
  const catIdx = cellCategoryIndex(gridIndex);
  const cat = PHOTO_CATEGORIES[catIdx]!;
  const urls = cat.images;
  const mix = toUint32(
    gridIndex * 374761393 +
      position.x * 668265263 +
      position.y * 2246822519 +
      catIdx * 3266489917
  );
  return urls[mix % urls.length]!;
}

function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function categoryById(id: CategoryId) {
  return PHOTO_CATEGORIES.find((c) => c.id === id)!;
}

/** Infinite single-category tiles: same mixing as `imageForCell` so neighbors differ. */
function imageForFilteredSlot(
  position: ItemConfig["position"],
  gridIndex: number,
  categoryId: CategoryId
): string {
  const urls = categoryById(categoryId).images;
  const catIdx = PHOTO_CATEGORIES.findIndex((c) => c.id === categoryId);
  const mix = toUint32(
    gridIndex * 374761393 +
      position.x * 668265263 +
      position.y * 2246822519 +
      catIdx * 3266489917
  );
  return urls[mix % urls.length]!;
}

function cellImageSrc(
  gridIndex: number,
  position: ItemConfig["position"],
  activeFilter: ActiveFilter
): string {
  return activeFilter === "all"
    ? imageForCell(gridIndex, position)
    : imageForFilteredSlot(position, gridIndex, activeFilter);
}

type PhotoCellProps = ItemConfig & {
  activeFilter: ActiveFilter;
  onOpen: (src: string, fromRect: DOMRect, cellId: string) => void;
  isActive: boolean;
};

const OptimizedCell = memo(
  function OptimizedCell(props: PhotoCellProps) {
    const { gridIndex, position, activeFilter, onOpen, isActive } = props;
    const src = useMemo(
      () => cellImageSrc(gridIndex, position, activeFilter),
      [activeFilter, gridIndex, position.x, position.y]
    );

    useEffect(() => {
      preloadImage(src);
    }, [src]);

    /** Stagger so neighboring cells don’t pop in in perfect sync (each cell is independent). */
    const enterDelayMs = useMemo(
      () =>
        positiveMod(gridIndex * 73 + position.x * 29 + position.y * 41, 95),
      [gridIndex, position.x, position.y]
    );

    const staggerStyle = {
      "--enter-delay": `${enterDelayMs}ms`,
    } as CSSProperties;

    return (
      <button
        type="button"
        className="photo-cell"
        style={staggerStyle}
        data-active={isActive ? "true" : "false"}
        onClick={(e) =>
          onOpen(
            src,
            e.currentTarget.getBoundingClientRect(),
            `${gridIndex}:${position.x},${position.y}`
          )
        }
        aria-label="Open photo"
      >
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      </button>
    );
  },
  (prev, next) =>
    prev.gridIndex === next.gridIndex &&
    prev.position.x === next.position.x &&
    prev.position.y === next.position.y &&
    prev.activeFilter === next.activeFilter &&
    prev.onOpen === next.onOpen
);

export default function App() {
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [activePhotoSrc, setActivePhotoSrc] = useState<string | null>(null);
  const [fromRect, setFromRect] = useState<DOMRect | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [backdropOpen, setBackdropOpen] = useState(false);
  const [activeCellId, setActiveCellId] = useState<string | null>(null);
  const closeAfterAnimRef = useRef(false);
  const closePendingCountRef = useRef(0);
  const [gridSize, setGridSize] = useState(() =>
    window.innerWidth <= 720 ? 150 : 300
  );

  const [targetSize, setTargetSize] = useState(() => {
    // Matches `.lightbox-content` padding so the detail view never overflows.
    const pad = 100;
    const w = Math.min(1100, Math.max(320, window.innerWidth - pad * 2));
    const h = Math.min(900, Math.max(240, window.innerHeight * 0.8));
    return { w, h };
  });

  const initialTransform = useMemo(() => {
    if (!fromRect) return null;
    const viewportCx = window.innerWidth / 2;
    const viewportCy = window.innerHeight / 2;
    const fromCx = fromRect.left + fromRect.width / 2;
    const fromCy = fromRect.top + fromRect.height / 2;
    const dx = fromCx - viewportCx;
    const dy = fromCy - viewportCy;
    // Use "cover" scaling so a square tile expands smoothly into a rectangular viewer
    // without looking smaller in one axis (and without non-uniform stretching).
    const s = Math.max(fromRect.width / targetSize.w, fromRect.height / targetSize.h);
    return { dx, dy, sx: s, sy: s };
  }, [fromRect, targetSize.h, targetSize.w]);

  useEffect(() => {
    if (!activePhotoSrc) return;
    const onResize = () => {
      const pad = 100;
      const w = Math.min(1100, Math.max(320, window.innerWidth - pad * 2));
      const h = Math.min(900, Math.max(240, window.innerHeight * 0.8));
      setTargetSize({ w, h });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeAfterAnimRef.current = true;
        setLightboxOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [activePhotoSrc]);

  useEffect(() => {
    const onResize = () => setGridSize(window.innerWidth <= 720 ? 150 : 300);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    if (!activePhotoSrc) return;
    requestAnimationFrame(() => {
      setBackdropOpen(true);
      setLightboxOpen(true);
    });
  }, [activePhotoSrc]);

  const openPhoto = useCallback((src: string, rect: DOMRect, cellId: string) => {
    closeAfterAnimRef.current = false;
    setFromRect(rect);
    setActiveCellId(cellId);
    setBackdropOpen(false);
    setActivePhotoSrc(src);
  }, []);

  const closePhoto = useCallback(() => {
    closeAfterAnimRef.current = true;
    closePendingCountRef.current = 2;
    setLightboxOpen(false);
    setBackdropOpen(false);
  }, []);

  const finishCloseIfReady = useCallback(() => {
    if (!closeAfterAnimRef.current) return;
    closePendingCountRef.current -= 1;
    if (closePendingCountRef.current > 0) return;
    setActivePhotoSrc(null);
    setFromRect(null);
    setActiveCellId(null);
    closeAfterAnimRef.current = false;
  }, []);

  const onLightboxTransformEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== "transform") return;
      finishCloseIfReady();
    },
    [finishCloseIfReady]
  );

  const onBackdropTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.propertyName !== "background-color") return;
      finishCloseIfReady();
    },
    [finishCloseIfReady]
  );

  const renderPhotoCell = useCallback(
    (config: ItemConfig) => (
      <OptimizedCell
        {...config}
        activeFilter={activeFilter}
        onOpen={openPhoto}
        isActive={
          activeCellId === `${config.gridIndex}:${config.position.x},${config.position.y}`
        }
      />
    ),
    [activeCellId, activeFilter, openPhoto]
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row app-header-row--main">
          <div className="app-header-text">
            <h1>Enrique Nieto</h1>
          </div>
          <div className="app-header-filters">
            <div
              className="filter-bar"
              role="toolbar"
              aria-label="Filter photos by type"
            >
              <button
                type="button"
                className={
                  activeFilter === "all"
                    ? "filter-btn filter-btn--active"
                    : "filter-btn"
                }
                onClick={() => setActiveFilter("all")}
                aria-pressed={activeFilter === "all"}
              >
                All
              </button>
              {PHOTO_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={
                    activeFilter === cat.id
                      ? "filter-btn filter-btn--active"
                      : "filter-btn"
                  }
                  onClick={() => setActiveFilter(cat.id)}
                  aria-pressed={activeFilter === cat.id}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>
      {activePhotoSrc ? (
        <div
          className={
            backdropOpen ? "lightbox lightbox--backdrop" : "lightbox"
          }
          role="dialog"
          aria-modal="true"
          aria-label="Photo detail"
          onMouseDown={closePhoto}
          onTransitionEnd={onBackdropTransitionEnd}
        >
          <button
            type="button"
            className="lightbox-close"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={closePhoto}
            aria-label="Close"
            data-open={backdropOpen ? "true" : "false"}
          >
            Close
          </button>
          <div
            className="lightbox-content"
            onMouseDown={(e) => e.stopPropagation()}
            style={
              initialTransform
                ? ({
                    width: `${targetSize.w}px`,
                    height: `${targetSize.h}px`,
                    "--lb-dx": `${initialTransform.dx}px`,
                    "--lb-dy": `${initialTransform.dy}px`,
                    "--lb-sx": `${initialTransform.sx}`,
                    "--lb-sy": `${initialTransform.sy}`,
                  } as CSSProperties)
                : ({
                    width: `${targetSize.w}px`,
                    height: `${targetSize.h}px`,
                  } as CSSProperties)
            }
            data-open={lightboxOpen ? "true" : "false"}
            onTransitionEnd={onLightboxTransformEnd}
          >
            <div className="lightbox-content-inner">
              <img src={activePhotoSrc} alt="" />
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid-shell">
        <ThiingsGrid
          key={activeFilter}
          className="thiings-layer"
          gridSize={gridSize}
          renderItem={renderPhotoCell}
        />
      </div>
    </div>
  );
}
