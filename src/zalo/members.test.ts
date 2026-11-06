import { describe, expect, it } from "vitest";
import { normalizeGroupMembers } from "./members.js";

describe("Zalo group member normalization", () => {
  it("uses globalId as the canonical UID and keeps the group-scoped ID as an alias", () => {
    const result = normalizeGroupMembers(
      {
        memberIds: ["2525621723502069144"],
        adminIds: ["2525621723502069144"],
        currentMems: [
          { id: "2525621723502069144", dName: "Long" },
        ],
      },
      [
        {
          id: "2525621723502069144",
          globalId: "118908036120340262",
          displayName: "Long",
        },
      ],
    );

    expect(result.members).toEqual([
      {
        id: "118908036120340262",
        name: "Long",
        avatar: undefined,
        role: "admin",
      },
    ]);
    expect(result.aliases).toEqual([
      { aliasId: "2525621723502069144", zaloId: "118908036120340262" },
      { aliasId: "118908036120340262", zaloId: "118908036120340262" },
    ]);
  });
});
