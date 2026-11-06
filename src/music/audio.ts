import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import { resolvePublicSoundCloudStream } from "./ytdlp.js";

const ALLOWED_HOSTS = ["soundcloud.com", "soundcloud.cloud", "sndcdn.com"];
const waiters: Array<() => void> = [];
let activeConversions = 0;

async function acquireConversionSlot() {
  if (activeConversions >= 4)
    await new Promise<void>((resolve) => waiters.push(resolve));
  activeConversions++;
}

function releaseConversionSlot() {
  activeConversions--;
  waiters.shift()?.();
}

function validateSource(input: string): string {
  const url = new URL(input),
    host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !ALLOWED_HOSTS.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  )
    throw new Error("URL audio SoundCloud không hợp lệ");
  return url.toString();
}

function runFfmpeg(sourceUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.FFMPEG_PATH,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        sourceUrl,
        "-t",
        "30",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    let errorText = "";
    child.stderr.on("data", (chunk) => {
      if (errorText.length < 2000) errorText += String(chunk);
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Chuyển đổi audio quá thời gian 45 giây"));
    }, 45_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Không chạy được ffmpeg: ${error.message}`));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ffmpeg lỗi (${code}): ${errorText.trim().slice(0, 300)}`,
            ),
          );
    });
  });
}

export async function withM4aPreview<T>(
  trackUrl: string,
  callback: (path: string) => Promise<T>,
): Promise<T> {
  await acquireConversionSlot();
  let directory = "";
  try {
    directory = await mkdtemp(join(tmpdir(), "mbalong-music-"));
    const output = join(directory, "preview.m4a");
    const sourceUrl = await resolvePublicSoundCloudStream(trackUrl);
    await runFfmpeg(validateSource(sourceUrl), output);
    const info = await stat(output);
    if (info.size <= 0 || info.size > 8 * 1024 * 1024)
      throw new Error("File audio sau chuyển đổi không hợp lệ");
    return await callback(output);
  } finally {
    if (directory)
      await rm(directory, { recursive: true, force: true }).catch(() => {});
    releaseConversionSlot();
  }
}
