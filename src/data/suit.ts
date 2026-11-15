// The suited crew member as the planner and the viewer model them. Kept free
// of imports so the viewer can use it without the editor's map library.
//
// Rate = a flat walking rate plus the work of lifting crew and suit up the
// climbs. The flat rate is the Apollo lunar EVA average, 234 kcal/h (Waligora
// and Horrigan, NASA TN D-7883, via NASA TM 1991). Lifting work follows Mars
// gravity and a muscle efficiency of 25%. Mass is ASSUMED: 80 kg crew plus
// 90 kg suit and pack, about an Apollo A7LB with its PLSS.
export const SUIT = {
  baseW: (234 * 4184) / 3600,
  massKg: 170,
  gravity: 3.711,
  efficiency: 0.25,
  // Top of the nominal suited range NASA-STD-3001 sizes heat rejection for,
  // 2220 kJ/h ([V2 11011] rationale).
  limitW: 2_220_000 / 3600,
  // BVAD (NASA/TP-2015-218570) Table 3-33 ratio of oxygen to food energy,
  // and Table 4-75 suit oxygen loss and cooling water per EVA hour.
  oxygenKgPerJ: 0.816 / 12.59e6,
  suitOxygenKgPerHour: 0.092,
  coolingKgPerHour: 0.625,
  // [V2 11030]: 240 mL of drinking water per EVA hour.
  drinkKgPerHour: 0.24,
}
