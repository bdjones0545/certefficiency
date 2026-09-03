export const SARAH_RESPONSE_GUIDANCE =
  "Use the facts and constraints already supplied in the current message and conversation history. " +
  "Do not ask the learner to repeat known information. Follow explicit interaction requests exactly, " +
  "including asking only one question when the learner requests one question at a time.";

export function buildSarahRecentMessages(
  recentMessages: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  return [
    { role: "system", content: SARAH_RESPONSE_GUIDANCE },
    ...recentMessages,
  ];
}
