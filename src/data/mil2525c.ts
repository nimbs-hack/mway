// MIL-STD-2525C tactical symbols for map markers, ported from deploy-v1
// (apps/web/src/assets/milStd2525c.ts). Each symbol is 24x24 SVG markup in
// currentColor with its 15-character SIDC. The frame shape carries the
// affiliation: friendly box, hostile diamond, neutral square, unknown
// clover. We draw them monochrome, which 2525C allows, so red stays the
// selection color.

export type Mil2525cThemeId = "units" | "installations" | "hazards" | "tactical" | "metoc";
export type Mil2525cAffiliation = "F" | "H" | "N" | "U" | "G" | "W";

export interface Mil2525cTheme {
  id: Mil2525cThemeId;
  shortLabel: string;
  label: string;
}

export interface Mil2525cSymbol {
  id: `mil2525c-${string}`;
  sidc: string;
  name: string;
  theme: Mil2525cThemeId;
  affiliation: Mil2525cAffiliation;
  svgInner: string;
}

const FRAME_FRIENDLY =
  '<rect x="3.5" y="5.5" width="17" height="13" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const FRAME_INSTALLATION = `<rect x="9" y="2.8" width="6" height="2.7" fill="currentColor"/>${FRAME_FRIENDLY}`;
const FRAME_HOSTILE =
  '<polygon points="12,2.5 21.5,12 12,21.5 2.5,12" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const FRAME_NEUTRAL =
  '<rect x="4.5" y="4.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5"/>';
const FRAME_UNKNOWN =
  '<path d="M7.5 7.5 A4.5 4.5 0 0 1 16.5 7.5 A4.5 4.5 0 0 1 16.5 16.5 A4.5 4.5 0 0 1 7.5 16.5 A4.5 4.5 0 0 1 7.5 7.5 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>';

export const MIL2525C_THEMES: readonly Mil2525cTheme[] = [
  {
    id: "units",
    shortLabel: "UNITS",
    label: "Crew & mobility",
  },
  {
    id: "installations",
    shortLabel: "BASE",
    label: "Base & utilities",
  },
  {
    id: "hazards",
    shortLabel: "HZD",
    label: "Terrain & rad hazards",
  },
  {
    id: "tactical",
    shortLabel: "TAC",
    label: "Tactical control",
  },
  {
    id: "metoc",
    shortLabel: "METOC",
    label: "Geo & metoc",
  },
];

export const MIL2525C_SYMBOLS: readonly Mil2525cSymbol[] = [
  // Units (Friendly ground units & equipment)
  {
    id: "mil2525c-crew",
    sidc: "SFGPUCI---*****",
    name: "Crew / EVA",
    theme: "units",
    affiliation: "F",
    svgInner: `${FRAME_FRIENDLY}<line x1="3.5" y1="5.5" x2="20.5" y2="18.5" stroke="currentColor" stroke-width="1.4"/><line x1="20.5" y1="5.5" x2="3.5" y2="18.5" stroke="currentColor" stroke-width="1.4"/>`,
  },
  {
    id: "mil2525c-rover",
    sidc: "SFGPEV----*****",
    name: "Rover / UGV",
    theme: "units",
    affiliation: "F",
    svgInner: `${FRAME_FRIENDLY}<path d="M9.5 8.5 H14.5 A2.4 2.4 0 0 1 14.5 13.3 H9.5 A2.4 2.4 0 0 1 9.5 8.5 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="15.8" r="1.2" fill="currentColor"/><circle cx="15" cy="15.8" r="1.2" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-recon",
    sidc: "SFGPUCR---*****",
    name: "Recon",
    theme: "units",
    affiliation: "F",
    svgInner: `${FRAME_FRIENDLY}<line x1="3.5" y1="18.5" x2="20.5" y2="5.5" stroke="currentColor" stroke-width="1.5"/>`,
  },
  {
    id: "mil2525c-medevac",
    sidc: "SFGPUSMM--*****",
    name: "Medevac",
    theme: "units",
    affiliation: "F",
    svgInner: `${FRAME_FRIENDLY}<line x1="12" y1="7.8" x2="12" y2="16.2" stroke="currentColor" stroke-width="2.2"/><line x1="7.8" y1="12" x2="16.2" y2="12" stroke="currentColor" stroke-width="2.2"/>`,
  },
  {
    id: "mil2525c-relay",
    sidc: "SFGPUUS---*****",
    name: "Comms Relay",
    theme: "units",
    affiliation: "F",
    svgInner: `${FRAME_FRIENDLY}<polyline points="3.5,5.5 12,13.5 12,10.5 20.5,18.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/>`,
  },
  {
    id: "mil2525c-supply",
    sidc: "SFGPUSS---*****",
    name: "Supply",
    theme: "units",
    affiliation: "F",
    svgInner: `${FRAME_FRIENDLY}<line x1="3.5" y1="15" x2="20.5" y2="15" stroke="currentColor" stroke-width="1.5"/><rect x="10.2" y="8.6" width="3.6" height="3.6" fill="currentColor"/>`,
  },

  // Installations (Friendly base infrastructure)
  {
    id: "mil2525c-habitat",
    sidc: "SFGPIBA---*****",
    name: "Habitat",
    theme: "installations",
    affiliation: "F",
    svgInner: `${FRAME_INSTALLATION}<path d="M7.5 16 V11 L12 8 L16.5 11 V16 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="miter"/><rect x="10.8" y="12.5" width="2.4" height="3.5" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-airlock",
    sidc: "SFGPIM----*****",
    name: "Airlock",
    theme: "installations",
    affiliation: "F",
    svgInner: `${FRAME_INSTALLATION}<line x1="6.5" y1="12" x2="17.5" y2="12" stroke="currentColor" stroke-width="1.4"/><line x1="9.5" y1="8.2" x2="9.5" y2="15.8" stroke="currentColor" stroke-width="1.7"/><line x1="14.5" y1="8.2" x2="14.5" y2="15.8" stroke="currentColor" stroke-width="1.7"/>`,
  },
  {
    id: "mil2525c-solar",
    sidc: "SFGPIUEN--*****",
    name: "Solar / Power",
    theme: "installations",
    affiliation: "F",
    svgInner: `${FRAME_INSTALLATION}<polygon points="13,7.5 9,12.5 12,12.5 11,16.5 15,11.5 12,11.5" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-pad",
    sidc: "SFGPIA----*****",
    name: "Pad / LZ",
    theme: "installations",
    affiliation: "F",
    svgInner: `${FRAME_INSTALLATION}<polygon points="7.5,9.5 16.5,14.5 16.5,9.5 7.5,14.5" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-fuel",
    sidc: "SFGPIR----*****",
    name: "O2 / Fuel",
    theme: "installations",
    affiliation: "F",
    svgInner: `${FRAME_INSTALLATION}<polygon points="8,8.5 16,8.5 12,12.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="miter"/><line x1="12" y1="12.8" x2="12" y2="16.5" stroke="currentColor" stroke-width="1.5"/>`,
  },
  {
    id: "mil2525c-radar",
    sidc: "SFGPIRS---*****",
    name: "Radar",
    theme: "installations",
    affiliation: "F",
    svgInner: `${FRAME_INSTALLATION}<path d="M8.5 15.2 A5.2 5.2 0 0 1 14.5 8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="11.5" y1="12" x2="15.8" y2="8.2" stroke="currentColor" stroke-width="1.4"/><circle cx="15.8" cy="8.2" r="1.1" fill="currentColor"/>`,
  },

  // Hazards (Hostile diamond frame)
  {
    id: "mil2525c-hazard",
    sidc: "SHGPE-----*****",
    name: "Hazard",
    theme: "hazards",
    affiliation: "H",
    svgInner: `${FRAME_HOSTILE}<line x1="12" y1="7.8" x2="12" y2="13.2" stroke="currentColor" stroke-width="1.8"/><rect x="11" y="14.6" width="2" height="2" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-crater",
    sidc: "GHMPOHO---*****",
    name: "Crater / Drop",
    theme: "hazards",
    affiliation: "H",
    svgInner: `${FRAME_HOSTILE}<polyline points="6.8,10.5 9.2,10.5 10.6,14.8 13.4,14.8 14.8,10.5 17.2,10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/>`,
  },
  {
    id: "mil2525c-boulder",
    sidc: "GHMPOFD---*****",
    name: "Boulder Field",
    theme: "hazards",
    affiliation: "H",
    svgInner: `${FRAME_HOSTILE}<polygon points="8.5,14.5 10.2,9.8 12.6,14.5" fill="currentColor"/><polygon points="12.2,14.5 14.2,11 16.2,14.5" fill="currentColor"/><rect x="8" y="15.3" width="8.2" height="1.3" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-scarp",
    sidc: "GHMPOS----*****",
    name: "Steep Scarp",
    theme: "hazards",
    affiliation: "H",
    svgInner: `${FRAME_HOSTILE}<line x1="7" y1="10" x2="17" y2="10" stroke="currentColor" stroke-width="1.6"/><line x1="8.8" y1="10" x2="8.8" y2="14.2" stroke="currentColor" stroke-width="1.4"/><line x1="12" y1="10" x2="12" y2="15" stroke="currentColor" stroke-width="1.4"/><line x1="15.2" y1="10" x2="15.2" y2="14.2" stroke="currentColor" stroke-width="1.4"/>`,
  },
  {
    id: "mil2525c-dust-hzd",
    sidc: "SHGPED----*****",
    name: "Dust Hazard",
    theme: "hazards",
    affiliation: "H",
    svgInner: `${FRAME_HOSTILE}<line x1="7.5" y1="10" x2="15.5" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="8.5" y1="12.5" x2="16.5" y2="12.5" stroke="currentColor" stroke-width="1.5"/><line x1="7.5" y1="15" x2="14" y2="15" stroke="currentColor" stroke-width="1.5"/>`,
  },
  {
    id: "mil2525c-radiation",
    sidc: "GHMPNR----*****",
    name: "Radiation",
    theme: "hazards",
    affiliation: "H",
    svgInner: `${FRAME_HOSTILE}<circle cx="12" cy="12" r="1.3" fill="currentColor"/><polygon points="9.8,7.9 14.2,7.9 13,10.1 11,10.1" fill="currentColor"/><polygon points="14.2,12.1 16.6,12.2 14.4,15.9 13.2,13.9" fill="currentColor"/><polygon points="9.8,12.1 7.4,12.2 9.6,15.9 10.8,13.9" fill="currentColor"/>`,
  },

  // Tactical Control Points (MIL-STD-2525C Appendix B)
  {
    id: "mil2525c-trp",
    sidc: "G*FPPTR---*****",
    name: "Target Ref Pt",
    theme: "tactical",
    affiliation: "G",
    svgInner:
      '<line x1="12" y1="3.5" x2="12" y2="9" stroke="currentColor" stroke-width="1.6"/><line x1="12" y1="15" x2="12" y2="20.5" stroke="currentColor" stroke-width="1.6"/><line x1="3.5" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="1.6"/><line x1="15" y1="12" x2="20.5" y2="12" stroke="currentColor" stroke-width="1.6"/><rect x="10.5" y="10.5" width="3" height="3" fill="currentColor"/>',
  },
  {
    id: "mil2525c-waypoint",
    sidc: "G*GPWP----*****",
    name: "Waypoint",
    theme: "tactical",
    affiliation: "G",
    svgInner:
      '<polygon points="12,3.5 18.5,10.5 12,20.5 5.5,10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/><circle cx="12" cy="10.5" r="2" fill="currentColor"/>',
  },
  {
    id: "mil2525c-checkpoint",
    sidc: "G*GPPC----*****",
    name: "Checkpoint",
    theme: "tactical",
    affiliation: "G",
    svgInner:
      '<polygon points="6.5,4.5 17.5,4.5 17.5,14 12,20.5 6.5,14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/><line x1="9.2" y1="9.8" x2="14.8" y2="9.8" stroke="currentColor" stroke-width="1.6"/><line x1="12" y1="7" x2="12" y2="12.6" stroke="currentColor" stroke-width="1.6"/>',
  },
  {
    id: "mil2525c-rally",
    sidc: "G*GPPR----*****",
    name: "Rally Point",
    theme: "tactical",
    affiliation: "G",
    svgInner:
      '<circle cx="12" cy="9.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="15" x2="12" y2="20.5" stroke="currentColor" stroke-width="1.5"/><line x1="8.5" y1="20.5" x2="15.5" y2="20.5" stroke="currentColor" stroke-width="1.5"/><polygon points="12,6.8 14.6,11.5 9.4,11.5" fill="currentColor"/>',
  },
  {
    id: "mil2525c-op",
    sidc: "G*GPPO----*****",
    name: "Obs Post",
    theme: "tactical",
    affiliation: "G",
    svgInner:
      '<polygon points="12,4 20.5,18.8 3.5,18.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/><circle cx="12" cy="14" r="1.8" fill="currentColor"/>',
  },
  {
    id: "mil2525c-cache",
    sidc: "G*SPPS----*****",
    name: "Cache",
    theme: "tactical",
    affiliation: "G",
    svgInner:
      '<polygon points="6.5,4.5 17.5,4.5 17.5,14 12,20 6.5,14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter"/><line x1="6.5" y1="12" x2="17.5" y2="12" stroke="currentColor" stroke-width="1.5"/><rect x="10.2" y="7" width="3.6" height="2.8" fill="currentColor"/>',
  },

  // Geo, Neutral, Unknown & METOC (Appendix D)
  {
    id: "mil2525c-sample",
    sidc: "SNGPU-----*****",
    name: "Sample Site",
    theme: "metoc",
    affiliation: "N",
    svgInner: `${FRAME_NEUTRAL}<circle cx="12" cy="12" r="3.8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-sensor",
    sidc: "SNGPE-----*****",
    name: "Sensor / Met",
    theme: "metoc",
    affiliation: "N",
    svgInner: `${FRAME_NEUTRAL}<polygon points="12,7.2 16.8,12 12,16.8 7.2,12" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`,
  },
  {
    id: "mil2525c-thermal",
    sidc: "WAS-WST---P****",
    name: "Thermal Anom",
    theme: "metoc",
    affiliation: "W",
    svgInner:
      '<line x1="3.5" y1="17.5" x2="20.5" y2="17.5" stroke="currentColor" stroke-width="1.5"/><polyline points="4.5,14 8.5,14 12,5.5 15.5,14 19.5,14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="miter"/><circle cx="12" cy="12.2" r="1.5" fill="currentColor"/>',
  },
  {
    id: "mil2525c-pressure-low",
    sidc: "WAS-WPL---P****",
    name: "Pressure Low",
    theme: "metoc",
    affiliation: "W",
    svgInner:
      '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3.2 2.2"/><polyline points="9.8,7.8 9.8,16 15.2,16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>',
  },
  {
    id: "mil2525c-dust-plume",
    sidc: "WAS-WSDS--P****",
    name: "Dust Plume",
    theme: "metoc",
    affiliation: "W",
    svgInner:
      '<path d="M15 6.8 C10 6.2 9 9.5 12 11.8 C15 14.1 14 17.8 9 17.2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="4" y1="12" x2="18" y2="12" stroke="currentColor" stroke-width="1.5"/><polygon points="16.5,9.4 21,12 16.5,14.6" fill="currentColor"/>',
  },
  {
    id: "mil2525c-unsurveyed",
    sidc: "SUGPU-----*****",
    name: "Unsurveyed",
    theme: "metoc",
    affiliation: "U",
    svgInner: `${FRAME_UNKNOWN}<line x1="12" y1="8.8" x2="12" y2="15.2" stroke="currentColor" stroke-width="1.5"/><line x1="8.8" y1="12" x2="15.2" y2="12" stroke="currentColor" stroke-width="1.5"/>`,
  },
];

export const MIL2525C_BY_ID: Readonly<Record<string, Mil2525cSymbol>> = Object.fromEntries(
  MIL2525C_SYMBOLS.map((symbol) => [symbol.id, symbol]),
);
