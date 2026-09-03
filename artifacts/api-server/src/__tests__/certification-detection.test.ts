import { describe, expect, it } from "vitest";
import { detectCertificationCode } from "../lib/certificationDetection";

describe("certification detection", () => {
  it.each([
    ["I'm preparing for the NSCA CSCS exam", "NSCA-CSCS"],
    ["Help me study for CSCS", "NSCA-CSCS"],
    ["My test is the NASM-CPT", "NASM-CPT"],
    ["I need an ACSM EP plan", "ACSM-EP"],
    ["Preparing for Security+", "COMPTIA-SEC+"],
    ["Taking AZ-104 next month", "AZ-104"],
  ])("detects %s", (text, expected) => {
    expect(detectCertificationCode(text)).toBe(expected);
  });

  it("does not guess from generic exam language", () => {
    expect(detectCertificationCode("I have an exam in eight weeks")).toBeNull();
  });
});
