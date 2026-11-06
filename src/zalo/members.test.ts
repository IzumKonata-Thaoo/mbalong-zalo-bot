import { describe, expect, it } from "vitest";
import {
  extractGroupMemberIds,
  fetchGroupMemberProfiles,
  fetchLinkedGroupSnapshot,
  fetchLinkedGroupMembers,
  normalizeGroupMembers,
} from "./members.js";

describe("Zalo group member normalization", () => {
  it("reads owner and deputy IDs from the independent group-link endpoint", async () => {
    const snapshot = await fetchLinkedGroupSnapshot("group-1", {
      getGroupLinkDetail: async () => ({ enabled: 1, link: "join-link" }),
      getGroupLinkInfo: async () => ({
        creatorId: "owner-from-link",
        adminIds: ["deputy-from-link"],
        admins: [{ id: "admin-object-from-link" }],
        currentMems: [{ id: "owner-from-link" }],
        hasMoreMember: 0,
        totalMember: 1,
      }),
    }, false);

    expect(snapshot).toMatchObject({
      creatorId: "owner-from-link",
      adminIds: ["deputy-from-link"],
      members: [{ id: "owner-from-link" }],
    });
  });

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

  it("keeps the numeric member-list UID canonical and the profile IDs as aliases", async () => {
    const profiles = await fetchGroupMemberProfiles(
      ["2525621723502069144"],
      async () => ({
        profiles: {
          "2525621723502069144": {
            id: "different-profile-id",
            globalId: "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00",
            displayName: "Long",
          },
        },
      }),
    );
    const result = normalizeGroupMembers(
      {
        memberIds: ["2525621723502069144"],
        creatorId: "2525621723502069144",
        adminIds: [],
        currentMems: [],
      },
      profiles,
    );

    expect(result.members).toEqual([
      { id: "2525621723502069144", name: "Long", avatar: undefined, role: "admin" },
    ]);
    expect(result.aliases).toEqual(expect.arrayContaining([
      { aliasId: "2525621723502069144", zaloId: "2525621723502069144" },
      { aliasId: "different-profile-id", zaloId: "2525621723502069144" },
      { aliasId: "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00", zaloId: "2525621723502069144" },
    ]));
  });

  it("merges a link member listed by globalId with the numeric UID from getGroupInfo", () => {
    const result = normalizeGroupMembers(
      {
        memVerList: ["2525621723502069144_3", "3333333333333333333_0"],
        adminIds: ["NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00"],
        currentMems: [{ id: "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00", dName: "Hạ My" }],
      },
      [
        { __lookupId: "2525621723502069144", id: "2525621723502069144", globalId: "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00", displayName: "Hạ My" },
        { __lookupId: "3333333333333333333", id: "3333333333333333333", displayName: "Tú" },
      ],
    );
    expect(result.members).toEqual([
      { id: "2525621723502069144", name: "Hạ My", avatar: undefined, role: "admin" },
      { id: "3333333333333333333", name: "Tú", avatar: undefined, role: "member" },
    ]);
  });

  it("never collapses members that Zalo returns with the same globalId/profile id", () => {
    const shared = "118908036120340262";
    const result = normalizeGroupMembers(
      {
        memVerList: ["7752116371940807681_0", "5550000000000000001_0", "5550000000000000002_0"],
        creatorId: "5550000000000000001",
        adminIds: [],
        currentMems: [],
      },
      [
        { __lookupId: "7752116371940807681", id: shared, globalId: "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00", displayName: "Quynhh Giangg" },
        { __lookupId: "5550000000000000001", id: shared, globalId: "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00", displayName: "Phương Anh" },
        { __lookupId: "5550000000000000002", id: shared, globalId: "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00", displayName: "Đặng Gia Bảo" },
      ],
    );
    expect(result.members).toEqual([
      { id: "7752116371940807681", name: "Quynhh Giangg", avatar: undefined, role: "member" },
      { id: "5550000000000000001", name: "Phương Anh", avatar: undefined, role: "admin" },
      { id: "5550000000000000002", name: "Đặng Gia Bảo", avatar: undefined, role: "member" },
    ]);
    expect(result.aliases.map((alias) => alias.aliasId)).not.toContain(shared);
    expect(result.aliases.map((alias) => alias.aliasId)).not.toContain("NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00");
    expect(result.ambiguousIds).toEqual(expect.arrayContaining([shared, "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00"]));
  });

  it("never merges a profile into another member's list UID", () => {
    const result = normalizeGroupMembers(
      { memVerList: ["5550000000000000001_0", "5550000000000000002_0"], adminIds: ["5550000000000000002"] },
      [{ __lookupId: "5550000000000000001", id: "5550000000000000002", displayName: "A" }],
    );
    expect(result.members.map((m) => [m.id, m.role])).toEqual([
      ["5550000000000000001", "member"],
      ["5550000000000000002", "admin"],
    ]);
  });

  it("counts the owner and deputies as members even when the member list is empty", () => {
    expect(
      extractGroupMemberIds({
        memberIds: [],
        memVerList: [],
        currentMems: [],
        creatorId: "1000000001",
        adminIds: ["1000000002"],
      }),
    ).toEqual(["1000000001", "1000000002"]);
  });

  it("treats a link that reports enabled as true/\"1\" as enabled", async () => {
    const snapshot = await fetchLinkedGroupSnapshot("group-1", {
      getGroupLinkDetail: async () => ({ enabled: "1", link: "join-link" }),
      getGroupLinkInfo: async () => ({
        creatorId: "1000000001",
        currentMems: [{ id: "1000000001" }],
        hasMoreMember: 0,
        totalMember: 1,
      }),
    });
    expect(snapshot.linkEnabled).toBe(true);
    expect(snapshot.creatorId).toBe("1000000001");
  });

  it("keeps earlier link pages when a later page fails", async () => {
    const snapshot = await fetchLinkedGroupSnapshot("group-1", {
      getGroupLinkDetail: async () => ({ enabled: 1, link: "join-link" }),
      getGroupLinkInfo: async ({ memberPage }) => {
        if (memberPage === 2) throw new Error("boom");
        return { currentMems: [{ id: "1000000001" }], hasMoreMember: 1, totalMember: 5 };
      },
    });
    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.error).toContain("boom");
  });
});
