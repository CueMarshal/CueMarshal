import { describe, expect, it } from "@jest/globals";
import { isSonarFinding } from "../../utils/issue-classification.js";

describe("isSonarFinding", () => {
  it("detects sonar by source label", () => {
    expect(isSonarFinding({ labels: ["source:sonar"] })).toBe(true);
  });

  it("detects sonar by generic sonar label", () => {
    expect(isSonarFinding({ labels: ["bug", "sonar"] })).toBe(true);
  });

  it("detects sonar by body marker", () => {
    expect(isSonarFinding({ labels: ["bug"], body: "Sonar Key: abc-123" })).toBe(true);
  });

  it("does not classify regular issues as sonar", () => {
    expect(
      isSonarFinding({
        labels: ["bug", "role:developer"],
        body: "A normal issue reported by a user.",
      })
    ).toBe(false);
  });
});
