import { describe, expect, it } from "vitest";
import {
  extractGroupMemberIds,
  fetchGroupMemberProfiles,
  fetchLinkedGroupMembers,
  normalizeGroupMembers,
} from "./members.js";

describe("Zalo group member normalization", () => {
  it("loads every member page when group info only exposes one member", async () => {
    const pages: number[] = [];
    const members = await fetchLinkedGroupMembers("group-1", {
      getGroupLinkDetail: async () => ({ enabled: 1, link: "join-link" }),
      getGroupLinkInfo: async ({ memberPage }: { memberPage?: number }) => {
        pages.push(memberPage ?? 1);
        return memberPage === 1
          ? { currentMems: [{ id: "111" }], hasMoreMember: 1, totalMember: 3 }
          : { currentMems: [{ id: "222" }, { id: "333" }], hasMoreMember: 0, totalMember: 3 };
      },
    });

    expect(members.map((member) => member.id)).toEqual(["111", "222", "333"]);
    expect(pages).toEqual([1, 2]);
  });

  it("reads member IDs from memVerList when memberIds and currentMems are empty", () => {
    expect(
      extractGroupMemberIds({
        memberIds: [],
        currentMems: [],
        memVerList: ["118908036120340262_0", "222_7"],
      }),
    ).toEqual(["118908036120340262", "222"]);
  });

  it("isolates a member that makes Zalo reject the whole profile batch with code 114", async () => {
    const calls: string[][] = [];
    const profiles = await fetchGroupMemberProfiles(
      ["111", "999", "222"],
      async (ids) => {
        calls.push(ids);
        if (ids.includes("999")) throw Object.assign(new Error("Tham số không hợp lệ"), { code: 114 });
        return {
          profiles: Object.fromEntries(
            ids.map((id) => [id, { id, globalId: `global-${id}` }]),
          ),
        };
      },
    );

    expect(profiles.map((profile) => profile.id)).toEqual(["111", "222"]);
    expect(calls).toContainEqual(["999"]);
  });

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
