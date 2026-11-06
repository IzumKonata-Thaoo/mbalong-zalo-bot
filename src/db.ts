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
    db.prepare("UPDATE groups SET member_count=? WHERE id=?").run(members.length,groupId);
  },
  members(groupId: string) { return db.prepare("SELECT * FROM members WHERE group_id=? ORDER BY role DESC,display_name").all(groupId); },
  member(groupId:string,zaloId:string) { return db.prepare("SELECT * FROM members WHERE group_id=? AND zalo_id=?").get(groupId,zaloId) as {zalo_id:string;role:string}|undefined; },
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
