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
CREATE TABLE IF NOT EXISTS game_stats (
  zalo_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT 'Người chơi',
  total_winnings TEXT NOT NULL DEFAULT '0',
  net_profit TEXT NOT NULL DEFAULT '0',
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chickens (
  zalo_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 1),
  aggression INTEGER NOT NULL,
  claws INTEGER NOT NULL,
  comb INTEGER NOT NULL,
  kick_power INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chicken_challenges (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  challenger_id TEXT NOT NULL,
  challenger_name TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  stake TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','declined','expired','resolved')),
  winner_id TEXT,
  challenger_score INTEGER,
  target_score INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chicken_challenge_target ON chicken_challenges(group_id,target_id,status,expires_at);
`);

function recordGameResult(
  zaloId: string,
  displayName: string,
  profit: bigint,
) {
  const current = db
    .prepare(
      "SELECT total_winnings,net_profit,games_played,games_won FROM game_stats WHERE zalo_id=?",
    )
    .get(zaloId) as
    | {
        total_winnings: string;
        net_profit: string;
        games_played: number;
        games_won: number;
      }
    | undefined;
  const totalWinnings =
    BigInt(current?.total_winnings ?? "0") + (profit > 0n ? profit : 0n);
  const netProfit = BigInt(current?.net_profit ?? "0") + profit;
  const safeName = displayName.trim().replace(/\s+/g, " ").slice(0, 80) || `Zalo ${zaloId.slice(-6)}`;
  db.prepare(
    `INSERT INTO game_stats(zalo_id,display_name,total_winnings,net_profit,games_played,games_won,updated_at)
     VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(zalo_id) DO UPDATE SET
       display_name=excluded.display_name,
       total_winnings=excluded.total_winnings,
       net_profit=excluded.net_profit,
       games_played=excluded.games_played,
       games_won=excluded.games_won,
       updated_at=CURRENT_TIMESTAMP`,
  ).run(
    zaloId,
    safeName,
    totalWinnings.toString(),
    netProfit.toString(),
    (current?.games_played ?? 0) + 1,
    (current?.games_won ?? 0) + (profit > 0n ? 1 : 0),
  );
}

/**
 * v3 member identity: older builds trusted profile globalId/id, which Zalo can
 * return identically for many members, so a whole group collapsed into one
 * member (wrong name, admin role leaked) and wallets were merged across
 * people. Drop the cached member list (it is re-synced from Zalo at login)
 * and undo every alias wallet merge. Wallet balances themselves are kept.
 */
function migrateMemberIdentityV3() {
  const done = db.prepare("SELECT value FROM settings WHERE key='member_identity_version'").get() as {value:string}|undefined;
  if (Number(done?.value ?? 0) >= 3) return;
  db.transaction(() => {
    const read = db.prepare("SELECT balance FROM wallets WHERE zalo_id=?");
    const write = db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`);
    const log = db.prepare("INSERT INTO audit_logs(actor_id,action,target,detail) VALUES(?,?,?,?)");
    const merges = db.prepare("SELECT id,target,detail FROM audit_logs WHERE action='wallet.merge_alias' ORDER BY id DESC").all() as Array<{id:number;target:string;detail:string}>;
    for (const merge of merges) {
      let detail: {from?:string;moved?:string};
      try { detail = JSON.parse(merge.detail); } catch { continue; }
      if (!detail.from || !detail.moved || !merge.target) continue;
      const current = BigInt((read.get(merge.target) as {balance:string}|undefined)?.balance ?? "0");
      const moved = BigInt(detail.moved);
      const back = current < moved ? current : moved;
      write.run(merge.target, (current - back).toString());
      const fromBalance = BigInt((read.get(detail.from) as {balance:string}|undefined)?.balance ?? "0");
      write.run(detail.from, (fromBalance + back).toString());
      log.run("system", "wallet.merge_alias_revert", merge.target, JSON.stringify({ mergeAuditId: merge.id, to: detail.from, returned: back.toString() }));
    }
    db.prepare("DELETE FROM member_aliases").run();
    db.prepare("DELETE FROM members").run();
    db.prepare(`INSERT INTO settings(key,value) VALUES('member_identity_version','3')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
  })();
}
migrateMemberIdentityV3();

/**
 * Older builds stored wallets under an alphanumeric globalId. When an alias
 * now points to a different canonical UID, move that balance onto the
 * canonical wallet so nobody loses money after a member re-sync.
 * Must be called inside a transaction.
 */
function mergeAliasWallets(aliases: Array<{aliasId:string;zaloId:string}>) {
  const read = db.prepare("SELECT balance FROM wallets WHERE zalo_id=?");
  const upsert = db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`);
  const remove = db.prepare("DELETE FROM wallets WHERE zalo_id=?");
  const log = db.prepare("INSERT INTO audit_logs(actor_id,action,target,detail) VALUES(?,?,?,?)");
  for (const { aliasId, zaloId } of aliases) {
    if (!aliasId || !zaloId || aliasId === zaloId) continue;
    const from = read.get(aliasId) as {balance:string}|undefined;
    if (from) {
      const to = read.get(zaloId) as {balance:string}|undefined;
      const merged = BigInt(to?.balance ?? "0") + BigInt(from.balance);
      upsert.run(zaloId, merged.toString());
      remove.run(aliasId);
      log.run("system", "wallet.merge_alias", zaloId, JSON.stringify({ from: aliasId, moved: from.balance, balanceAfter: merged.toString() }));
    }
    const aliasStats = db.prepare("SELECT * FROM game_stats WHERE zalo_id=?").get(aliasId) as Record<string,unknown>|undefined;
    if (aliasStats) {
      const targetStats = db.prepare("SELECT * FROM game_stats WHERE zalo_id=?").get(zaloId) as Record<string,unknown>|undefined;
      db.prepare(`INSERT INTO game_stats(zalo_id,display_name,total_winnings,net_profit,games_played,games_won,updated_at)
        VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET display_name=excluded.display_name,total_winnings=excluded.total_winnings,
          net_profit=excluded.net_profit,games_played=excluded.games_played,games_won=excluded.games_won,updated_at=CURRENT_TIMESTAMP`)
        .run(
          zaloId,
          String(targetStats?.display_name ?? aliasStats.display_name ?? `Zalo ${zaloId.slice(-6)}`),
          (BigInt(String(targetStats?.total_winnings ?? "0")) + BigInt(String(aliasStats.total_winnings ?? "0"))).toString(),
          (BigInt(String(targetStats?.net_profit ?? "0")) + BigInt(String(aliasStats.net_profit ?? "0"))).toString(),
          Number(targetStats?.games_played ?? 0) + Number(aliasStats.games_played ?? 0),
          Number(targetStats?.games_won ?? 0) + Number(aliasStats.games_won ?? 0),
        );
      db.prepare("DELETE FROM game_stats WHERE zalo_id=?").run(aliasId);
    }
  }
}

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
  /** Forget the group's AI context: stored chat turns and the rolling summary. */
  clearGroupContext(groupId: string) {
    return db.transaction(() => {
      const messages = db.prepare("DELETE FROM messages WHERE group_id=?").run(groupId).changes;
      const summaries = db.prepare("DELETE FROM summaries WHERE group_id=?").run(groupId).changes;
      return { messages, summaries };
    })();
  },
  /** Forget the AI context of every group. Wallets, members and settings stay. */
  clearAllContext() {
    return db.transaction(() => {
      const messages = db.prepare("DELETE FROM messages").run().changes;
      const summaries = db.prepare("DELETE FROM summaries").run().changes;
      return { messages, summaries };
    })();
  },
  saveSummary(groupId: string, content: string, throughId: number) {
    db.prepare(`INSERT INTO summaries(group_id,content,through_message_id) VALUES(?,?,?)
      ON CONFLICT(group_id) DO UPDATE SET content=excluded.content,through_message_id=excluded.through_message_id,updated_at=CURRENT_TIMESTAMP`).run(groupId, content, throughId);
  },
  upsertMembers(groupId: string, members: Array<{id:string;name:string;avatar?:string;role?:string}>) {
    const stmt = db.prepare(`INSERT INTO members(group_id,zalo_id,display_name,avatar,role) VALUES(?,?,?,?,?)
      ON CONFLICT(group_id,zalo_id) DO UPDATE SET display_name=CASE WHEN excluded.display_name LIKE 'Zalo %' THEN members.display_name ELSE excluded.display_name END,avatar=COALESCE(excluded.avatar,members.avatar),role=excluded.role,updated_at=CURRENT_TIMESTAMP`);
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
      mergeAliasWallets(aliases);
      db.prepare("UPDATE groups SET member_count=? WHERE id=?").run(members.length,groupId);
    })();
  },
  upsertMemberAliases(groupId:string, aliases:Array<{aliasId:string;zaloId:string}>) {
    const stmt = db.prepare(`INSERT INTO member_aliases(group_id,alias_id,zalo_id) VALUES(?,?,?)
      ON CONFLICT(group_id,alias_id) DO UPDATE SET zalo_id=excluded.zalo_id`);
    const removeStaleMember = db.prepare("DELETE FROM members WHERE group_id=? AND zalo_id=?");
    const repointAliases = db.prepare("UPDATE member_aliases SET zalo_id=? WHERE group_id=? AND zalo_id=?");
    db.transaction(() => {
      aliases.forEach((a) => {
        stmt.run(groupId,a.aliasId,a.zaloId);
        if (a.aliasId !== a.zaloId) {
          removeStaleMember.run(groupId,a.aliasId);
          repointAliases.run(a.zaloId,groupId,a.aliasId);
        }
      });
      mergeAliasWallets(aliases);
    })();
  },
  /** Raw IDs plus the canonical member ID and every alias of it. */
  identityIds(groupId:string, candidates:Array<string|undefined|null>) {
    const ids = new Set(candidates.map((value) => String(value ?? "").trim()).filter(Boolean));
    const aliasQuery = db.prepare("SELECT alias_id FROM member_aliases WHERE group_id=? AND zalo_id=?");
    for (const id of [...ids]) {
      const canonical = repository.resolveMemberId(groupId,[id]);
      if (!canonical) continue;
      ids.add(canonical);
      for (const row of aliasQuery.all(groupId,canonical) as Array<{alias_id:string}>) ids.add(row.alias_id);
    }
    return ids;
  },
  setMemberRole(groupId:string, zaloId:string, role:"admin"|"member") {
    db.prepare("UPDATE members SET role=?,updated_at=CURRENT_TIMESTAMP WHERE group_id=? AND zalo_id=?").run(role,groupId,zaloId);
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
  chicken(zaloId:string) {
    return db.prepare("SELECT * FROM chickens WHERE zalo_id=?").get(zaloId) as {
      zalo_id:string;name:string;level:number;aggression:number;claws:number;
      comb:number;kick_power:number;wins:number;losses:number;updated_at:string;
    }|undefined;
  },
  createChicken(chicken:{zaloId:string;name:string;aggression:number;claws:number;comb:number;kickPower:number}) {
    const result=db.prepare(`INSERT OR IGNORE INTO chickens(zalo_id,name,aggression,claws,comb,kick_power)
      VALUES(?,?,?,?,?,?)`).run(chicken.zaloId,chicken.name,chicken.aggression,chicken.claws,chicken.comb,chicken.kickPower);
    return {created:result.changes===1,chicken:repository.chicken(chicken.zaloId)!};
  },
  renameChicken(zaloId:string,name:string) {
    const changed=db.prepare("UPDATE chickens SET name=?,updated_at=CURRENT_TIMESTAMP WHERE zalo_id=?").run(name,zaloId).changes;
    return changed ? repository.chicken(zaloId) : undefined;
  },
  upgradeChicken(zaloId:string,cost:bigint,boost:{aggression:number;claws:number;comb:number;kickPower:number}) {
    return db.transaction(() => {
      const chicken=repository.chicken(zaloId);
      if(!chicken)return {ok:false as const,reason:"no_chicken" as const};
      const balance=repository.walletBalance(zaloId);
      if(balance<cost)return {ok:false as const,reason:"insufficient" as const,balance};
      const nextBalance=balance-cost;
      db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`).run(zaloId,nextBalance.toString());
      db.prepare(`UPDATE chickens SET level=level+1,aggression=aggression+?,claws=claws+?,comb=comb+?,kick_power=kick_power+?,updated_at=CURRENT_TIMESTAMP WHERE zalo_id=?`)
        .run(boost.aggression,boost.claws,boost.comb,boost.kickPower,zaloId);
      return {ok:true as const,balance:nextBalance,chicken:repository.chicken(zaloId)!};
    })();
  },
  createChickenChallenge(input:{id:string;groupId:string;challengerId:string;challengerName:string;targetId:string;targetName:string;stake:bigint;now:number;expiresAt:number}) {
    return db.transaction(() => {
      db.prepare("UPDATE chicken_challenges SET status='expired' WHERE status='pending' AND expires_at<=?").run(input.now);
      const busy=db.prepare(`SELECT id FROM chicken_challenges WHERE group_id=? AND status='pending'
        AND (challenger_id IN (?,?) OR target_id IN (?,?)) LIMIT 1`)
        .get(input.groupId,input.challengerId,input.targetId,input.challengerId,input.targetId);
      if(busy)return {ok:false as const,reason:"busy" as const};
      const balance=repository.walletBalance(input.challengerId);
      if(balance<input.stake)return {ok:false as const,reason:"insufficient" as const,balance};
      db.prepare(`INSERT INTO chicken_challenges(id,group_id,challenger_id,challenger_name,target_id,target_name,stake,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(input.id,input.groupId,input.challengerId,input.challengerName,input.targetId,input.targetName,input.stake.toString(),input.now,input.expiresAt);
      return {ok:true as const};
    })();
  },
  pendingChickenChallenge(groupId:string,targetId:string,now=Date.now()) {
    db.prepare("UPDATE chicken_challenges SET status='expired' WHERE status='pending' AND expires_at<=?").run(now);
    return db.prepare(`SELECT * FROM chicken_challenges WHERE group_id=? AND target_id=? AND status='pending' AND expires_at>?
      ORDER BY created_at DESC LIMIT 1`).get(groupId,targetId,now) as {
        id:string;group_id:string;challenger_id:string;challenger_name:string;target_id:string;
        target_name:string;stake:string;status:string;created_at:number;expires_at:number;
      }|undefined;
  },
  declineChickenChallenge(id:string,targetId:string,now=Date.now()) {
    return db.prepare(`UPDATE chicken_challenges SET status='declined',resolved_at=?
      WHERE id=? AND target_id=? AND status='pending' AND expires_at>?`).run(now,id,targetId,now).changes===1;
  },
  settleChickenChallenge(input:{id:string;targetId:string;winnerId:string;challengerScore:number;targetScore:number;now:number}) {
    return db.transaction(() => {
      const challenge=db.prepare("SELECT * FROM chicken_challenges WHERE id=?").get(input.id) as {
        id:string;group_id:string;challenger_id:string;challenger_name:string;target_id:string;target_name:string;
        stake:string;status:string;expires_at:number;
      }|undefined;
      if(!challenge||challenge.status!=="pending"||challenge.target_id!==input.targetId)
        return {ok:false as const,reason:"unavailable" as const};
      if(challenge.expires_at<=input.now){
        db.prepare("UPDATE chicken_challenges SET status='expired',resolved_at=? WHERE id=?").run(input.now,input.id);
        return {ok:false as const,reason:"expired" as const};
      }
      if(input.winnerId!==challenge.challenger_id&&input.winnerId!==challenge.target_id)
        return {ok:false as const,reason:"invalid_winner" as const};
      const stake=BigInt(challenge.stake);
      const challengerBalance=repository.walletBalance(challenge.challenger_id);
      const targetBalance=repository.walletBalance(challenge.target_id);
      if(challengerBalance<stake)return {ok:false as const,reason:"challenger_insufficient" as const,balance:challengerBalance};
      if(targetBalance<stake)return {ok:false as const,reason:"target_insufficient" as const,balance:targetBalance};
      const winnerIsChallenger=input.winnerId===challenge.challenger_id;
      const challengerAfter=challengerBalance-stake+(winnerIsChallenger?stake*2n:0n);
      const targetAfter=targetBalance-stake+(winnerIsChallenger?0n:stake*2n);
      const upsert=db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`);
      upsert.run(challenge.challenger_id,challengerAfter.toString());
      upsert.run(challenge.target_id,targetAfter.toString());
      db.prepare("UPDATE chickens SET wins=wins+1,updated_at=CURRENT_TIMESTAMP WHERE zalo_id=?").run(input.winnerId);
      const loserId=winnerIsChallenger?challenge.target_id:challenge.challenger_id;
      db.prepare("UPDATE chickens SET losses=losses+1,updated_at=CURRENT_TIMESTAMP WHERE zalo_id=?").run(loserId);
      db.prepare(`UPDATE chicken_challenges SET status='resolved',winner_id=?,challenger_score=?,target_score=?,resolved_at=? WHERE id=?`)
        .run(input.winnerId,input.challengerScore,input.targetScore,input.now,input.id);
      recordGameResult(challenge.challenger_id,challenge.challenger_name,winnerIsChallenger?stake:-stake);
      recordGameResult(challenge.target_id,challenge.target_name,winnerIsChallenger?-stake:stake);
      return {ok:true as const,stake,challengerAfter,targetAfter,challenge};
    })();
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
  transferWalletBalance(fromId:string,toId:string,amount:bigint):
    | {ok:true;senderPrevious:bigint;senderBalance:bigint;recipientPrevious:bigint;recipientBalance:bigint}
    | {ok:false;reason:"invalid"|"same_account"|"insufficient";senderBalance:bigint} {
    return db.transaction(() => {
      const senderRow=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(fromId) as {balance:string}|undefined;
      const senderPrevious=BigInt(senderRow?.balance ?? "0");
      if(amount<=0n)return {ok:false as const,reason:"invalid" as const,senderBalance:senderPrevious};
      if(fromId===toId)return {ok:false as const,reason:"same_account" as const,senderBalance:senderPrevious};
      if(senderPrevious<amount)return {ok:false as const,reason:"insufficient" as const,senderBalance:senderPrevious};
      const recipientRow=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(toId) as {balance:string}|undefined;
      const recipientPrevious=BigInt(recipientRow?.balance ?? "0");
      const senderBalance=senderPrevious-amount;
      const recipientBalance=recipientPrevious+amount;
      const upsert=db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`);
      upsert.run(fromId,senderBalance.toString());
      upsert.run(toId,recipientBalance.toString());
      return {ok:true as const,senderPrevious,senderBalance,recipientPrevious,recipientBalance};
    })();
  },
  wipeWalletBalance(zaloId:string) {
    return db.transaction(() => {
      const row=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(zaloId) as {balance:string}|undefined;
      const previous=BigInt(row?.balance ?? "0");
      db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,0,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance='0',updated_at=CURRENT_TIMESTAMP`).run(zaloId);
      return {previous,balance:0n};
    })();
  },
  settleTaiXiu(zaloId:string,stake:bigint,won:boolean,displayName=`Zalo ${zaloId.slice(-6)}`,winProfit=stake): {ok:true;previous:bigint;balance:bigint}|{ok:false;balance:bigint} {
    return db.transaction(() => {
      const row=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(zaloId) as {balance:string}|undefined;
      const previous=BigInt(row?.balance ?? "0");
      if(previous<stake)return {ok:false as const,balance:previous};
      const profit=won ? winProfit : -stake;
      const balance=previous+profit;
      db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`).run(zaloId,balance.toString());
      recordGameResult(zaloId,displayName,profit);
      return {ok:true as const,previous,balance};
    })();
  },
  settleMarketGame(zaloId:string,pnl:bigint,displayName=`Zalo ${zaloId.slice(-6)}`) {
    return db.transaction(() => {
      const row=db.prepare("SELECT balance FROM wallets WHERE zalo_id=?").get(zaloId) as {balance:string}|undefined;
      const previous=BigInt(row?.balance ?? "0");
      const appliedPnl=pnl < -previous ? -previous : pnl;
      const balance=previous+appliedPnl;
      db.prepare(`INSERT INTO wallets(zalo_id,balance,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(zalo_id) DO UPDATE SET balance=excluded.balance,updated_at=CURRENT_TIMESTAMP`).run(zaloId,balance.toString());
      recordGameResult(zaloId,displayName,appliedPnl);
      return {previous,balance,pnl:appliedPnl};
    })();
  },
  recordGameResult(zaloId:string,displayName:string,profit:bigint) {
    db.transaction(() => recordGameResult(zaloId,displayName,profit))();
  },
  gameLeaderboard(limit=10) {
    const rows=db.prepare("SELECT * FROM game_stats").all() as Array<{
      zalo_id:string;display_name:string;total_winnings:string;net_profit:string;
      games_played:number;games_won:number;updated_at:string;
    }>;
    return rows
      .sort((a,b) => {
        const winnings=BigInt(b.total_winnings)-BigInt(a.total_winnings);
        if(winnings!==0n)return winnings>0n ? 1 : -1;
        const profit=BigInt(b.net_profit)-BigInt(a.net_profit);
        if(profit!==0n)return profit>0n ? 1 : -1;
        return b.games_won-a.games_won;
      })
      .slice(0,Math.max(0,limit));
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
