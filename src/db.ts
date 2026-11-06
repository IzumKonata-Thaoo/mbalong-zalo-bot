import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import type { GroupRecord } from "./types.js";

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
export const db = new Database(config.DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Nhóm chưa đặt tên',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  member_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  zalo_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Thành viên',
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id, zalo_id)
);
CREATE TABLE IF NOT EXISTS member_aliases (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  alias_id TEXT NOT NULL,
  zalo_id TEXT NOT NULL,
  PRIMARY KEY(group_id, alias_id)
);
CREATE INDEX IF NOT EXISTS idx_member_aliases_zalo_id ON member_aliases(group_id, zalo_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  zalo_message_id TEXT,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages(group_id, created_at DESC);
CREATE TABLE IF NOT EXISTS summaries (
  group_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  through_message_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wallets (
  zalo_id TEXT PRIMARY KEY,
  balance TEXT NOT NULL DEFAULT '0',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

export const repository = {
  upsertGroup(id: string, name: string, memberCount = 0) {
    db.prepare(`INSERT INTO groups(id,name,member_count,last_seen_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, member_count=MAX(excluded.member_count,groups.member_count), last_seen_at=CURRENT_TIMESTAMP`).run(id, name || `Nhóm ${id}`, memberCount);
  },
  groups(): GroupRecord[] {
    return db.prepare("SELECT * FROM groups ORDER BY enabled DESC, last_seen_at DESC").all() as GroupRecord[];
  },
  group(id: string): GroupRecord | undefined {
    return db.prepare("SELECT * FROM groups WHERE id=?").get(id) as GroupRecord | undefined;
  },
  setGroupEnabled(id: string, enabled: boolean) {
    db.prepare("UPDATE groups SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id);
  },
  saveMessage(groupId: string, messageId: string | null, senderId: string, senderName: string, role: "user" | "assistant", content: string) {
    return Number(db.prepare("INSERT INTO messages(group_id,zalo_message_id,sender_id,sender_name,role,content) VALUES(?,?,?,?,?,?)")
      .run(groupId, messageId, senderId, senderName, role, content).lastInsertRowid);
  },
  recentMessages(groupId: string, limit = 24) {
    return (db.prepare("SELECT role,content,sender_name FROM messages WHERE group_id=? ORDER BY id DESC LIMIT ?").all(groupId, limit) as Array<{role:"user"|"assistant";content:string;sender_name:string}>).reverse();
  },
  messagesAfter(groupId: string, afterId: number, limit = 100) {
    return db.prepare("SELECT id,role,content,sender_name,created_at FROM messages WHERE group_id=? AND id>? ORDER BY id LIMIT ?").all(groupId, afterId, limit) as Array<Record<string, unknown>>;
  },
  summary(groupId: string) {
    return db.prepare("SELECT content,through_message_id FROM summaries WHERE group_id=?").get(groupId) as {content:string;through_message_id:number}|undefined;
  },
  saveSummary(groupId: string, content: string, throughId: number) {
    db.prepare(`INSERT INTO summaries(group_id,content,through_message_id) VALUES(?,?,?)
      ON CONFLICT(group_id) DO UPDATE SET content=excluded.content,through_message_id=excluded.through_message_id,updated_at=CURRENT_TIMESTAMP`).run(groupId, content, throughId);
  },
  upsertMembers(groupId: string, members: Array<{id:string;name:string;avatar?:string;role?:string}>) {
    const stmt = db.prepare(`INSERT INTO members(group_id,zalo_id,display_name,avatar,role) VALUES(?,?,?,?,?)
      ON CONFLICT(group_id,zalo_id) DO UPDATE SET display_name=excluded.display_name,avatar=excluded.avatar,role=excluded.role,updated_at=CURRENT_TIMESTAMP`);
    db.transaction(() => members.forEach((m) => stmt.run(groupId,m.id,m.name,m.avatar ?? null,m.role ?? "member")))();
    db.prepare("UPDATE groups SET member_count=MAX(member_count,?) WHERE id=?").run(members.length,groupId);
  },
  replaceMembers(
    groupId: string,
    members: Array<{id:string;name:string;avatar?:string;role?:string}>,
    aliases: Array<{aliasId:string;zaloId:string}>,
  ) {
    const memberStmt = db.prepare(`INSERT INTO members(group_id,zalo_id,display_name,avatar,role) VALUES(?,?,?,?,?)`);
    const aliasStmt = db.prepare(`INSERT INTO member_aliases(group_id,alias_id,zalo_id) VALUES(?,?,?)
      ON CONFLICT(group_id,alias_id) DO UPDATE SET zalo_id=excluded.zalo_id`);
    db.transaction(() => {
      db.prepare("DELETE FROM member_aliases WHERE group_id=?").run(groupId);
      db.prepare("DELETE FROM members WHERE group_id=?").run(groupId);
      members.forEach((m) => memberStmt.run(groupId,m.id,m.name,m.avatar ?? null,m.role ?? "member"));
      aliases.forEach((a) => aliasStmt.run(groupId,a.aliasId,a.zaloId));
      db.prepare("UPDATE groups SET member_count=? WHERE id=?").run(members.length,groupId);
    })();
  },
  upsertMemberAliases(groupId:string, aliases:Array<{aliasId:string;zaloId:string}>) {
    const stmt = db.prepare(`INSERT INTO member_aliases(group_id,alias_id,zalo_id) VALUES(?,?,?)
      ON CONFLICT(group_id,alias_id) DO UPDATE SET zalo_id=excluded.zalo_id`);
    const removeStaleMember = db.prepare("DELETE FROM members WHERE group_id=? AND zalo_id=?");
    db.transaction(() => aliases.forEach((a) => {
      stmt.run(groupId,a.aliasId,a.zaloId);
      if (a.aliasId !== a.zaloId) removeStaleMember.run(groupId,a.aliasId);
    }))();
  },
  resolveMemberId(groupId:string, candidates:Array<string|undefined|null>) {
    const aliasQuery = db.prepare("SELECT zalo_id FROM member_aliases WHERE group_id=? AND alias_id=?");
    const memberQuery = db.prepare("SELECT zalo_id FROM members WHERE group_id=? AND zalo_id=?");
    const ids = candidates.map((value) => String(value ?? "").trim()).filter(Boolean);
    for (const id of ids) {
      const alias = aliasQuery.get(groupId,id) as {zalo_id:string}|undefined;
      if (alias?.zalo_id) return alias.zalo_id;
      const member = memberQuery.get(groupId,id) as {zalo_id:string}|undefined;
      if (member?.zalo_id) return member.zalo_id;
    }
    return ids[0] ?? "";
  },
  members(groupId: string) { return db.prepare("SELECT * FROM members WHERE group_id=? ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,display_name").all(groupId); },
  member(groupId:string,zaloId:string) { return db.prepare("SELECT * FROM members WHERE group_id=? AND zalo_id=?").get(groupId,zaloId) as {zalo_id:string;display_name:string;role:string}|undefined; },
  walletBalance(zaloId:string) {
    const row=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(zaloId) as {balance:string}|undefined;
    return BigInt(row?.balance ?? "0");
  },
  adjustWalletBalance(zaloId:string,delta:bigint): {ok:true;previous:bigint;balance:bigint}|{ok:false;balance:bigint} {
    return db.transaction(() => {
      const row=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(zaloId) as {balance:string}|undefined;
      const previous=BigInt(row?.balance ?? "0"), balance=previous+delta;
      if(balance<0n)return {ok:false as const,balance:previous};
      db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`).run(zaloId,balance.toString());
      return {ok:true as const,previous,balance};
    })();
  },
  settleTaiXiu(zaloId:string,stake:bigint,won:boolean): {ok:true;previous:bigint;balance:bigint}|{ok:false;balance:bigint} {
    return db.transaction(() => {
      const row=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(zaloId) as {balance:string}|undefined;
      const previous=BigInt(row?.balance ?? "0");
      if(previous<stake)return {ok:false as const,balance:previous};
      const balance=won ? previous+stake : previous-stake;
      db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`).run(zaloId,balance.toString());
      return {ok:true as const,previous,balance};
    })();
  },
  stats() {
    return {
      groups: (db.prepare("SELECT COUNT(*) n FROM groups").get() as {n:number}).n,
      activeGroups: (db.prepare("SELECT COUNT(*) n FROM groups WHERE enabled=1").get() as {n:number}).n,
      members: (db.prepare("SELECT COUNT(*) n FROM members").get() as {n:number}).n,
      messages: (db.prepare("SELECT COUNT(*) n FROM messages").get() as {n:number}).n
    };
  },
  audit(actorId:string, action:string, target?:string, detail?:unknown) {
    db.prepare("INSERT INTO audit_logs(actor_id,action,target,detail) VALUES(?,?,?,?)").run(actorId,action,target ?? null,detail ? JSON.stringify(detail) : null);
  },
  audits(limit=50) { return db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?").all(limit); },
  setting(key:string) { return (db.prepare("SELECT value FROM settings WHERE key=?").get(key) as {value:string}|undefined)?.value; },
  setSettings(values:Record<string,string>) {
    const stmt=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    db.transaction(()=>Object.entries(values).forEach(([key,value])=>stmt.run(key,value)))();
  },
  deleteSetting(key:string) { db.prepare("DELETE FROM settings WHERE key=?").run(key); }
};
