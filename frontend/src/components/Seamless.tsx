/**
 * The seamless map of Azeroth, as the OpenMap addon draws it: both continents and every zone stitched into one
 * picture, from the whole world down to a zone's own detail. Tiles come from tools/build_omap.py (rendered with
 * OpenMap's renderer, MIT; the art is Blizzard's). Points are given in world coordinates: 0..1 across Azeroth's
 * map (947), the same space as maps.json's `onWorld`.
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { useI18n } from "../lib/i18n";
import MAPS from "../lib/maps.json";
import type { L as Lang } from "../lib/chains";

export interface WorldMeta { id: number; name: Lang; parent: number; type: number; onWorld?: [number, number, number, number] }
export const WORLD_MAPS = (MAPS as unknown as { maps: WorldMeta[] }).maps;
const BY_ID = new Map(WORLD_MAPS.map((m) => [m.id, m]));
export const CITIES = new Set([1453, 1454, 1455, 1456, 1457, 1458]);

// zoom 0 shows the world 512 px wide; the tiles go to zoom 5 (16384 px), the map zooms two steps past them
const W0 = 512, H0 = (512 * 668) / 1002, NATIVE = 4, MAX = 7;
const ll = (u: number, v: number) => L.latLng(-v * H0, u * W0);
const WORLD = L.latLngBounds(ll(0, 0), ll(1, 1));

/** A point on a zone or continent map (0..100 per axis) in world coordinates, or null when it has no place there. */
export function toWorld(map: number, x: number, y: number): { u: number; v: number } | null {
  const r = BY_ID.get(map)?.onWorld;
  if (!r) return null;
  const [l, rr, t, b] = r;
  return { u: l + (x / 100) * (rr - l), v: t + (y / 100) * (b - t) };
}

export function mapBounds(map: number): L.LatLngBounds | null {
  const r = BY_ID.get(map)?.onWorld;
  return r ? L.latLngBounds(ll(r[0], r[2]), ll(r[1], r[3])) : null;
}

export interface WPin { u: number; v: number; kind: string; label: string; glyph: string; hot?: boolean; onClick?: () => void }

export type Focus = { u: number; v: number; zoom: number } | { map: number } | null;

export function Seamless({ pins, focus, onZone, height = "min(76vh, 820px)" }:
  { pins: WPin[]; focus?: Focus; onZone?: (id: number) => void; height?: string }) {
  const { lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const zoneLayer = useRef<L.LayerGroup | null>(null);
  const onZoneRef = useRef(onZone);
  onZoneRef.current = onZone;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, {
      crs: L.CRS.Simple, minZoom: 0, maxZoom: MAX, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
      maxBounds: WORLD.pad(0.15), maxBoundsViscosity: 0.8, attributionControl: true, zoomControl: true,
    });
    L.tileLayer("/omap/{z}/{x}_{y}.webp", {
      tileSize: 256, noWrap: true, bounds: WORLD, minZoom: 0, maxZoom: MAX, maxNativeZoom: NATIVE,
      attribution: 'OpenMap (<a href="https://github.com/openmap-world/openmap" target="_blank" rel="noreferrer">MIT</a>) · © Blizzard Entertainment',
    }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.fitBounds(WORLD);
    // the capitals' own maps are far more detailed than the world picture: they fade in up close
    for (const c of WORLD_MAPS.filter((x) => CITIES.has(x.id) && x.onWorld)) {
      const b = mapBounds(c.id)!;
      L.imageOverlay(`/maps/${c.id}.webp`, b, { className: "om-city", interactive: false }).addTo(m);
    }
    const sync = () => box.current?.setAttribute("data-z", String(Math.floor(m.getZoom())));
    m.on("zoomend", sync);
    sync();
    pinLayer.current = L.layerGroup().addTo(m);
    zoneLayer.current = L.layerGroup().addTo(m);
    mapRef.current = m;
    return () => { m.remove(); mapRef.current = null; };
  }, []);

  // zone and continent names, written on the map; a click flies to the zone
  useEffect(() => {
    const g = zoneLayer.current, m = mapRef.current;
    if (!g || !m) return;
    g.clearLayers();
    for (const z of WORLD_MAPS) {
      if (!z.onWorld || (z.type !== 2 && z.type !== 3)) continue;
      const [l, r, t, b] = z.onWorld;
      const icon = L.divIcon({ className: `om-name ${z.type === 2 ? "continent" : CITIES.has(z.id) ? "city" : "zone"}`, html: `<span>${esc(z.name[lang])}</span>`, iconSize: [0, 0] });
      const mk = L.marker(ll((l + r) / 2, (t + b) / 2), { icon, keyboard: false, zIndexOffset: -1000 }).addTo(g);
      if (z.type === 3) mk.on("click", () => { m.flyToBounds(mapBounds(z.id)!, { duration: 0.8 }); onZoneRef.current?.(z.id); });
    }
  }, [lang]);

  useEffect(() => {
    const g = pinLayer.current;
    if (!g) return;
    g.clearLayers();
    for (const p of pins) {
      const icon = L.divIcon({
        className: "", iconSize: [0, 0],
        html: `<div class="wm-pin om-pin ${p.kind} ${p.hot ? "hot" : ""}"><span class="wm-glyph">${esc(p.glyph)}</span><span class="wm-label">${esc(p.label)}</span></div>`,
      });
      const mk = L.marker(ll(p.u, p.v), { icon, title: p.label, zIndexOffset: p.hot ? 1000 : 0 }).addTo(g);
      if (p.onClick) mk.on("click", p.onClick);
    }
  }, [pins]);

  const key = focus ? ("map" in focus ? `m${focus.map}` : `${focus.u.toFixed(4)},${focus.v.toFixed(4)},${focus.zoom}`) : "";
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !focus) return;
    if ("map" in focus) {
      const b = mapBounds(focus.map);
      if (b) m.flyToBounds(b, { duration: 0.8 });
    } else {
      m.flyTo(ll(focus.u, focus.v), focus.zoom, { duration: 0.8 });
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="wm-frame">
      <div ref={box} className="om-map" style={{ height }} />
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
