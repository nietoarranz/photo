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
import {
  GENERATED_LOCAL_PHOTO_CATEGORIES,
  GENERATED_LOCAL_PHOTO_KEYWORDS_BY_FILE,
} from "./generated/localPhotos.generated";

type Keyword = string;

const PRELOADED_IMAGE_URLS = new Set<string>();
function preloadImage(url: string) {
  if (PRELOADED_IMAGE_URLS.has(url)) return;
  PRELOADED_IMAGE_URLS.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

function positiveMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function toUint32(n: number): number {
  return n >>> 0;
}

function mix32(n: number): number {
  // Simple 32-bit avalanche hash finalizer to reduce visible patterns.
  let x = toUint32(n);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return toUint32(x);
}

function gridIndexForPosition(x: number, y: number): number {
  if (x === 0 && y === 0) return 0;
  const layer = Math.max(Math.abs(x), Math.abs(y));
  const innerLayersSize = (2 * layer - 1) ** 2;
  let positionInLayer = 0;

  if (y === 0 && x === layer) {
    positionInLayer = 0;
  } else if (y < 0 && x === layer) {
    positionInLayer = -y;
  } else if (y === -layer && x > -layer) {
    positionInLayer = layer + (layer - x);
  } else if (x === -layer && y < layer) {
    positionInLayer = 3 * layer + (layer + y);
  } else if (y === layer && x < layer) {
    positionInLayer = 5 * layer + (layer + x);
  } else {
    positionInLayer = 7 * layer + (layer - y);
  }

  return innerLayersSize + positionInLayer;
}

function intersectSortedUnique(a: readonly string[], b: readonly string[]) {
  let i = 0;
  let j = 0;
  const out: string[] = [];
  while (i < a.length && j < b.length) {
    const av = a[i]!;
    const bv = b[j]!;
    if (av === bv) {
      if (out[out.length - 1] !== av) out.push(av);
      i += 1;
      j += 1;
      continue;
    }
    if (av < bv) i += 1;
    else j += 1;
  }
  return out;
}

function localPhotoForCell(
  gridIndex: number,
  position: ItemConfig["position"],
  activeKeywords: readonly Keyword[],
  pool: readonly string[]
) {
  if (pool.length === 0) return null;
  // Salt so different pools look different even at same grid indices.
  const salt = pool.length * 2654435761;

  const kwSalt = activeKeywords.length * 1597334677;
  const hashFor = (gi: number, x: number, y: number, variant: number) =>
    mix32(
      gi * 374761393 +
        x * 668265263 +
        y * 2246822519 +
        salt +
        kwSalt +
        variant * 1013904223
    );

  const selfIdx0 = hashFor(gridIndex, position.x, position.y, 0) % pool.length;
  const selfIdx1 = hashFor(gridIndex, position.x, position.y, 1) % pool.length;
  const selfIdx2 = hashFor(gridIndex, position.x, position.y, 2) % pool.length;

  // Avoid obvious near-duplicates by steering away from the left/top neighbors.
  // We can compute their gridIndex deterministically from position (same spiral as `ThiingsGrid`).
  const leftX = position.x - 1;
  const topY = position.y - 1;
  const leftGi = gridIndexForPosition(leftX, position.y);
  const topGi = gridIndexForPosition(position.x, topY);

  const leftIdx0 = hashFor(leftGi, leftX, position.y, 0) % pool.length;
  const topIdx0 = hashFor(topGi, position.x, topY, 0) % pool.length;

  const forbidden = new Set<number>([leftIdx0, topIdx0]);
  const chosen =
    forbidden.has(selfIdx0) && !forbidden.has(selfIdx1)
      ? selfIdx1
      : forbidden.has(selfIdx0) && forbidden.has(selfIdx1) && !forbidden.has(selfIdx2)
        ? selfIdx2
        : selfIdx0;

  return { file: pool[chosen]! };
}

type PhotoCellProps = ItemConfig & {
  activeKeywords: readonly Keyword[];
  pool: readonly string[];
  onOpen: (src: string, fromRect: DOMRect, cellId: string) => void;
  isActive: boolean;
};

const OptimizedCell = memo(
  function OptimizedCell(props: PhotoCellProps) {
    const { gridIndex, position, activeKeywords, pool, onOpen, isActive } = props;

    const photo = useMemo(
      () => localPhotoForCell(gridIndex, position, activeKeywords, pool),
      [activeKeywords, gridIndex, pool, position.x, position.y]
    );

    const fullSrc = useMemo(() => {
      if (!photo) return null;
      // Allow nested folders like `nature/IMG_1234.jpg` without encoding the slash.
      const parts = photo.file.split("/").filter(Boolean);
      return `/my-photos/${parts.map(encodeURIComponent).join("/")}`;
    }, [photo]);

    const [isLoaded, setIsLoaded] = useState(false);
    useEffect(() => setIsLoaded(false), [fullSrc]);

    const thumbSrc = useMemo(() => {
      if (!photo) return null;
      const parts = photo.file.split("/").filter(Boolean);
      return `/my-photos-thumbs/${parts.map(encodeURIComponent).join("/")}`;
    }, [photo]);

    const [imgSrc, setImgSrc] = useState<string | null>(thumbSrc);
    useEffect(() => {
      setImgSrc(thumbSrc);
    }, [thumbSrc]);

    const enterDelayMs = useMemo(
      () => positiveMod(gridIndex * 73 + position.x * 29 + position.y * 41, 95),
      [gridIndex, position.x, position.y]
    );

    const staggerStyle = {
      "--enter-delay": `${enterDelayMs}ms`,
    } as CSSProperties;

    if (!fullSrc) {
      return (
        <div className="photo-cell" style={staggerStyle} aria-hidden="true" />
      );
    }

    return (
      <button
        type="button"
        className={
          isLoaded
            ? "photo-cell photo-cell--local photo-cell--loaded"
            : "photo-cell photo-cell--local"
        }
        style={staggerStyle}
        data-active={isActive ? "true" : "false"}
        onClick={(e) =>
          onOpen(
            fullSrc,
            e.currentTarget.getBoundingClientRect(),
            `${gridIndex}:${position.x},${position.y}`
          )
        }
        aria-label="Open photo"
      >
        <img
          src={imgSrc ?? fullSrc}
          alt=""
          decoding="async"
          draggable={false}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            // If a thumb is missing, fall back to the full-res asset.
            if (imgSrc === fullSrc) return;
            setImgSrc(fullSrc);
          }}
        />
      </button>
    );
  },
  (prev, next) =>
    prev.gridIndex === next.gridIndex &&
    prev.position.x === next.position.x &&
    prev.position.y === next.position.y &&
    prev.activeKeywords === next.activeKeywords &&
    prev.pool === next.pool &&
    prev.onOpen === next.onOpen
);

export default function AppLocal() {
  const [activeKeywords, setActiveKeywords] = useState<readonly Keyword[]>([]);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [filtersHasOverflow, setFiltersHasOverflow] = useState(false);
  const [collapsedVisibleCount, setCollapsedVisibleCount] = useState<number | null>(
    null
  );
  const filtersListRef = useRef<HTMLDivElement | null>(null);
  const filtersItemsRef = useRef<HTMLDivElement | null>(null);
  const filtersMeasureRef = useRef<HTMLDivElement | null>(null);
  const filtersMoreMeasureRef = useRef<HTMLButtonElement | null>(null);
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
    preloadImage(src);
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

  const allFiles = useMemo(
    () => GENERATED_LOCAL_PHOTO_CATEGORIES.flatMap((c) => c.files ?? []),
    []
  );

  const keywordOptions = useMemo(() => {
    const set = new Set<string>();
    for (const file of allFiles) {
      const kws = GENERATED_LOCAL_PHOTO_KEYWORDS_BY_FILE[file] ?? [];
      for (const kw of kws) set.add(kw);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allFiles]);

  const keywordsByFile = useMemo(() => {
    const map: Record<string, readonly string[]> = {};
    for (const file of allFiles) {
      const kws = GENERATED_LOCAL_PHOTO_KEYWORDS_BY_FILE[file] ?? [];
      map[file] = kws;
    }
    return map as Readonly<Record<string, readonly string[]>>;
  }, [allFiles]);

  const filesByKeyword = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const file of allFiles) {
      const kws = GENERATED_LOCAL_PHOTO_KEYWORDS_BY_FILE[file] ?? [];
      for (const kw of kws) {
        if (!map[kw]) map[kw] = [];
        map[kw]!.push(file);
      }
    }
    for (const kw of Object.keys(map)) map[kw]!.sort((a, b) => a.localeCompare(b));
    return map as Readonly<Record<string, readonly string[]>>;
  }, [allFiles]);

  const pool = useMemo(() => {
    if (activeKeywords.length === 0) return allFiles;
    const first = filesByKeyword[activeKeywords[0]!] ?? [];
    let acc = [...first];
    for (let i = 1; i < activeKeywords.length; i += 1) {
      const kw = activeKeywords[i]!;
      const list = filesByKeyword[kw] ?? [];
      acc = intersectSortedUnique(acc, list);
      if (acc.length === 0) break;
    }
    return acc;
  }, [activeKeywords, allFiles, filesByKeyword]);

  const visibleKeywordOptions = useMemo(() => {
    const set = new Set<string>();
    for (const file of pool) {
      const kws = keywordsByFile[file] ?? [];
      for (const kw of kws) set.add(kw);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [keywordsByFile, pool]);

  useLayoutEffect(() => {
    const listEl = filtersListRef.current;
    const itemsEl = filtersItemsRef.current;
    const measureEl = filtersMeasureRef.current;
    const moreMeasureEl = filtersMoreMeasureRef.current;
    if (!listEl || !itemsEl || !measureEl || !moreMeasureEl) return;

    const computeCollapsedOverflow = () => {
      // Only evaluate overflow in the collapsed layout (single row).
      // When expanded we allow wrapping, so horizontal overflow often disappears,
      // and we must not auto-collapse due to that.
      if (filtersExpanded) return;

      const measureButtons = Array.from(
        measureEl.querySelectorAll<HTMLButtonElement>("button[data-kw]")
      );
      const gapPx = Number.parseFloat(getComputedStyle(itemsEl).columnGap || "0");
      const totalWidth =
        measureButtons.reduce((acc, b) => acc + b.offsetWidth, 0) +
        Math.max(0, measureButtons.length - 1) * (Number.isFinite(gapPx) ? gapPx : 0);

      const moreWidth = moreMeasureEl.offsetWidth;
      const itemsAvailableWidth =
        totalWidth > listEl.clientWidth + 1
          ? Math.max(
              0,
              listEl.clientWidth - moreWidth - (Number.isFinite(gapPx) ? gapPx : 0)
            )
          : listEl.clientWidth;

      const hasOverflow = totalWidth > listEl.clientWidth + 1;
      setFiltersHasOverflow(hasOverflow);

      if (!hasOverflow) {
        setCollapsedVisibleCount(null);
        return;
      }

      let used = 0;
      let count = 0;
      for (let i = 0; i < measureButtons.length; i += 1) {
        const w = measureButtons[i]!.offsetWidth;
        const next = count === 0 ? w : used + (Number.isFinite(gapPx) ? gapPx : 0) + w;
        if (next > itemsAvailableWidth + 1) break;
        used = next;
        count += 1;
      }
      setCollapsedVisibleCount(count);
    };

    computeCollapsedOverflow();
    const ro = new ResizeObserver(computeCollapsedOverflow);
    ro.observe(listEl);
    ro.observe(itemsEl);
    ro.observe(measureEl);
    return () => ro.disconnect();
  }, [filtersExpanded, visibleKeywordOptions]);

  // If keywords change (generator rerun) and some active ones no longer exist, drop them.
  const normalizedActiveKeywords = useMemo(() => {
    if (activeKeywords.length === 0) return activeKeywords;
    const existing = new Set(keywordOptions);
    const next = activeKeywords.filter((k) => existing.has(k));
    return next.length === activeKeywords.length ? activeKeywords : next;
  }, [activeKeywords, keywordOptions]);

  useEffect(() => {
    if (normalizedActiveKeywords === activeKeywords) return;
    if (normalizedActiveKeywords.length === activeKeywords.length) return;
    setActiveKeywords(normalizedActiveKeywords);
  }, [activeKeywords, normalizedActiveKeywords]);

  const toggleKeyword = useCallback((kw: Keyword) => {
    setActiveKeywords((prev) => {
      const has = prev.includes(kw);
      const next = has ? prev.filter((k) => k !== kw) : [...prev, kw];
      return next.sort((a, b) => a.localeCompare(b));
    });
  }, []);

  const renderPhotoCell = useCallback(
    (config: ItemConfig) => (
      <OptimizedCell
        {...config}
        activeKeywords={normalizedActiveKeywords}
        pool={pool}
        onOpen={openPhoto}
        isActive={
          activeCellId === `${config.gridIndex}:${config.position.x},${config.position.y}`
        }
      />
    ),
    [activeCellId, normalizedActiveKeywords, openPhoto, pool]
  );

  const hasAnyPhotos = useMemo(
    () => allFiles.length > 0,
    [allFiles.length]
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row app-header-row--main">
          <div className="app-header-text">
            <h1>Enrique Nieto</h1>
            {!hasAnyPhotos ? (
              <p>
                Add image files to <code>public/my-photos/</code> and restart the
                dev server.
              </p>
            ) : null}
          </div>
        </div>
      </header>
      {activePhotoSrc ? (
        <div
          className={backdropOpen ? "lightbox lightbox--backdrop" : "lightbox"}
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
          key={normalizedActiveKeywords.join("|") || "all"}
          className="thiings-layer"
          gridSize={gridSize}
          renderItem={renderPhotoCell}
        />
      </div>
      <footer className="app-footer">
        <div className="app-footer-row">
          <div className="app-footer-filters">
            <div
              className={
                filtersExpanded
                  ? "filter-bar filter-bar--collapsible filter-bar--expanded"
                  : "filter-bar filter-bar--collapsible"
              }
              role="toolbar"
              aria-label="Filter photos by type"
            >
              <div
                ref={filtersListRef}
                className="filter-list"
                role="group"
                aria-label="Keyword filters"
                data-expanded={filtersExpanded ? "true" : "false"}
              >
                <div ref={filtersItemsRef} className="filter-list-items">
                  {(filtersExpanded || !filtersHasOverflow || collapsedVisibleCount === null
                    ? visibleKeywordOptions
                    : visibleKeywordOptions.slice(0, collapsedVisibleCount)
                  ).map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      className={
                        normalizedActiveKeywords.includes(kw)
                          ? "filter-btn filter-btn--active"
                          : "filter-btn"
                      }
                      onClick={() => toggleKeyword(kw)}
                      aria-pressed={normalizedActiveKeywords.includes(kw)}
                    >
                      {kw}
                    </button>
                  ))}
                </div>

                {!filtersExpanded && filtersHasOverflow ? (
                  <button
                    type="button"
                    className="filter-btn filter-btn--more"
                    onClick={() => setFiltersExpanded(true)}
                    aria-label="Show all filters"
                    aria-expanded="false"
                  >
                    ...
                  </button>
                ) : null}

                <div ref={filtersMeasureRef} className="filter-list-measure" aria-hidden="true">
                  {visibleKeywordOptions.map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      className={
                        normalizedActiveKeywords.includes(kw)
                          ? "filter-btn filter-btn--active"
                          : "filter-btn"
                      }
                      data-kw="true"
                      tabIndex={-1}
                    >
                      {kw}
                    </button>
                  ))}
                  <button
                    ref={filtersMoreMeasureRef}
                    type="button"
                    className="filter-btn filter-btn--more"
                    tabIndex={-1}
                  >
                    ...
                  </button>
                </div>
              </div>

              <div className="filter-actions" aria-label="Filter actions">
                {filtersExpanded && filtersHasOverflow ? (
                  <button
                    type="button"
                    className="filter-btn filter-btn--collapse"
                    onClick={() => setFiltersExpanded(false)}
                    aria-label="Collapse filters"
                  >
                    Collapse
                  </button>
                ) : null}
                {normalizedActiveKeywords.length > 0 ? (
                  <button
                    type="button"
                    className="filter-btn filter-btn--clear"
                    onClick={() => setActiveKeywords([])}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
