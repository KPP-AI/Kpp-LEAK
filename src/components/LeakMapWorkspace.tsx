import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import L from 'leaflet';
import {
  AlertTriangle,
  Camera,
  Crosshair,
  Edit3,
  Layers,
  LocateFixed,
  Maximize2,
  Minimize2,
  Scan,
  X,
} from 'lucide-react';
import {
  formatPipeSpec,
  LeakPhoto,
  LeakPoint,
  parsePipeSpec,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
} from '../types/leak';
import {PlaceSearchBox} from './PlaceSearchBox';

export type MapTypeOption = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

const MAP_TYPE_OPTIONS: {id: MapTypeOption; label: string}[] = [
  {id: 'roadmap', label: 'แผนที่'},
  {id: 'satellite', label: 'ดาวเทียม'},
  {id: 'hybrid', label: 'ไฮบริด'},
  {id: 'terrain', label: 'ภูมิประเทศ'},
];

const DEFAULT_CENTER: [number, number] = [13.8195, 100.519];
const DEFAULT_ZOOM = 14;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createLeakPinIcon(
  bg: string,
  border: string,
  glyphColor: string,
  glyph: string,
  isSelected: boolean
): L.DivIcon {
  const scale = isSelected ? 1.24 : 1;
  const width = Math.round(32 * scale);
  const height = Math.round(42 * scale);
  const safeGlyph = escapeHtml(glyph);
  const fontSize = safeGlyph.length >= 3 ? 9.5 : 11.5;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 32 42" style="overflow:visible;filter:drop-shadow(0 3px 5px rgba(15,23,42,0.38));">
      ${
        isSelected
          ? `<circle cx="16" cy="16" r="16" fill="${bg}" fill-opacity="0.22" />`
          : ''
      }
      <path d="M16 1.5C8.544 1.5 2.5 7.544 2.5 15c0 9.8 13.5 25 13.5 25S29.5 24.8 29.5 15C29.5 7.544 23.456 1.5 16 1.5z" fill="${bg}" stroke="${border}" stroke-width="2" />
      <text x="16" y="18.5" text-anchor="middle" fill="${glyphColor}" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-weight="700" font-size="${fontSize}">${safeGlyph}</text>
    </svg>
  `;

  return L.divIcon({
    html: svg,
    className: 'hydropin-leaflet-pin',
    iconSize: [width, height],
    iconAnchor: [Math.round(width / 2), height - 2],
  });
}

function createAuxiliaryPinIcon(
  bg: string,
  border: string,
  label: string
): L.DivIcon {
  const safeLabel = escapeHtml(label);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 32 42" style="filter:drop-shadow(0 3px 5px rgba(15,23,42,0.38));">
      <path d="M16 1.5C8.544 1.5 2.5 7.544 2.5 15c0 9.8 13.5 25 13.5 25S29.5 24.8 29.5 15C29.5 7.544 23.456 1.5 16 1.5z" fill="${bg}" stroke="${border}" stroke-width="2" />
      <circle cx="16" cy="15" r="4.5" fill="#ffffff" />
      <title>${safeLabel}</title>
    </svg>
  `;
  return L.divIcon({
    html: svg,
    className: 'hydropin-leaflet-aux-pin',
    iconSize: [30, 40],
    iconAnchor: [15, 38],
  });
}

function buildEsriLayers(
  mode: MapTypeOption,
  theme: 'day' | 'night'
): L.TileLayer[] {
  if (mode === 'satellite') {
    return [
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          maxNativeZoom: 18,
          attribution: 'Tiles &copy; Esri',
        }
      ),
    ];
  }

  if (mode === 'hybrid') {
    return [
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          maxNativeZoom: 18,
          attribution: 'Tiles &copy; Esri',
        }
      ),
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          maxNativeZoom: 18,
          attribution: 'Roads &copy; Esri',
        }
      ),
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          maxNativeZoom: 18,
          attribution: 'Labels &copy; Esri',
        }
      ),
    ];
  }

  if (mode === 'terrain') {
    return [
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          maxNativeZoom: 17,
          attribution: 'Tiles &copy; Esri',
        }
      ),
    ];
  }

  // 'roadmap'
  if (theme === 'night') {
    return [
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          maxNativeZoom: 16,
          attribution: 'Tiles &copy; Esri',
        }
      ),
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 20,
          maxNativeZoom: 16,
          attribution: 'Labels &copy; Esri',
        }
      ),
    ];
  }

  return [
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 20,
        maxNativeZoom: 17,
        attribution: 'Tiles &copy; Esri',
      }
    ),
  ];
}

interface LeakMapWorkspaceProps {
  leaks: LeakPoint[];
  selectedId: string | null;
  isPickingLocation: boolean;
  pickingReason: 'new' | 'edit';
  focusTarget: {lat: number; lng: number; zoom?: number; seq: number} | null;
  fitBoundsSeq?: number;
  draftPin: {lat: number; lng: number} | null;
  theme?: 'day' | 'night';
  onSelectLeak: (id: string | null) => void;
  onPickMapLocation: (lat: number, lng: number) => void;
  onStartPickNew: () => void;
  onCancelPick: () => void;
  onEditLeak: (leak: LeakPoint) => void;
  onUpdatePosition: (id: string, lat: number, lng: number) => void;
  onOpenLightbox: (photos: LeakPhoto[], index: number, title: string) => void;
  onPanToLocation: (lat: number, lng: number, zoom?: number) => void;
}

export const LeakMapWorkspace: React.FC<LeakMapWorkspaceProps> = ({
  leaks,
  selectedId,
  isPickingLocation,
  pickingReason,
  focusTarget,
  fitBoundsSeq = 0,
  draftPin,
  theme = 'day',
  onSelectLeak,
  onPickMapLocation,
  onStartPickNew,
  onCancelPick,
  onEditLeak,
  onUpdatePosition,
  onOpenLightbox,
  onPanToLocation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileGroupRef = useRef<L.LayerGroup | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const auxGroupRef = useRef<L.LayerGroup | null>(null);

  const hasInitialFitRef = useRef(false);
  const lastFocusSeqRef = useRef<number>(focusTarget?.seq ?? 0);
  const lastFitSeqRef = useRef<number>(fitBoundsSeq);
  const lastPinSignatureRef = useRef<string>('');

  const isPickingRef = useRef(isPickingLocation);
  isPickingRef.current = isPickingLocation;
  const onPickRef = useRef(onPickMapLocation);
  onPickRef.current = onPickMapLocation;
  const onSelectRef = useRef(onSelectLeak);
  onSelectRef.current = onSelectLeak;
  const onUpdatePosRef = useRef(onUpdatePosition);
  onUpdatePosRef.current = onUpdatePosition;

  const [mapTypeId, setMapTypeId] = useState<MapTypeOption>('hybrid');
  const [localFitSeq, setLocalFitSeq] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchPin, setSearchPin] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  const showTempStatus = useCallback((msg: string) => {
    setGpsStatus(msg);
    setTimeout(() => {
      setGpsStatus((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const pinnedLeaks = useMemo(
    () =>
      leaks.filter(
        (l): l is LeakPoint & {lat: number; lng: number} =>
          typeof l.lat === 'number' &&
          Number.isFinite(l.lat) &&
          typeof l.lng === 'number' &&
          Number.isFinite(l.lng)
      ),
    [leaks]
  );

  // Initialize Leaflet Map once
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapInstanceRef.current) return;

    const map = L.map(container, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });

    const tileGroup = L.layerGroup().addTo(map);
    const markersGroup = L.layerGroup().addTo(map);
    const auxGroup = L.layerGroup().addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (isPickingRef.current) {
        onPickRef.current(e.latlng.lat, e.latlng.lng);
      } else {
        onSelectRef.current(null);
      }
    });

    mapInstanceRef.current = map;
    tileGroupRef.current = tileGroup;
    markersGroupRef.current = markersGroup;
    auxGroupRef.current = auxGroup;

    const observer = new ResizeObserver(() => {
      map.invalidateSize({animate: false});
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      tileGroupRef.current = null;
      markersGroupRef.current = null;
      auxGroupRef.current = null;
    };
  }, []);

  // Update Esri tile layers whenever mapTypeId or theme changes
  useEffect(() => {
    const tileGroup = tileGroupRef.current;
    if (!tileGroup) return;
    tileGroup.clearLayers();
    const layers = buildEsriLayers(mapTypeId, theme);
    for (const layer of layers) {
      layer.addTo(tileGroup);
    }
  }, [mapTypeId, theme]);

  // Toggle crosshair cursor & refresh layout during pin-pick mode without mutating React className
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.getContainer().classList.toggle('leaflet-crosshair', isPickingLocation);
    requestAnimationFrame(() => map.invalidateSize({animate: false}));
  }, [isPickingLocation]);

  // Escape key exits fullscreen & resize invalidation
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map) {
      requestAnimationFrame(() => map.invalidateSize({animate: false}));
    }
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  // Render leak markers
  useEffect(() => {
    const markersGroup = markersGroupRef.current;
    if (!markersGroup) return;
    markersGroup.clearLayers();

    for (const leak of pinnedLeaks) {
      const colors = SEVERITY_COLORS[leak.severity];
      const shortGlyph = leak.no.length <= 3 ? leak.no : leak.no.slice(0, 3);
      const pinGlyph = leak.severity === 'critical' ? '!' : shortGlyph;
      const isSelected = selectedId === leak.id;

      const marker = L.marker([leak.lat, leak.lng], {
        icon: createLeakPinIcon(
          colors.pinBg,
          colors.pinBorder,
          colors.pinGlyphColor,
          pinGlyph,
          isSelected
        ),
        title: `${leak.dma} · NO.${leak.no} (${SEVERITY_LABELS[leak.severity]})`,
        draggable: isSelected,
        zIndexOffset: isSelected
          ? 600
          : leak.severity === 'critical'
            ? 200
            : 100,
      });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (isPickingRef.current) {
          onPickRef.current(leak.lat, leak.lng);
        } else {
          onSelectRef.current(leak.id);
        }
      });

      if (isSelected) {
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          onUpdatePosRef.current(leak.id, pos.lat, pos.lng);
        });
      }

      marker.addTo(markersGroup);
    }
  }, [pinnedLeaks, selectedId]);

  // Render draft & search/GPS auxiliary markers
  useEffect(() => {
    const auxGroup = auxGroupRef.current;
    if (!auxGroup) return;
    auxGroup.clearLayers();

    if (draftPin) {
      L.marker([draftPin.lat, draftPin.lng], {
        icon: createAuxiliaryPinIcon('#0284C7', '#075985', 'ตำแหน่งที่เลือก'),
        title: 'ตำแหน่งที่เลือก',
        zIndexOffset: 700,
      }).addTo(auxGroup);
    }

    if (searchPin) {
      const m = L.marker([searchPin.lat, searchPin.lng], {
        icon: createAuxiliaryPinIcon('#0F172A', '#334155', searchPin.label),
        title: searchPin.label,
        zIndexOffset: 650,
      });
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onPickRef.current(searchPin.lat, searchPin.lng);
        setSearchPin(null);
      });
      m.addTo(auxGroup);
    }
  }, [draftPin, searchPin]);

  const fitAllVisiblePins = useCallback(
    (pins: Array<LeakPoint & {lat: number; lng: number}>, animate: boolean) => {
      const map = mapInstanceRef.current;
      if (!map || pins.length === 0) return false;

      if (pins.length === 1) {
        map.setView([pins[0].lat, pins[0].lng], 16, {animate});
        return true;
      }

      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, {
        padding: [56, 56],
        maxZoom: 16,
        animate,
      });
      return true;
    },
    []
  );

  // Initial fit & explicit "ดูทั้งหมด" trigger
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const totalFitSeq = fitBoundsSeq + localFitSeq;
    const fitRequestedExplicitly = totalFitSeq !== lastFitSeqRef.current;
    if (fitRequestedExplicitly) {
      lastFitSeqRef.current = totalFitSeq;
    }

    if (focusTarget && focusTarget.seq !== lastFocusSeqRef.current) {
      return;
    }

    const signature = pinnedLeaks
      .map((l) => `${l.id}:${l.lat},${l.lng}`)
      .join('|');

    if (
      fitRequestedExplicitly ||
      (!hasInitialFitRef.current && !focusTarget && pinnedLeaks.length > 0) ||
      (hasInitialFitRef.current &&
        !focusTarget &&
        lastPinSignatureRef.current === '' &&
        pinnedLeaks.length > 0)
    ) {
      const shouldAnimate = hasInitialFitRef.current && fitRequestedExplicitly;
      if (fitAllVisiblePins(pinnedLeaks, shouldAnimate)) {
        hasInitialFitRef.current = true;
        lastPinSignatureRef.current = signature;
      }
    }
  }, [pinnedLeaks, focusTarget, fitBoundsSeq, localFitSeq, fitAllVisiblePins]);

  // Focus specific coordinate when requested (e.g. from table or search)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !focusTarget) return;
    if (focusTarget.seq === lastFocusSeqRef.current && hasInitialFitRef.current) {
      return;
    }
    const shouldAnimate = hasInitialFitRef.current;
    lastFocusSeqRef.current = focusTarget.seq;
    hasInitialFitRef.current = true;
    map.setView(
      [focusTarget.lat, focusTarget.lng],
      focusTarget.zoom ?? Math.max(map.getZoom(), 16),
      {animate: shouldAnimate}
    );
  }, [focusTarget]);

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      showTempStatus('เบราว์เซอร์ไม่รองรับการระบุตำแหน่ง GPS');
      return;
    }
    setGpsStatus('กำลังค้นหาตำแหน่ง...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsStatus(null);
        const {latitude, longitude} = pos.coords;
        onPanToLocation(latitude, longitude, 17);
        setSearchPin({
          lat: latitude,
          lng: longitude,
          label: 'ตำแหน่งปัจจุบันของคุณ',
        });
      },
      () => {
        showTempStatus('ไม่สามารถเข้าถึงตำแหน่ง GPS ได้');
      },
      {enableHighAccuracy: true, timeout: 8000}
    );
  }, [onPanToLocation, showTempStatus]);

  const selectedLeak = selectedId
    ? pinnedLeaks.find((l) => l.id === selectedId) || null
    : null;
  const selectedColors = selectedLeak
    ? SEVERITY_COLORS[selectedLeak.severity]
    : null;
  const selectedPipe = selectedLeak
    ? (() => {
        const {pipeType, pipeSize} = parsePipeSpec(
          selectedLeak.pipeSpec,
          selectedLeak.pipeType,
          selectedLeak.pipeSize
        );
        return (
          formatPipeSpec(pipeType, pipeSize) || selectedLeak.pipeSpec || ''
        );
      })()
    : '';

  return (
    <div
      className={
        isExpanded
          ? 'fixed inset-0 z-40 flex flex-col w-screen h-dvh bg-white dark:bg-slate-900'
          : 'flex flex-col w-full h-full bg-slate-100 dark:bg-slate-900'
      }
    >
      {/* Clean Top Map Controls Bar */}
      <div className="bg-slate-50/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-2.5 py-2 sm:px-3.5 sm:py-2.5 space-y-2 shrink-0 z-20">
        {/* Row 1: Search & Pin Pick CTA */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <PlaceSearchBox
              onSelectLocation={(loc) => {
                setSearchPin(loc);
                onPanToLocation(loc.lat, loc.lng, 17);
              }}
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isPickingLocation ? (
              <button
                type="button"
                onClick={onStartPickNew}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold shadow-xs transition-colors whitespace-nowrap"
              >
                <Crosshair className="w-3.5 h-3.5 shrink-0" />
                <span>ปักหมุดจุดรั่ว</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onCancelPick}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>ยกเลิก</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Esri Map Type Switcher + GPS + Fit All + Fullscreen */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <div
            role="group"
            aria-label="รูปแบบแผนที่"
            className="inline-flex items-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-0.5 sm:p-1 shadow-xs max-w-full overflow-x-auto"
          >
            <span className="hidden sm:inline-flex items-center pl-2 pr-1 text-slate-400 dark:text-slate-500">
              <Layers className="w-3.5 h-3.5" />
            </span>
            {MAP_TYPE_OPTIONS.map((opt) => {
              const active = mapTypeId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMapTypeId(opt.id)}
                  aria-pressed={active}
                  className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#1565C0] dark:bg-sky-600 text-white font-semibold shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/70 font-medium'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleLocateMe}
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LocateFixed className="w-3.5 h-3.5 text-[#1565C0] dark:text-sky-400 shrink-0" />
            <span>ตำแหน่งฉัน</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onSelectLeak(null);
              setLocalFitSeq((n) => n + 1);
            }}
            disabled={pinnedLeaks.length === 0}
            title="ปรับมุมมองแผนที่ให้เห็นจุดรั่วทั้งหมดในรายการ"
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Scan className="w-3.5 h-3.5 text-[#1565C0] dark:text-sky-400 shrink-0" />
            <span>ดูทั้งหมด</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-pressed={isExpanded}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl border text-[11px] sm:text-xs font-medium shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isExpanded
                ? 'bg-[#1565C0] dark:bg-sky-600 border-[#1565C0] dark:border-sky-600 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-[#1565C0] dark:text-sky-400 shrink-0" />
            )}
            <span>{isExpanded ? 'ย่อแผนที่' : 'ขยายแผนที่'}</span>
          </button>
        </div>
      </div>

      {/* Leaflet Map Canvas */}
      <div className="relative flex-1 min-h-[300px] sm:min-h-[340px] w-full bg-slate-100 dark:bg-slate-950">
        <div ref={mapContainerRef} className="absolute inset-0 z-0" />

        {/* Pin-Pick Mode Banner */}
        {isPickingLocation && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[500] px-3.5 py-2 rounded-lg bg-slate-900/95 text-white text-[11px] sm:text-xs font-medium shadow-lg flex items-center gap-2.5 whitespace-nowrap max-w-[92%]">
            <Crosshair className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="truncate">
              {pickingReason === 'edit'
                ? 'คลิกบนแผนที่เพื่อย้ายตำแหน่งจุดรั่วนี้'
                : 'คลิกบนแผนที่เพื่อปักหมุดตำแหน่งท่อประปารั่ว'}
            </span>
            <button
              type="button"
              onClick={onCancelPick}
              className="text-slate-300 hover:text-white underline ml-1 shrink-0"
            >
              ยกเลิก
            </button>
          </div>
        )}

        {/* GPS Feedback Toast */}
        {gpsStatus && (
          <div className="absolute top-3 right-3 z-[500] max-w-[calc(100%-24px)] px-3 py-1.5 rounded-lg bg-slate-900/90 text-white text-xs shadow-md">
            {gpsStatus}
          </div>
        )}

        {/* Selected Pin Detail Card (Clean Desktop Floating Card & Mobile Bottom Sheet) */}
        {selectedLeak && selectedColors && !isPickingLocation && (
          <div className="absolute bottom-2 left-2 right-2 sm:bottom-auto sm:left-auto sm:top-3 sm:right-3 sm:w-[300px] z-[500] max-h-[calc(100%-16px)] overflow-y-auto bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl p-3">
            {/* Header Row */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white shrink-0">
                  {selectedLeak.dma} · #{selectedLeak.no}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold truncate ${selectedColors.badge}`}
                >
                  {selectedLeak.severity === 'critical' && (
                    <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
                  )}
                  <span className="truncate">
                    {SEVERITY_LABELS[selectedLeak.severity]}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => onSelectLeak(null)}
                aria-label="ปิดรายละเอียดจุดรั่ว"
                className="p-1 -mr-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body: Side-by-side on mobile, stacked cover on desktop */}
            <div className="flex sm:flex-col items-stretch gap-3 sm:gap-2.5 mt-2.5">
              {selectedLeak.photos[0] ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenLightbox(
                      selectedLeak.photos,
                      0,
                      `${selectedLeak.dma} · #${selectedLeak.no}`
                    )
                  }
                  className="relative w-20 h-20 sm:w-full sm:h-32 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 group"
                >
                  <img
                    src={selectedLeak.photos[0].url}
                    alt={
                      selectedLeak.photos[0].caption ||
                      `${selectedLeak.dma} #${selectedLeak.no}`
                    }
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                  />
                  <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/65 text-white text-[10px] font-medium inline-flex items-center gap-0.5">
                    <Maximize2 className="w-2.5 h-2.5" />
                    {selectedLeak.photos.length > 1
                      ? `${selectedLeak.photos.length} รูป`
                      : 'ขยาย'}
                  </span>
                </button>
              ) : (
                <div className="w-20 h-20 sm:w-full sm:h-20 rounded-lg bg-slate-50 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center text-slate-400 gap-1 shrink-0">
                  <Camera className="w-4 h-4" />
                  <span className="text-[10px] sm:text-xs">
                    ยังไม่มีภาพหน้างาน
                  </span>
                </div>
              )}

              <div className="min-w-0 flex-1 flex flex-col justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono tabular-nums shrink-0">
                      {selectedLeak.reportDate}
                    </span>
                    {selectedLeak.locationName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">
                          {selectedLeak.locationName}
                        </span>
                      </>
                    )}
                  </div>

                  {selectedPipe && (
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      ท่อ: {selectedPipe}
                    </div>
                  )}

                  {selectedLeak.technician && (
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                      ผู้รับผิดชอบ: {selectedLeak.technician}
                    </div>
                  )}

                  {selectedLeak.repairMethod && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                      วิธีแก้ไข: {selectedLeak.repairMethod}
                    </p>
                  )}
                </div>

                <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500 tabular-nums pt-1">
                  {selectedLeak.lat.toFixed(5)}, {selectedLeak.lng.toFixed(5)}
                </div>
              </div>
            </div>

            {/* Action Footer */}
            <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onEditLeak(selectedLeak)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-sky-600 text-white text-xs font-medium hover:bg-slate-800 dark:hover:bg-sky-500 transition-colors cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                แก้ไข / เพิ่มภาพ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
