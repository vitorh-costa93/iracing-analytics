import { describe, expect, it } from "vitest";
import { AgentValidationError } from "./agent-result";
import { ibtSetupIdentity, parseAgentIbtSetup } from "./agent-ibt-setup";
import { classifyAgainstFixed, setupIdentityHash, setupParamsToRows } from "./setup-params";

// Shape of a real SF23 CarSetup (values synthetic): tab -> section -> label -> raw YAML string.
function carSetup(overrides: { coldLf?: string; wing?: string; tread?: string; fuel?: string; bias?: string } = {}) {
  return {
    TiresAero: {
      LeftFront: { ColdPressure: overrides.coldLf ?? "138 kPa", LastHotPressure: "145 kPa", LastTempsOMI: "82C, 86C, 91C", TreadRemaining: overrides.tread ?? "97%, 97%, 95%" },
      RightFront: { ColdPressure: "138 kPa", LastHotPressure: "147 kPa", TreadRemaining: "95%, 95%, 96%" },
      RearAero: { WingAngle: overrides.wing ?? "20.0 deg", GurneyFlap: "None" },
      AeroCalculator: { FrontRhAtSpeed: "6.0 mm", FrontDownforce: "42.78%", DownforceToDrag: "3.309:1" },
    },
    Chassis: {
      Front: { ArbDiameter: "18 mm", ArbPosition: "P2", HeaveSpringRate: "300 N/mm", HeaveSpringGap: "10.1 mm", BrakePressureBias: overrides.bias ?? "57.7%", DisplayPage: "1 (Engine)" },
      LeftFront: { CornerWeight: "1383 N", RideHeight: "25.2 mm", PushrodLength: "636.9 mm", TorsionBar: "14.3 mm", Camber: "-2.68 deg", ToeIn: "-1 mm" },
      Rear: { FuelLevel: overrides.fuel ?? "39.0 L", ArbDiameter: "17 mm", RdSpringRate: "600 N/mm", RdSpringGap: "5.7 mm" },
      LeftRear: { SpringRate: "140 N/mm", BumpStiffness: "+5 clicks", ReboundStiffness: "+4 clicks", Camber: "-1.12 deg", ToeIn: "+0 mm" },
    },
    Drivetrain: { Differential: { ClutchPlates: "2", Preload: "25 Nm", DriveAngle: "70 deg", CoastAngle: "60 deg" }, EngineInCarDials: { ThrottleShaping: "9 (TPS)" } },
  };
}
function payload(setup: Record<string, unknown> = {}) {
  return { version: 1, kind: "ibt_setup", key: "b".repeat(64), setup: { customerId: 42, nativeCarId: 191, nativeTrackId: 525, carName: "Super Formula SF23 - Honda", trackName: "spa 2024", trackConfig: "low", recordedAt: "2026-10-23T21:42:43Z", parameters: carSetup(), ...setup } };
}

describe("setupParamsToRows (CarSetup -> decoded_params)", () => {
  it("produces the same normalized rows the Garage61 import stores", () => {
    const rows = setupParamsToRows(carSetup());
    expect(rows).toContainEqual({ tab: "Chassis", section: "Front", label: "ARB Diameter", metric_value: "18 mm", is_mapped: true });
    expect(rows).toContainEqual({ tab: "Chassis", section: "Rear", label: "3rd Spring Rate", metric_value: "600 N/mm", is_mapped: true });
    expect(rows).toContainEqual({ tab: "Tires Aero", section: "Left Front", label: "Last Temps OMI", metric_value: "82C, 86C, 91C", is_mapped: true });
    expect(rows).toContainEqual({ tab: "Drivetrain", section: "Engine In Car Dials", label: "Throttle Shaping", metric_value: "9 (TPS)", is_mapped: true });
  });
});

describe("setupIdentityHash", () => {
  it("ignores readouts (tyre wear/temps, fuel and fuel-derived values) but not real setup changes", () => {
    const base = setupIdentityHash(setupParamsToRows(carSetup()));
    expect(setupIdentityHash(setupParamsToRows(carSetup({ tread: "80%, 81%, 79%", fuel: "100.0 L" })))).toBe(base);
    expect(setupIdentityHash(setupParamsToRows(carSetup({ wing: "21.0 deg" })))).not.toBe(base);
    expect(setupIdentityHash(setupParamsToRows(carSetup({ bias: "56.0%" })))).not.toBe(base);
  });
});

describe("classifyAgainstFixed", () => {
  const fixed = setupParamsToRows(carSetup());
  it("is fixed only when every comparable parameter equals a known fixed setup of the car", () => {
    expect(classifyAgainstFixed(setupParamsToRows(carSetup()), [fixed])).toBe("fixed");
    // Readouts and cockpit adjustments (brake bias, dials) may differ in a fixed session.
    expect(classifyAgainstFixed(setupParamsToRows(carSetup({ tread: "50%, 50%, 50%", fuel: "20.0 L", bias: "55.0%" })), [fixed])).toBe("fixed");
    // Formatting noise (explicit plus sign, spacing, case) is not a difference.
    const noisy = fixed.map((row) => row.label === "Toe In" && row.section === "Left Rear" ? { ...row, metric_value: "0  MM" } : row);
    expect(classifyAgainstFixed(setupParamsToRows(carSetup()), [noisy])).toBe("fixed");
  });
  it("is unknown (never commercial) when a setup parameter differs or nothing comparable is known", () => {
    expect(classifyAgainstFixed(setupParamsToRows(carSetup({ wing: "22.0 deg" })), [fixed])).toBe("unknown");
    expect(classifyAgainstFixed(setupParamsToRows(carSetup({ coldLf: "150 kPa" })), [fixed])).toBe("unknown");
    expect(classifyAgainstFixed(setupParamsToRows(carSetup()), [])).toBe("unknown");
    expect(classifyAgainstFixed(setupParamsToRows(carSetup()), [null, "x", [{ foo: 1 }]])).toBe("unknown");
    // Too little overlap (e.g. another car's naming) is not evidence of the fixed setup.
    expect(classifyAgainstFixed(setupParamsToRows(carSetup()), [fixed.slice(0, 6)])).toBe("unknown");
  });
  it("finds the matching fixed setup among several candidates", () => {
    expect(classifyAgainstFixed(setupParamsToRows(carSetup()), [setupParamsToRows(carSetup({ wing: "9 deg" })), fixed])).toBe("fixed");
  });
});

describe("parseAgentIbtSetup", () => {
  it("accepts the driver's own CarSetup and resolves the season from the recording time", () => {
    const setup = parseAgentIbtSetup(payload(), 42);
    expect(setup.season.id).toBe("35");
    expect(setup.nativeCarId).toBe(191);
    expect(setup.rows.length).toBeGreaterThan(20);
    const a = ibtSetupIdentity(setup, 10, 20), b = ibtSetupIdentity(parseAgentIbtSetup(payload({ parameters: carSetup({ tread: "1%, 1%, 1%" }) }), 42), 10, 20);
    expect(a).toEqual(b);
    expect(a.key).toMatch(/^ibt_setup:[a-f0-9]{64}$/);
    expect(a.filename).toMatch(/^IBT [a-f0-9]{8}$/);
    expect(ibtSetupIdentity(setup, 10, 21).key).not.toBe(a.key);
  });
  it("rejects another customer, missing ids, nested/raw YAML and oversized trees", () => {
    const bad = (p: unknown) => expect(() => parseAgentIbtSetup(p, 42)).toThrow(AgentValidationError);
    bad(payload({ customerId: 43 }));
    bad(payload({ nativeCarId: undefined }));
    bad({ ...payload(), kind: "ibt_result" });
    bad(payload({ parameters: "CarSetup:\n UpdateCount: 1" }));
    bad(payload({ parameters: { Chassis: { Front: { Arb: { Deep: "1" } } } } }));
    bad(payload({ parameters: { Chassis: { Front: { "User Name": "x" } } } }));
    bad(payload({ parameters: {} }));
    bad(payload({ recordedAt: "2001-01-01T00:00:00Z" }));
    const huge = { T: Object.fromEntries(Array.from({ length: 81 }, (_, s) => [`S${s}`, Object.fromEntries(Array.from({ length: 10 }, (_, l) => [`L${l}`, "1"]))])) };
    bad(payload({ parameters: huge }));
  });
});
