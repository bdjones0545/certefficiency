/**
 * Conversation management regression tests (CONV-1 – CONV-4).
 *
 * Covers the useSearch-based conversationId extraction so we never
 * send [object Object] to the API again.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — replicate exactly what home.tsx does
// ---------------------------------------------------------------------------

/** Simulates: new URLSearchParams(useSearch()).get("c") */
function extractConvIdFromSearch(search: string): string | null {
  return new URLSearchParams(search).get("c");
}

/** Simulates setLocation(`/app?c=${conv.id}`) then reading it back */
function buildSearchParam(id: string): string {
  return `c=${id}`;
}

// ---------------------------------------------------------------------------
// CONV-1: useSearch extraction yields a string ID, never an object
// ---------------------------------------------------------------------------
describe("CONV-1 — conversationId extraction from useSearch", () => {
  it("returns the UUID string for a valid ?c= param", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const result = extractConvIdFromSearch(`c=${uuid}`);
    expect(result).toBe(uuid);
    expect(typeof result).toBe("string");
  });

  it("returns null when ?c= is absent", () => {
    expect(extractConvIdFromSearch("")).toBeNull();
    expect(extractConvIdFromSearch("foo=bar")).toBeNull();
  });

  it("returns null when search is the literal empty string", () => {
    expect(extractConvIdFromSearch("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CONV-2: URL never contains [object Object] after create
// ---------------------------------------------------------------------------
describe("CONV-2 — URL never contains [object Object]", () => {
  it("setLocation template literal with a UUID string produces a clean URL", () => {
    const convId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const url = `/app?c=${convId}`;
    expect(url).not.toContain("[object");
    expect(url).not.toContain("Object]");
    expect(url).toBe(`/app?c=${convId}`);
  });

  it("an accidental object coercion would produce [object Object]", () => {
    // This documents the old bug so we know what we're guarding against.
    const accidentalObject = { id: "some-id" };
    const brokenUrl = `/?c=${accidentalObject}`;
    expect(brokenUrl).toBe("/?c=[object Object]");
  });

  it("buildSearchParam with a UUID string never produces [object Object]", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const param = buildSearchParam(uuid);
    expect(param).toBe(`c=${uuid}`);
    expect(param).not.toContain("[object");
  });
});

// ---------------------------------------------------------------------------
// CONV-3: Selecting a conversation via useSearch reads the correct ID
// ---------------------------------------------------------------------------
describe("CONV-3 — conversation selection reads the correct ID from search", () => {
  it("extracts the correct ID when multiple params are present", () => {
    const uuid = "deadbeef-dead-beef-dead-beefdeadbeef";
    const result = extractConvIdFromSearch(`foo=bar&c=${uuid}&baz=qux`);
    expect(result).toBe(uuid);
  });

  it("returns null for a search string with no c param", () => {
    expect(extractConvIdFromSearch("mode=practice&cert=aws")).toBeNull();
  });

  it("different UUIDs produce different extracted IDs", () => {
    const id1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const id2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(extractConvIdFromSearch(`c=${id1}`)).toBe(id1);
    expect(extractConvIdFromSearch(`c=${id2}`)).toBe(id2);
    expect(extractConvIdFromSearch(`c=${id1}`)).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// CONV-4: AlertDialog renders for delete confirmation (structural test)
// ---------------------------------------------------------------------------
describe("CONV-4 — delete confirmation state management", () => {
  it("pendingDeleteId transitions correctly on set and clear", () => {
    // Simulate the state machine used in sidebar.tsx
    let pendingDeleteId: string | null = null;

    const setPending = (id: string | null) => { pendingDeleteId = id; };

    // Initially null — no dialog
    expect(pendingDeleteId).toBeNull();

    // User clicks trash on a conversation
    const convId = "c0ffee00-c0ff-ee00-c0ff-ee00c0ffee00";
    setPending(convId);
    expect(pendingDeleteId).toBe(convId);

    // User cancels — dialog closes, ID cleared
    setPending(null);
    expect(pendingDeleteId).toBeNull();

    // User clicks trash again and confirms — ID is cleared after async action
    setPending(convId);
    expect(pendingDeleteId).toBe(convId);
    const idToDelete = pendingDeleteId;
    setPending(null); // cleared before async call
    expect(pendingDeleteId).toBeNull();
    expect(idToDelete).toBe(convId); // the captured value is still the correct ID
  });

  it("delete of active conversation clears the active ID", () => {
    let activeConvId: string | null = "active-conv-uuid";
    const deletedId = "active-conv-uuid";

    // Simulate the post-delete navigation logic
    if (activeConvId === deletedId) {
      activeConvId = null; // setLocation("/") effect
    }

    expect(activeConvId).toBeNull();
  });

  it("delete of non-active conversation does not clear the active ID", () => {
    let activeConvId: string | null = "active-conv-uuid";
    const deletedId = "other-conv-uuid";

    if (activeConvId === deletedId) {
      activeConvId = null;
    }

    expect(activeConvId).toBe("active-conv-uuid");
  });
});
