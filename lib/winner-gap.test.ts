import { describe, expect, it } from "vitest";
import { aggregateWinnerGapByTrack, dropEarlyExitRaces, classWinnerFastestLap, normalizeRaceClass, parseLapTimeSeconds, raceWinnerGap } from "./winner-gap";

const classes: Record<string, string> = {
  "Acura ARX-06 GTP": "GTP",
  "Dallara P217": "LMP2",
  "Ferrari 296 GT3": "GT3",
  "BMW M4 GT3": "GT3",
};
const classOf = (car: string) => classes[car] ?? null;

describe("parseLapTimeSeconds", () => {
  it("parses M:SS.mmm", () => expect(parseLapTimeSeconds("1:27.305")).toBeCloseTo(87.305));
  it("returns null for missing or malformed text", () => {
    expect(parseLapTimeSeconds(null)).toBeNull();
    expect(parseLapTimeSeconds("—")).toBeNull();
  });
});

describe("classWinnerFastestLap", () => {
  const finishers = [
    { carName: "Acura ARX-06 GTP", fastestLapTime: "1:15.000" },
    { carName: "Dallara P217", fastestLapTime: "1:19.000" },
    { carName: "BMW M4 GT3", fastestLapTime: "1:25.500" },
    { carName: "Ferrari 296 GT3", fastestLapTime: "1:25.100" },
  ];

  it("uses the overall winner in a single-class race", () => {
    expect(classWinnerFastestLap({ multiclass: false, carName: "Ferrari 296 GT3", finishers }, classOf)).toBe("1:15.000");
  });

  it("uses the first finisher of the driver's own class in a multiclass race", () => {
    expect(classWinnerFastestLap({ multiclass: true, carName: "Ferrari 296 GT3", finishers }, classOf)).toBe("1:25.500");
    expect(classWinnerFastestLap({ multiclass: true, carName: "Dallara P217", finishers }, classOf)).toBe("1:19.000");
  });

  it("returns null when the driver's class can't be resolved", () => {
    expect(classWinnerFastestLap({ multiclass: true, carName: "Unknown Car", finishers }, classOf)).toBeNull();
  });
});

describe("normalizeRaceClass", () => {
  it("maps group names to a single race class", () => {
    expect(normalizeRaceClass("Ferrari 296 GT3", ["GT3 Class", "Ferrari"])).toBe("GT3");
    expect(normalizeRaceClass("Acura ARX-06 GTP", ["IMSA GTP"])).toBe("GTP");
  });
  it("forces Dallara P217 to LMP2", () => expect(normalizeRaceClass("Dallara P217", [])).toBe("LMP2"));
  it("returns null when unknown or ambiguous", () => {
    expect(normalizeRaceClass("Mystery", ["Road cars"])).toBeNull();
    expect(normalizeRaceClass("Weird", ["GT3", "GT4"])).toBeNull();
  });
});

describe("raceWinnerGap", () => {
  it("computes seconds and percentage behind the winner", () => {
    const gap = raceWinnerGap("1:28.000", "1:27.000");
    expect(gap?.seconds).toBeCloseTo(1);
    expect(gap?.pct).toBeCloseTo(1.149, 2);
  });

  it("returns null when either lap is missing", () => {
    expect(raceWinnerGap(null, "1:27.000")).toBeNull();
    expect(raceWinnerGap("1:27.000", null)).toBeNull();
  });
});

describe("aggregateWinnerGapByTrack", () => {
  it("averages per track, skips races without both laps, and sorts by smallest gap in seconds first", () => {
    const result = aggregateWinnerGapByTrack([
      { track_name: "Monza", fastest_lap_time: "1:22.000", winner_fastest_lap_time: "1:21.000" },
      { track_name: "Monza", fastest_lap_time: "1:21.500", winner_fastest_lap_time: "1:21.000" },
      { track_name: "Suzuka", fastest_lap_time: "1:40.000", winner_fastest_lap_time: "1:40.000" },
      { track_name: "Spa", fastest_lap_time: null, winner_fastest_lap_time: "2:00.000" },
    ]);
    expect(result.map((row) => row.track)).toEqual(["Suzuka", "Monza"]);
    const monza = result[1];
    expect(monza.races).toBe(2);
    expect(monza.avgGapSeconds).toBeCloseTo(0.75);
    expect(monza.bestGapSeconds).toBeCloseTo(0.5);
    expect(monza.worstGapSeconds).toBeCloseTo(1);
  });
});

describe("aggregateWinnerGapByTrack outliers and car grouping", () => {
  it("drops races whose gap is implausible (>5%)", () => {
    const result = aggregateWinnerGapByTrack([
      { track_name: "Imola", fastest_lap_time: "1:30.000", winner_fastest_lap_time: "1:29.000" },
      { track_name: "Imola", fastest_lap_time: "2:26.000", winner_fastest_lap_time: "1:29.000" },
    ]);
    expect(result[0].races).toBe(1);
    expect(result[0].avgGapSeconds).toBeCloseTo(1);
  });

  it("can group by car", () => {
    const result = aggregateWinnerGapByTrack(
      [
        { track_name: "A", car_name: "X", fastest_lap_time: "1:30.000", winner_fastest_lap_time: "1:29.000" },
        { track_name: "B", car_name: "X", fastest_lap_time: "1:30.000", winner_fastest_lap_time: "1:28.000" },
      ],
      "car"
    );
    expect(result).toHaveLength(1);
    expect(result[0].track).toBe("X");
    expect(result[0].races).toBe(2);
  });
});

describe("dropEarlyExitRaces", () => {
  const base = { track_name: "Spa", car_name: "SF23", series_name: "SF", fastest_lap_time: "1:54.000", winner_fastest_lap_time: "1:52.000" };
  it("drops races finished under 60% of the usual distance, keeps full ones", () => {
    const rows = [
      { ...base, laps: 19 }, { ...base, laps: 19 }, { ...base, laps: 20 }, { ...base, laps: 19 },
      { ...base, laps: 5 },
    ];
    expect(dropEarlyExitRaces(rows).map((r) => r.laps)).toEqual([19, 19, 20, 19]);
  });
  it("does not compare across series or when laps are unknown", () => {
    const rows = [
      { ...base, laps: 19 }, { ...base, laps: 19 },
      { ...base, series_name: "Sprint", laps: 6 },
      { ...base, laps: null },
    ];
    expect(dropEarlyExitRaces(rows)).toHaveLength(4);
  });
});
