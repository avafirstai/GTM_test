"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { VERTICALES, VILLES_FRANCE } from "@/lib/verticales";
import type { Verticale } from "@/lib/verticales";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CustomVerticale {
  id: string;
  name: string;
  emoji: string;
  google_maps_categories: string[];
  created_at: string;
}

/** Verticale enriched with isCustom flag — works for both built-in and custom */
export interface MergedVerticale extends Verticale {
  isCustom: boolean;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCustomData() {
  const [customVerticales, setCustomVerticales] = useState<CustomVerticale[]>([]);
  const [customVilles, setCustomVilles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch on mount
  useEffect(() => {
    async function load() {
      try {
        const [vRes, cRes] = await Promise.all([
          fetch("/api/custom-verticales").then((r) => r.json()),
          fetch("/api/custom-villes").then((r) => r.json()),
        ]);
        setCustomVerticales(vRes.verticales ?? []);
        setCustomVilles(cRes.villes ?? []);
      } catch {
        // silent — defaults will be used
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Merge verticales: built-ins + customs
  const allVerticales: MergedVerticale[] = useMemo(() => {
    const builtIn: MergedVerticale[] = VERTICALES.map((v) => ({
      ...v,
      isCustom: false,
    }));

    const customs: MergedVerticale[] = customVerticales
      .filter((cv) => !VERTICALES.some((bv) => bv.id === cv.id))
      .map((cv) => ({
        id: cv.id,
        name: cv.name,
        emoji: cv.emoji,
        tier: 3 as const,
        description: `Custom: ${cv.name}`,
        painPoint: "",
        pitchAngle: "",
        avgDealValue: 0,
        marketSize: 0,
        scoring: {
          callVolume: 0,
          missedCallValue: 0,
          buyProbability: 0,
          marketSize: 0,
          shortCycle: 0,
        },
        totalScore: 0,
        googleMapsCategories: cv.google_maps_categories,
        decisionMakers: [],
        emailSubjectTemplates: [],
        isCustom: true,
      }));

    return [...builtIn, ...customs];
  }, [customVerticales]);

  // Merge villes: built-ins + customs (deduped)
  const allVilles: string[] = useMemo(() => {
    const set = new Set([...VILLES_FRANCE, ...customVilles]);
    return [...set].sort((a, b) => a.localeCompare(b, "fr"));
  }, [customVilles]);

  // Which villes are custom (not in default list)
  const customVilleSet = useMemo(
    () => new Set(customVilles.filter((v) => !VILLES_FRANCE.includes(v))),
    [customVilles],
  );

  // Add a new verticale
  const addVerticale = useCallback(
    async (data: {
      name: string;
      emoji?: string;
      googleMapsCategories: string[];
    }): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/custom-verticales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (!res.ok) {
          return { success: false, error: json.error ?? "Failed to add verticale" };
        }
        // Append to local state
        if (json.verticale) {
          setCustomVerticales((prev) => [json.verticale, ...prev]);
        }
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [],
  );

  // Add a new ville
  const addVille = useCallback(
    async (name: string): Promise<{ success: boolean; error?: string }> => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length < 2) {
        return { success: false, error: "Nom trop court (min 2 caracteres)" };
      }
      try {
        const res = await fetch("/api/custom-villes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        const json = await res.json();
        if (!res.ok) {
          return { success: false, error: json.error ?? "Failed to add ville" };
        }
        // Append to local state
        if (json.ville) {
          setCustomVilles((prev) =>
            prev.includes(json.ville) ? prev : [json.ville, ...prev],
          );
        }
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [],
  );

  return {
    allVerticales,
    allVilles,
    customVilleSet,
    loading,
    addVerticale,
    addVille,
    /** Raw default counts for display */
    defaultVerticalesCount: VERTICALES.length,
    defaultVillesCount: VILLES_FRANCE.length,
  };
}
