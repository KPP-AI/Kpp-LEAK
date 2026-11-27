import {useCallback, useEffect, useState} from 'react';

export interface PlaceSuggestionItem {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export interface UseAutocompleteSuggestionsReturn {
  suggestions: PlaceSuggestionItem[];
  isLoading: boolean;
  resetSession: () => void;
}

function parseCoordinateInput(input: string): PlaceSuggestionItem | null {
  const match = input
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return {
    id: `coord-${lat}-${lng}`,
    label: `พิกัด ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    lat,
    lng,
  };
}

export function useAutocompleteSuggestions(
  inputString: string
): UseAutocompleteSuggestionsReturn {
  const [suggestions, setSuggestions] = useState<PlaceSuggestionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = inputString.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const coordItem = parseCoordinateInput(trimmed);
    if (coordItem) {
      setSuggestions([coordItem]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          format: 'jsonv2',
          q: trimmed,
          countrycodes: 'th',
          'accept-language': 'th,en',
          limit: '6',
        });
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`,
          {
            signal: controller.signal,
            headers: {
              Accept: 'application/json',
            },
          }
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const rows = (await res.json()) as Array<{
          place_id?: number | string;
          display_name?: string;
          lat?: string;
          lon?: string;
        }>;
        const parsed: PlaceSuggestionItem[] = rows
          .map((row, index) => {
            const lat = Number(row.lat);
            const lng = Number(row.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            return {
              id: String(row.place_id ?? index),
              label: row.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat,
              lng,
            };
          })
          .filter((item): item is PlaceSuggestionItem => item !== null);
        if (!controller.signal.aborted) {
          setSuggestions(parsed);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [inputString]);

  const resetSession = useCallback(() => {
    setSuggestions([]);
  }, []);

  return {
    suggestions,
    isLoading,
    resetSession,
  };
}
