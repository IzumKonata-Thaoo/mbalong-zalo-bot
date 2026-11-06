export type MusicIntent =
  { kind: "search"; query: string } | { kind: "select"; index: number } | null;

const SEARCH_PREFIX =
  /^(?:tìm kiếm|tim kiem|tìm|tim|kiếm|kiem|mở|mo)\s+(?:nhạc|nhac|bài hát|bai hat)\s+/i;
const SOUNDCLOUD_SONG_PREFIX =
  /^(?:tìm kiếm|tim kiem|tìm|tim|kiếm|kiem|mở|mo)\s+(?:bài|bai)\s+/i;
const SELECT = /^(?:chọn|chon|phát|phat|nghe)\s+(?:bài|bai)?\s*([1-6])\s*$/i;

export function parseMusicIntent(input: string): MusicIntent {
  const text = input.trim();
  const selected = text.match(SELECT);
  if (selected) return { kind: "select", index: Number(selected[1]) - 1 };
  const explicitMusic = SEARCH_PREFIX.test(text);
  const soundCloudSong =
    SOUNDCLOUD_SONG_PREFIX.test(text) && /soundcloud\s*$/i.test(text);
  if (!explicitMusic && !soundCloudSong) return null;
  const query = text
    .replace(explicitMusic ? SEARCH_PREFIX : SOUNDCLOUD_SONG_PREFIX, "")
    .replace(/(?:trên|tren|ở|o)?\s*soundcloud\s*$/i, "")
    .trim();
  return query ? { kind: "search", query } : null;
}

export function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
