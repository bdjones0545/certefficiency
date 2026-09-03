import { describe, expect, it } from "vitest";
import {
  buildSarahRecentMessages,
  SARAH_RESPONSE_GUIDANCE,
} from "../lib/sarah/contextGuidance";

describe("Sarah conversation guidance", () => {
  it("places response guidance before conversation history", () => {
    const history = [{ role: "user", content: "My exam is in eight weeks." }];
    const result = buildSarahRecentMessages(history);

    expect(result[0]).toEqual({ role: "system", content: SARAH_RESPONSE_GUIDANCE });
    expect(result.slice(1)).toEqual(history);
  });

  it("instructs Sarah not to request facts the learner already supplied", () => {
    expect(SARAH_RESPONSE_GUIDANCE).toContain("Do not ask the learner to repeat known information");
    expect(SARAH_RESPONSE_GUIDANCE).toContain("one question at a time");
  });
});
