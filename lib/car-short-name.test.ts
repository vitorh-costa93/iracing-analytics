import { describe, expect, it } from "vitest";
import { shortCarName } from "./car-short-name";

describe("shortCarName", () => {
  it("usa a marca ou o nome pelo qual o carro é chamado", () => {
    expect(shortCarName("Cadillac V-Series.R GTP")).toBe("Cadillac");
    expect(shortCarName("Aston Martin Vantage GT3 EVO")).toBe("Aston Martin");
    expect(shortCarName("Ford Mustang GT3")).toBe("Mustang");
    expect(shortCarName("Mercedes-AMG GT3 2020")).toBe("Mercedes");
    expect(shortCarName("McLaren 720S GT3 EVO")).toBe("McLaren");
    expect(shortCarName("Chevrolet Corvette Z06 GT3.R")).toBe("Corvette");
    expect(shortCarName("BMW M Hybrid V8")).toBe("BMW");
  });
});
