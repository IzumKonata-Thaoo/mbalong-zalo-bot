export type MusicIntent =
  | { kind: "search"; query: string }
  | { kind: "select"; index: number }
  | { kind: "help" }
  | null;

/** `/music <tên bài>` — aliases /nhac, /nhạc, /sc, /soundcloud. */
const MUSIC_COMMAND = /^\/(?:music|nhac|nhạc|sc|soundcloud)(?=\s|$)\s*(.*)$/isu;
/** `/chon 2`, `/chọn 2`, `chọn 2`, `phát bài 2`, `nghe bài 2`. */
const SELECT =
  /^(?:\/chon|\/chọn|chọn|chon|phát|phat|nghe)\s+(?:bài|bai)?\s*([1-6])\s*$/iu;
/**
 * Natural phrasing still works when it names SoundCloud explicitly, e.g.
 * "tìm bài Blinding Lights trên soundcloud". Without the word SoundCloud the
 * text goes to the AI (and web search), so "tìm bài toán này" is never music.
 */
const NATURAL_SOUNDCLOUD =
  /^(?:tìm kiếm|tim kiem|tìm|tim|kiếm|kiem|mở|mo|phát|phat|nghe)\s+(?:nhạc|nhac|bài hát|bai hat|bài|bai)\s+(.+?)\s+(?:trên|tren|ở|o)?\s*soundcloud\s*$/iu;

export function parseMusicIntent(input: string): MusicIntent {
  const text = input.trim();
  const command = text.match(MUSIC_COMMAND);
  if (command) {
    const query = command[1]!.replace(/\s+/g, " ").trim();
    return query ? { kind: "search", query } : { kind: "help" };
  }
  const selected = text.match(SELECT);
  if (selected) return { kind: "select", index: Number(selected[1]) - 1 };
  const natural = text.match(NATURAL_SOUNDCLOUD);
  if (natural) {
    const query = natural[1]!.trim();
    return query ? { kind: "search", query } : null;
  }
  return null;
}

/** `/search <câu hỏi>` — aliases /web, /timkiem, /tìm kiếm, /google: forced web research. */
const WEB_COMMAND =
  /^\/(?:search|web|google|timkiem|tìmkiếm|tim\s+kiem|tìm\s+kiếm)(?=\s|$)\s*(.*)$/isu;

export function parseWebSearchCommand(input: string): { query: string } | null {
  const match = input.trim().match(WEB_COMMAND);
  if (!match) return null;
  return { query: match[1]!.replace(/\s+/g, " ").trim() };
}

export function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
