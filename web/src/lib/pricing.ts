// Heuristic pricing engine. Implements section 6.1 of the spec.
// Pure functions, fully unit-testable.

export interface MaterialPricing {
  density_g_cm3: number;        // g/cm3
  default_flow_mm3_s: number;  // mm3/s
}

export interface FilamentPricing {
  cost_per_gram: number;       // USD/g
}

export interface LocationPricing {
  hourly_machine_rate: number; // USD/hr
  tax_rate: number;            // 0.0 - 1.0
}

export interface QuoteConstants {
  wall_thickness_mm: number;   // default 0.84
  setup_minutes: number;       // default 3
  handling_fee: number;        // default 1.00
  min_order_fee: number;       // default 3.00
}

export interface QuoteInput {
  volume_cm3: number;          // cm3 (signed volume absolute)
  surface_cm2: number;         // cm2
  material: MaterialPricing;
  filament: FilamentPricing;
  location: LocationPricing;
  infill_percent: number;      // 0..100
  quantity: number;            // 1..10
  constants: QuoteConstants;
}

export interface QuoteBreakdown {
  grams: number;
  print_time_minutes: number;
  material_cost: number;
  machine_cost: number;
  handling_fee: number;
  unit_price: number;
  unit_price_floored: boolean;
  subtotal: number;
  tax_amount: number;
  total: number;
  wall_vol_cm3: number;
  extrude_vol_cm3: number;
}

// mm3 to cm3 is 1/1000; surface_cm2 * wall_mm = cm2 * mm = (cm2 * 0.1 cm) = 0.1*cm3
// wall_thickness_mm: convert mm to cm (divide by 10) then multiply by surface area in cm2.
export function quoteHeuristic(input: QuoteInput): QuoteBreakdown {
  const { volume_cm3, surface_cm2, material, filament, location, infill_percent, quantity, constants } = input;

  const wallThicknessCm = constants.wall_thickness_mm / 10;
  const wallVolCm3 = Math.min(volume_cm3, surface_cm2 * wallThicknessCm);
  const infill = Math.max(0, Math.min(100, infill_percent)) / 100;
  const extrudeVolCm3 = wallVolCm3 + (volume_cm3 - wallVolCm3) * infill;
  const gramsUnit = extrudeVolCm3 * material.density_g_cm3;
  const grams = gramsUnit * quantity;

  // Print time per unit: extruded volume (mm3) / flow (mm3/s) / 60  (min), plus setup_minutes.
  const extrudeVolMm3Unit = extrudeVolCm3 * 1000;
  const printMinUnit = extrudeVolMm3Unit / material.default_flow_mm3_s / 60 + constants.setup_minutes;
  const printMinutes = printMinUnit * quantity;

  const materialCostUnit = gramsUnit * filament.cost_per_gram;
  const machineCostUnit = (printMinUnit / 60) * location.hourly_machine_rate;
  const unitPriceRaw = materialCostUnit + machineCostUnit + constants.handling_fee;
  const unitPrice = unitPriceRaw; // per-unit price (floor applied at total level)

  const materialCost = materialCostUnit * quantity;
  const machineCost = machineCostUnit * quantity;
  const handling = constants.handling_fee * quantity;
  const subtotalRaw = materialCost + machineCost + handling;
  const floored = subtotalRaw < constants.min_order_fee;
  const subtotal = Math.max(subtotalRaw, constants.min_order_fee);
  const tax = Math.round(subtotal * location.tax_rate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  return {
    grams: Math.round(grams * 100) / 100,
    print_time_minutes: Math.ceil(printMinutes),
    material_cost: Math.round(materialCost * 100) / 100,
    machine_cost: Math.round(machineCost * 100) / 100,
    handling_fee: Math.round(handling * 100) / 100,
    unit_price: Math.round(unitPrice * 100) / 100,
    unit_price_floored: floored,
    subtotal: Math.round(subtotal * 100) / 100,
    tax_amount: tax,
    total,
    wall_vol_cm3: Math.round(wallVolCm3 * 1000) / 1000,
    extrude_vol_cm3: Math.round(extrudeVolCm3 * 1000) / 1000,
  };
}

// Golden test constants from spec Appendix D (PLA 1.24 g/cm3, default flow 7.5 mm3/s;
// cost_per_gram $0.025, hourly rate $8/hr, tax 0, min fee $3, handling $1, setup 3min, wall 0.84mm).
export const GOLDEN_20MM_CUBE_PLA: QuoteInput = (() => {
  // 20 mm cube = 8 cm3, surface 6*2*2 = 24 cm2
  return {
    volume_cm3: 8,
    surface_cm2: 24,
    material: { density_g_cm3: 1.24, default_flow_mm3_s: 7.5 },
    filament: { cost_per_gram: 0.025 },
    location: { hourly_machine_rate: 8, tax_rate: 0 },
    infill_percent: 20,
    quantity: 1,
    constants: { wall_thickness_mm: 0.84, setup_minutes: 3, handling_fee: 1.00, min_order_fee: 3.00 },
  };
})();
