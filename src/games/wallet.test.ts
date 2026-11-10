import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IncomingGroupMessage } from "../types.js";

const dir = mkdtempSync(join(tmpdir(), "mbalong-wallet-"));
process.env.ADMIN_PASSWORD = "test-password-123456";
process.env.JWT_SECRET = "x".repeat(40);
process.env.DATABASE_PATH = join(dir, "bot.db");
process.env.ZALO_ADMIN_IDS = "";

let repository: typeof import("../db.js").repository;
let db: typeof import("../db.js").db;
let handleWalletCommand: typeof import("./wallet.js").handleWalletCommand;

beforeAll(async () => {
  ({ repository, db } = await import("../db.js"));
  ({ handleWalletCommand } = await import("./wallet.js"));
  repository.upsertGroup("g1", "Nhóm test", 32);
});
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function message(partial: Partial<IncomingGroupMessage>): IncomingGroupMessage {
  return {
    groupId: "g1",
    senderId: "1000000001",
    senderIds: ["1000000001"],
    senderName: "Chủ nhóm",
    content: "",
    messageId: "m1",
    mentions: [],
    raw: {},
    ...partial,
  };
}

const deps = (isAdmin: boolean) => ({
  botIds: new Set(["9000000009"]),
  isAdmin: async () => isAdmin,
  findMember: async (_groupId: string, id: string) =>
    repository.member("g1", repository.resolveMemberId("g1", [id])) ? id : "",
});

describe("/nap and /tru", () => {
  it("rejects a non-admin", async () => {
    const reply = await handleWalletCommand(message({}), "/nap 100", deps(false));
    expect(reply).toMatch(/không có quyền/);
  });

  it("credits a tagged member who was never synced into the member list", async () => {
    const content = "@MbaLong @Tú /nap 5000";
    const reply = await handleWalletCommand(
      message({
        content,
        mentions: [
          { uid: "9000000009", pos: 0, len: 8 },
          { uid: "2000000002", pos: 9, len: 3 },
        ],
      }),
      "@Tú /nap 5000",
      deps(true),
    );
    expect(reply).toContain("CỘNG SỐ DƯ");
    expect(reply).toContain("Tú");
    expect(repository.walletBalance("2000000002")).toBe(5000n);
  });

  it("credits the admin themself when nobody is tagged", async () => {
    await handleWalletCommand(message({}), "/nap 700", deps(true));
    expect(repository.walletBalance("1000000001")).toBe(700n);
  });

  it("rejects a typed ID that is not in the group", async () => {
    const reply = await handleWalletCommand(message({}), "/nap 3000000003 10", deps(true));
    expect(reply).toMatch(/Không tìm thấy Zalo ID/);
  });

  it("moves an old globalId-keyed wallet onto the numeric UID during re-sync", () => {
    const globalId = "NOUL6BL3CKBPJ8DQVPBVJ4U70LQJQV00";
    repository.adjustWalletBalance(globalId, 1200n);
    repository.upsertMembers("g1", [{ id: globalId, name: "Hạ My", role: "admin" }]);
    repository.upsertMemberAliases("g1", [{ aliasId: "4000000004", zaloId: globalId }]);
    expect(repository.resolveMemberId("g1", ["4000000004"])).toBe(globalId);

    repository.upsertMembers("g1", [{ id: "4000000004", name: "Hạ My", role: "admin" }]);
    repository.upsertMemberAliases("g1", [
      { aliasId: "4000000004", zaloId: "4000000004" },
      { aliasId: globalId, zaloId: "4000000004" },
    ]);
    expect(repository.resolveMemberId("g1", ["4000000004"])).toBe("4000000004");
    expect(repository.resolveMemberId("g1", [globalId])).toBe("4000000004");
    expect(repository.member("g1", globalId)).toBeUndefined();
    expect(repository.walletBalance("4000000004")).toBe(1200n);
    expect(repository.walletBalance(globalId)).toBe(0n);
    expect([...repository.identityIds("g1", ["4000000004"])]).toEqual(
      expect.arrayContaining(["4000000004", globalId]),
    );
  });
});

describe("/chuyen", () => {
  it("atomically subtracts the sender and credits the tagged recipient", async () => {
    repository.adjustWalletBalance("sender-transfer", 5000n);
    const content = "@MbaLong @Lan /chuyen 3000";
    const reply = await handleWalletCommand(
      message({
        senderId: "sender-transfer",
        senderIds: ["sender-transfer"],
        senderName: "Người gửi",
        content,
        mentions: [
          { uid: "9000000009", pos: 0, len: 8 },
          { uid: "recipient-transfer", pos: 9, len: 4 },
        ],
      }),
      "@Lan /chuyen 3000",
      deps(false),
    );
    expect(reply).toContain("CHUYỂN TIỀN THÀNH CÔNG");
    expect(repository.walletBalance("sender-transfer")).toBe(2000n);
    expect(repository.walletBalance("recipient-transfer")).toBe(3000n);
  });

  it("does not change either wallet when the sender lacks funds", async () => {
    repository.adjustWalletBalance("sender-poor", 100n);
    repository.adjustWalletBalance("recipient-safe", 700n);
    const reply = await handleWalletCommand(
      message({
        senderId: "sender-poor",
        senderIds: ["sender-poor"],
        content: "@MbaLong @Lan /chuyen 500",
        mentions: [
          { uid: "9000000009", pos: 0, len: 8 },
          { uid: "recipient-safe", pos: 9, len: 4 },
        ],
      }),
      "@Lan /chuyen 500",
      deps(false),
    );
    expect(reply).toContain("Số dư không đủ");
    expect(repository.walletBalance("sender-poor")).toBe(100n);
    expect(repository.walletBalance("recipient-safe")).toBe(700n);
  });
});
