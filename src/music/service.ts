import { formatDuration, parseMusicIntent } from "./rules.js";
import { searchPublicSoundCloud } from "./ytdlp.js";

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationMs: number;
}
export interface MusicAction {
  message: string;
  soundCloudTrackUrl?: string;
  replyToList?: boolean;
}
interface SearchSession {
  expiresAt: number;
  tracks: MusicTrack[];
}

const SESSION_MS = 10 * 60_000;
const sessions = new Map<string, SearchSession>();
const sessionKey = (groupId: string, senderId: string) =>
  `${groupId}:${senderId}`;
/** Latest list shown in each group, so anyone in the group can pick from it. */
const groupKey = (groupId: string) => `${groupId}:*`;

export const MUSIC_USAGE = [
  "🎧 TÌM NHẠC SOUNDCLOUD",
  "",
  "• @MbaLong /music tên bài hát — tìm trên SoundCloud",
  "• @MbaLong /chon 1 → 6 — phát bài trong danh sách (10 phút)",
  "• @MbaLong /search câu hỏi — tìm kiếm web bình thường",
  "",
  "Ví dụ: @MbaLong /music Nơi này có anh",
].join("\n");

export async function searchSoundCloud(
  query: string,
  limit = 6,
): Promise<MusicTrack[]> {
  return searchPublicSoundCloud(query, limit);
}

function pruneSessions() {
  if (sessions.size <= 500) return;
  const now = Date.now();
  for (const [storedKey, session] of sessions)
    if (session.expiresAt < now || sessions.size > 450)
      sessions.delete(storedKey);
}

function listMessage(tracks: MusicTrack[]): string {
  const rows = tracks.map(
    (track, index) =>
      `${index + 1}. ${track.title}\n   ${track.artist} · ${formatDuration(track.durationMs)} · SoundCloud`,
  );
  return [
    "🎧 KẾT QUẢ SOUNDCLOUD",
    "",
    rows.join("\n\n"),
    "",
    `Tag MbaLong và gửi /chon 1 đến /chon ${tracks.length} trong 10 phút để nghe.`,
  ].join("\n");
}

export async function handleMusic(
  groupId: string,
  senderId: string,
  input: string,
): Promise<MusicAction | null> {
  const intent = parseMusicIntent(input);
  if (!intent) return null;
  if (intent.kind === "help") return { message: MUSIC_USAGE };
  const key = sessionKey(groupId, senderId);
  if (intent.kind === "search") {
    const tracks = await searchSoundCloud(intent.query, 6);
    if (!tracks.length)
      return {
        message: `Không tìm thấy bài nào trên SoundCloud cho “${intent.query}”. Thử tên khác hoặc thêm tên ca sĩ.`,
      };
    const session = { tracks, expiresAt: Date.now() + SESSION_MS };
    sessions.set(key, session);
    sessions.set(groupKey(groupId), session);
    pruneSessions();
    return { message: listMessage(tracks) };
  }
  const now = Date.now();
  const own = sessions.get(key);
  const shared = sessions.get(groupKey(groupId));
  const session =
    own && own.expiresAt >= now
      ? own
      : shared && shared.expiresAt >= now
        ? shared
        : null;
  if (!session) {
    if (own) sessions.delete(key);
    return {
      message:
        "Danh sách nhạc đã hết hạn hoặc chưa có. Gửi @MbaLong /music tên bài hát để tìm lại.",
    };
  }
  const track = session.tracks[intent.index];
  if (!track)
    return { message: `Chỉ được chọn từ 1 đến ${session.tracks.length}.` };
  return {
    message: `🎵 ${track.title}\n${track.artist}`,
    soundCloudTrackUrl: track.url,
    replyToList: true,
  };
}
