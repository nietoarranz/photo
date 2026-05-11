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

const APP_BASE_URL = import.meta.env.BASE_URL;

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
  onOpen: (
    fullSrc: string,
    fromRect: DOMRect,
    cellId: string,
    previewSrc?: string
  ) => void;
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
      return `${APP_BASE_URL}my-photos/${parts.map(encodeURIComponent).join("/")}`;
    }, [photo]);

    const [isLoaded, setIsLoaded] = useState(false);
    useEffect(() => setIsLoaded(false), [fullSrc]);

    const thumbSrc = useMemo(() => {
      if (!photo) return null;
      const parts = photo.file.split("/").filter(Boolean);
      return `${APP_BASE_URL}my-photos-thumbs/${parts.map(encodeURIComponent).join("/")}`;
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
            `${gridIndex}:${position.x},${position.y}`,
            imgSrc ?? fullSrc
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

type FiniteLocalCellProps = {
  file: string;
  index: number;
  onOpen: (
    fullSrc: string,
    fromRect: DOMRect,
    cellId: string,
    previewSrc?: string
  ) => void;
  isActive: boolean;
};

const FiniteLocalCell = memo(function FiniteLocalCell(props: FiniteLocalCellProps) {
  const { file, index, onOpen, isActive } = props;

  const fullSrc = useMemo(() => {
    const parts = file.split("/").filter(Boolean);
    return `${APP_BASE_URL}my-photos/${parts.map(encodeURIComponent).join("/")}`;
  }, [file]);

  const thumbSrc = useMemo(() => {
    const parts = file.split("/").filter(Boolean);
    return `${APP_BASE_URL}my-photos-thumbs/${parts.map(encodeURIComponent).join("/")}`;
  }, [file]);

  const [isLoaded, setIsLoaded] = useState(false);
  useEffect(() => setIsLoaded(false), [fullSrc]);

  const [imgSrc, setImgSrc] = useState<string | null>(thumbSrc);
  useEffect(() => {
    setImgSrc(thumbSrc);
  }, [thumbSrc]);

  const enterDelayMs = useMemo(() => positiveMod(index * 73, 95), [index]);
  const staggerStyle = useMemo(
    () =>
      ({
        "--enter-delay": `${enterDelayMs}ms`,
      }) as CSSProperties,
    [enterDelayMs]
  );

  return (
    <button
      type="button"
      className={
        isLoaded ? "photo-cell photo-cell--local photo-cell--loaded" : "photo-cell photo-cell--local"
      }
      style={staggerStyle}
      data-active={isActive ? "true" : "false"}
      onClick={(e) =>
        onOpen(fullSrc, e.currentTarget.getBoundingClientRect(), `file:${file}`, imgSrc ?? fullSrc)
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
          if (imgSrc === fullSrc) return;
          setImgSrc(fullSrc);
        }}
      />
    </button>
  );
});

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
  const activePhotoFullSrcRef = useRef<string | null>(null);
  const [gridSize, setGridSize] = useState(() =>
    window.innerWidth <= 720 ? 150 : 300
  );
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));

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
    const onResize = () => {
      setGridSize(window.innerWidth <= 720 ? 150 : 300);
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
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

  const openPhoto = useCallback(
    (fullSrc: string, rect: DOMRect, cellId: string, previewSrc?: string) => {
    closeAfterAnimRef.current = false;
    preloadImage(fullSrc);
    setFromRect(rect);
    setActiveCellId(cellId);
    setBackdropOpen(false);
    activePhotoFullSrcRef.current = fullSrc;
    setActivePhotoSrc(previewSrc ?? fullSrc);

    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (activePhotoFullSrcRef.current !== fullSrc) return;
      setActivePhotoSrc(fullSrc);
    };
    img.src = fullSrc;
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
    activePhotoFullSrcRef.current = null;
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

  const useFiniteGrid = useMemo(() => {
    if (normalizedActiveKeywords.length === 0) return false;
    if (pool.length === 0) return true;

    const padX = 24 * 2;
    const padY = 24 * 2;
    const usableW = Math.max(0, viewport.w - padX);
    const usableH = Math.max(0, viewport.h - padY);
    const cellsX = Math.max(1, Math.floor(usableW / gridSize));
    const cellsY = Math.max(1, Math.floor(usableH / gridSize));
    const capacity = cellsX * cellsY;
    return pool.length <= capacity;
  }, [gridSize, normalizedActiveKeywords.length, pool.length, viewport.h, viewport.w]);

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
            <h1>
              <span className="app-header-title-lockup">
                <svg
                  className="app-header-title-icon"
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <path
                    d="M2.86536 12.4126C2.86536 12.1602 2.82341 11.9321 2.73952 11.7283C2.65563 11.5196 2.53719 11.3425 2.38421 11.1969C2.23617 11.0513 2.05605 10.9397 1.84385 10.862C1.63659 10.7795 1.40959 10.7383 1.16285 10.7383H1V9.93751H1.24427C1.48114 9.9278 1.69828 9.8817 1.89567 9.7992C2.09306 9.71669 2.26331 9.60265 2.40642 9.45705C2.54953 9.31146 2.66056 9.13917 2.73952 8.9402C2.82341 8.73637 2.86536 8.5107 2.86536 8.26319V5.56972C2.86536 5.19603 2.92951 4.85389 3.05782 4.54329C3.19106 4.22783 3.37364 3.95606 3.60558 3.72797C3.84245 3.49987 4.1188 3.32273 4.43463 3.19655C4.75539 3.06552 5.10083 3 5.47094 3H5.54496V3.80804H5.47094C5.2242 3.80804 4.9972 3.84929 4.78994 3.9318C4.58267 4.00945 4.40255 4.12107 4.24957 4.26666C4.10153 4.41225 3.98556 4.58939 3.90167 4.79807C3.81778 5.0019 3.77583 5.22757 3.77583 5.47508V8.17583C3.77583 8.64658 3.66973 9.07123 3.45754 9.44977C3.25027 9.82832 2.97146 10.1244 2.62109 10.3379C2.97146 10.5611 3.25027 10.8596 3.45754 11.2333C3.66973 11.607 3.77583 12.0292 3.77583 12.4999V15.2007C3.77583 15.4482 3.81778 15.6739 3.90167 15.8777C3.98556 16.0864 4.10153 16.2635 4.24957 16.4091C4.40255 16.5547 4.58267 16.6663 4.78994 16.744C4.9972 16.8265 5.2242 16.8677 5.47094 16.8677H5.54496V17.6758H5.47094C5.10083 17.6758 4.75539 17.6103 4.43463 17.4792C4.1188 17.3531 3.84245 17.1759 3.60558 16.9478C3.37364 16.7197 3.19106 16.4479 3.05782 16.1325C2.92951 15.8219 2.86536 15.4798 2.86536 15.1061V12.4126Z"
                    fill="black"
                  />
                  <path
                    d="M9.32009 14.6911V9.23138C9.32009 9.05182 9.28555 8.88439 9.21646 8.72909C9.14738 8.56893 9.05361 8.43062 8.93518 8.31415C8.81674 8.19767 8.6761 8.10546 8.51325 8.03752C8.35534 7.96958 8.18509 7.93561 8.0025 7.93561H7.39552C7.21293 7.93561 7.04021 7.96958 6.87736 8.03752C6.71945 8.10546 6.58127 8.19767 6.46284 8.31415C6.3444 8.43062 6.25064 8.56893 6.18155 8.72909C6.11247 8.88439 6.07792 9.05182 6.07792 9.23138V14.6911H5.16745V7.23676H5.47094L5.96689 7.99384C6.17415 7.71722 6.43323 7.49883 6.74412 7.33867C7.05995 7.17367 7.40292 7.09117 7.77303 7.09117H8.0025C8.30846 7.09117 8.59714 7.1494 8.86856 7.26588C9.13997 7.3775 9.37684 7.5328 9.57917 7.73177C9.7815 7.93075 9.93941 8.1637 10.0529 8.43062C10.1713 8.69754 10.2306 8.98145 10.2306 9.28234V14.6911H9.32009Z"
                    fill="black"
                  />
                  <path
                    d="M14.4424 12.2597H11.0818L10.386 14.6911H9.39412L12.503 4.2521H13.0064L16.1301 14.6911H15.1456L14.4424 12.2597ZM11.3409 11.3643H14.1908L12.7917 6.55247L12.7621 6.16665L12.7325 6.55247L11.3409 11.3643Z"
                    fill="black"
                  />
                  <path
                    d="M17.6698 15.1061C17.6698 15.4798 17.6032 15.8219 17.4699 16.1325C17.3416 16.4479 17.159 16.7197 16.9222 16.9478C16.6902 17.1759 16.4139 17.3531 16.0931 17.4792C15.7773 17.6103 15.4343 17.6758 15.0642 17.6758H14.9902V16.8677H15.0642C15.311 16.8677 15.538 16.8265 15.7452 16.744C15.9525 16.6663 16.1326 16.5547 16.2856 16.4091C16.4386 16.2635 16.557 16.0864 16.6409 15.8777C16.7248 15.6739 16.7667 15.4482 16.7667 15.2007V12.4999C16.7667 12.0292 16.8679 11.607 17.0702 11.2333C17.2775 10.8596 17.5588 10.5611 17.9141 10.3379C17.5588 10.1195 17.2775 9.82346 17.0702 9.44977C16.8679 9.07123 16.7667 8.64658 16.7667 8.17583V5.47508C16.7667 5.22757 16.7248 5.0019 16.6409 4.79807C16.557 4.58939 16.4386 4.41225 16.2856 4.26666C16.1326 4.12107 15.9525 4.00945 15.7452 3.9318C15.538 3.84929 15.311 3.80804 15.0642 3.80804H14.9902V3H15.0642C15.4343 3 15.7773 3.06552 16.0931 3.19655C16.4139 3.32273 16.6902 3.49987 16.9222 3.72797C17.159 3.95606 17.3416 4.22783 17.4699 4.54329C17.6032 4.85389 17.6698 5.19603 17.6698 5.56972V8.26319C17.6698 8.51555 17.7117 8.74607 17.7956 8.95476C17.8795 9.15859 17.998 9.3333 18.1509 9.47889C18.3039 9.62448 18.484 9.73853 18.6913 9.82104C18.8986 9.89869 19.1256 9.93751 19.3723 9.93751H19.5352V10.7383H19.2983C19.0614 10.7431 18.8418 10.7892 18.6395 10.8766C18.4421 10.9591 18.2694 11.0756 18.1213 11.226C17.9782 11.3716 17.8672 11.5463 17.7882 11.7501C17.7093 11.9491 17.6698 12.1699 17.6698 12.4126V15.1061Z"
                    fill="black"
                  />
                </svg>
                Enrique Nieto Arranz //
              </span>
              <span className="app-header-title-photo">photo</span>
            </h1>
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
        {useFiniteGrid ? (
          <div className="finite-grid-shell">
            <div
              className="finite-grid"
              style={
                {
                  "--cell-size": `${gridSize}px`,
                } as CSSProperties
              }
            >
              {pool.map((file, index) => (
                <div key={file} className="finite-grid-cell">
                  <FiniteLocalCell
                    file={file}
                    index={index}
                    onOpen={openPhoto}
                    isActive={activeCellId === `file:${file}`}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ThiingsGrid
            key={normalizedActiveKeywords.join("|") || "all"}
            className="thiings-layer"
            gridSize={gridSize}
            renderItem={renderPhotoCell}
          />
        )}
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
