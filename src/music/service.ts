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
}
interface SearchSession {
  expiresAt: number;
  tracks: MusicTrack[];
}

const sessions = new Map<string, SearchSession>();
const sessionKey = (groupId: string, senderId: string) =>
  `${groupId}:${senderId}`;

export async function searchSoundCloud(
  query: string,
  limit = 6,
): Promise<MusicTrack[]> {
  return searchPublicSoundCloud(query, limit);
}

function listMessage(tracks: MusicTrack[]): string {
  const rows = tracks.map(
    (track, index) =>
      `${index + 1}. ${track.title}\n   ${track.artist} · ${formatDuration(track.durationMs)} · SoundCloud`,
  );
  return `🎧 KẾT QUẢ SOUNDCLOUD\n\n${rows.join("\n\n")}\n\nTag MbaLong và nói “chọn 1” đến “chọn ${tracks.length}” trong 10 phút.`;
}

export async function handleMusic(
  groupId: string,
  senderId: string,
  input: string,
): Promise<MusicAction | null> {
  const intent = parseMusicIntent(input);
  if (!intent) return null;
  const key = sessionKey(groupId, senderId);
  if (intent.kind === "search") {
    const tracks = await searchSoundCloud(intent.query, 6);
    if (!tracks.length)
      return { message: "Không tìm thấy bài phù hợp trên SoundCloud." };
    sessions.set(key, { tracks, expiresAt: Date.now() + 10 * 60_000 });
    if (sessions.size > 500)
      for (const [storedKey, session] of sessions) {
        if (session.expiresAt < Date.now() || sessions.size > 450)
          sessions.delete(storedKey);
      }
    return { message: listMessage(tracks) };
  }
  const session = sessions.get(key);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(key);
    return null;
  }
  const track = session.tracks[intent.index];
  if (!track)
    return { message: `Chỉ được chọn từ 1 đến ${session.tracks.length}.` };
  sessions.delete(key);
  return {
    message: `🎵 ${track.title}\n${track.artist}\nĐoạn nghe thử 30 giây từ SoundCloud`,
    soundCloudTrackUrl: track.url,
  };
}
