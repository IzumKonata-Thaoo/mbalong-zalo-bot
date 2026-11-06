import { config } from "../config.js";
import { formatDuration, parseMusicIntent } from "./rules.js";

export interface MusicTrack {
  id: string;
  urn: string;
  title: string;
  artist: string;
  url: string;
  durationMs: number;
}
export interface MusicAction {
  message: string;
  audioSourceUrl?: string;
}
interface TokenCache {
  value: string;
  expiresAt: number;
}
interface SearchSession {
  expiresAt: number;
  tracks: MusicTrack[];
}

const sessions = new Map<string, SearchSession>();
let soundCloudToken: TokenCache | undefined;
const sessionKey = (groupId: string, senderId: string) =>
  `${groupId}:${senderId}`;

async function responseJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `SoundCloud API ${response.status}: ${body?.error?.message ?? body?.error_description ?? body?.message ?? "yêu cầu thất bại"}`,
    );
  return body;
}

async function getSoundCloudToken(): Promise<string> {
  if (soundCloudToken && soundCloudToken.expiresAt > Date.now() + 60_000)
    return soundCloudToken.value;
  if (!config.SOUNDCLOUD_CLIENT_ID || !config.SOUNDCLOUD_CLIENT_SECRET)
    throw new Error(
      "Admin chưa cấu hình SOUNDCLOUD_CLIENT_ID và SOUNDCLOUD_CLIENT_SECRET",
    );
  const response = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.SOUNDCLOUD_CLIENT_ID}:${config.SOUNDCLOUD_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await responseJson(response);
  if (typeof body.access_token !== "string")
    throw new Error("SoundCloud không trả access token");
  soundCloudToken = {
    value: body.access_token,
    expiresAt:
      Date.now() + Math.max(300, Number(body.expires_in) || 3600) * 1000,
  };
  return soundCloudToken.value;
}

export async function searchSoundCloud(
  query: string,
  limit = 6,
): Promise<MusicTrack[]> {
  const token = await getSoundCloudToken();
  const url = new URL("https://api.soundcloud.com/tracks");
  url.searchParams.set("q", query);
  url.searchParams.set("access", "playable,preview");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("linked_partitioning", "true");
  const response = await fetch(url, {
    headers: { Authorization: `OAuth ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await responseJson(response);
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body.collection)
      ? body.collection
      : [];
  return rows
    .filter((track: any) => track?.urn && track?.title && track?.permalink_url)
    .slice(0, limit)
    .map((track: any) => ({
      id: String(track.id ?? track.urn),
      urn: String(track.urn),
      title: String(track.title),
      artist: String(
        track.metadata_artist ??
          track.user?.username ??
          track.user?.full_name ??
          "SoundCloud",
      ),
      url: String(track.permalink_url),
      durationMs: Number(track.duration) || 0,
    }));
}

async function soundCloudPreview(
  track: MusicTrack,
): Promise<string | undefined> {
  const token = await getSoundCloudToken();
  const response = await fetch(
    `https://api.soundcloud.com/tracks/${encodeURIComponent(track.urn)}/streams`,
    {
      headers: { Authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = await responseJson(response);
  return (
    body?.hls_aac_160_url ?? body?.preview_mp3_128_url ?? body?.hls_mp3_128_url
  );
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
  const audioSourceUrl = await soundCloudPreview(track);
  if (!audioSourceUrl)
    return {
      message: `Bài này không có preview audio được phép phát.\n${track.url}`,
    };
  sessions.delete(key);
  return {
    message: `🎵 ${track.title}\n${track.artist}\nSoundCloud preview 30 giây`,
    audioSourceUrl,
  };
}
