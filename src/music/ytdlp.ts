import { spawn } from "node:child_process";
import { config } from "../config.js";

interface YtDlpResult {
  stdout: string;
  stderr: string;
}

interface CachedStream {
  url: string;
  expiresAt: number;
}

const streamCache = new Map<string, CachedStream>();

export interface YtDlpTrack {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationMs: number;
}

function runYtDlp(args: string[], timeoutMs: number): Promise<YtDlpResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.YTDLP_PATH, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      error ? reject(error) : resolve({ stdout, stderr });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("yt-dlp xử lý SoundCloud quá thời gian"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 4 * 1024 * 1024) {
        child.kill("SIGKILL");
        finish(new Error("yt-dlp trả về dữ liệu quá lớn"));
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8000) stderr += String(chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) =>
      finish(
        error.code === "ENOENT"
          ? new Error(
              `Không tìm thấy yt-dlp tại “${config.YTDLP_PATH}”. Admin hãy cài yt-dlp trên Ubuntu.`,
            )
          : new Error(`Không chạy được yt-dlp: ${error.message}`),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? finish()
        : finish(
            new Error(
              `yt-dlp lỗi (${code}): ${stderr.trim().slice(-700) || "không có chi tiết"}`,
            ),
          ),
    );
  });
}

function publicSoundCloudUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.searchParams.has("secret_token") ||
      url.pathname.split("/").filter(Boolean).length !== 2 ||
      !(host === "soundcloud.com" || host.endsWith(".soundcloud.com"))
    )
      return undefined;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function parseYtDlpSearchJson(
  output: string,
  limit = 6,
): YtDlpTrack[] {
  const body = JSON.parse(output);
  const rows = Array.isArray(body?.entries) ? body.entries : [body];
  return rows
    .map((track: any): YtDlpTrack | null => {
      const url =
        publicSoundCloudUrl(track?.webpage_url) ??
        publicSoundCloudUrl(track?.original_url) ??
        publicSoundCloudUrl(track?.url);
      if (!url || typeof track?.title !== "string") return null;
      return {
        id: String(track.id ?? url),
        title: track.title.trim(),
        artist: String(
          track.artist ?? track.uploader ?? track.channel ?? "SoundCloud",
        ).trim(),
        url,
        durationMs: Math.max(0, Number(track.duration) || 0) * 1000,
      };
    })
    .filter((track: YtDlpTrack | null): track is YtDlpTrack => Boolean(track))
    .slice(0, Math.max(1, Math.min(6, limit)));
}

export async function searchPublicSoundCloud(
  query: string,
  limit = 6,
): Promise<YtDlpTrack[]> {
  const safeQuery = query.trim().slice(0, 200);
  if (!safeQuery) return [];
  const count = Math.max(1, Math.min(6, limit));
  const { stdout } = await runYtDlp(
    [
      "--ignore-config",
      "--no-warnings",
      "--flat-playlist",
      "--skip-download",
      "--playlist-end",
      String(count),
      "--dump-single-json",
      `scsearch${count}:${safeQuery}`,
    ],
    25_000,
  );
  return parseYtDlpSearchJson(stdout, count);
}

export async function resolvePublicSoundCloudStream(
  trackUrl: string,
): Promise<string> {
  const safeUrl = publicSoundCloudUrl(trackUrl);
  if (!safeUrl) throw new Error("URL track SoundCloud không hợp lệ");
  const cached = streamCache.get(safeUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  streamCache.delete(safeUrl);
  const { stdout } = await runYtDlp(
    [
      "--ignore-config",
      "--no-warnings",
      "--socket-timeout",
      "10",
      "--no-playlist",
      "--format",
      "bestaudio[format_id*=preview]/bestaudio[quality<=0][format_id!=download]",
      "--get-url",
      safeUrl,
    ],
    20_000,
  );
  const streamUrl = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!streamUrl) throw new Error("yt-dlp không tìm thấy luồng âm thanh công khai");
  streamCache.set(safeUrl, {
    url: streamUrl,
    expiresAt: Date.now() + 5 * 60_000,
  });
  if (streamCache.size > 100)
    for (const [key, entry] of streamCache) {
      if (entry.expiresAt <= Date.now() || streamCache.size > 80)
        streamCache.delete(key);
    }
  return streamUrl;
}
