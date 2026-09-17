import { expect } from "chai";
import { validateSlitherReport, type SlitherReport } from "../../../src/security/slither-gate";

const finding = {
  check: "detector",
  first_markdown_element: "contracts/Example.sol#L1",
  elements: [{ type: "function", name: "example" }],
};
const baseline = ["detector|example|contracts/Example.sol#L1"];
const valid = (): SlitherReport => ({ success: true, error: null, results: { detectors: [finding] } });

describe("Slither gate report validation", () => {
  it("accepts only a successful report with an explicit detector array", () => {
    expect(validateSlitherReport(valid(), baseline)).to.deep.equal(baseline);
  });

  for (const [label, report] of [
    ["nonzero success", { ...valid(), success: false }],
    ["missing success", { error: null, results: { detectors: [finding] } }],
    ["error field", { ...valid(), error: "tool failed" }],
    ["missing detectors", { ...valid(), results: {} }],
    ["malformed detector", { ...valid(), results: { detectors: [{}] } }],
  ] as const) {
    it(`rejects ${label}`, () => expect(() => validateSlitherReport(report as SlitherReport, baseline)).to.throw());
  }

  it("rejects findings that are not in the reviewed baseline", () => {
    expect(() => validateSlitherReport({ ...valid(), results: { detectors: [{ ...finding, check: "new-detector" }] } }, baseline)).to.throw(/new-detector/);
  });
});
