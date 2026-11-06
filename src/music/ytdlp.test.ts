import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({ config: { YTDLP_PATH: "yt-dlp" } }));

import { parseYtDlpSearchJson } from "./ytdlp.js";

describe("yt-dlp SoundCloud adapter", () => {
  it("maps public SoundCloud search entries", () => {
    const tracks = parseYtDlpSearchJson(
      JSON.stringify({
        entries: [
          {
            id: "123",
            title: "Test song",
            artist: "Test artist",
            webpage_url: "https://soundcloud.com/test-artist/test-song",
            duration: 185.4,
          },
        ],
      }),
    );
    expect(tracks).toEqual([
      {
        id: "123",
        title: "Test song",
        artist: "Test artist",
        url: "https://soundcloud.com/test-artist/test-song",
        durationMs: 185400,
      },
    ]);
  });

  it("rejects non-SoundCloud URLs from subprocess output", () => {
    const tracks = parseYtDlpSearchJson(
      JSON.stringify({
        entries: [
          {
            id: "bad",
            title: "Bad",
            webpage_url: "https://example.com/audio",
            duration: 10,
          },
        ],
      }),
    );
    expect(tracks).toEqual([]);
  });

  it("rejects private SoundCloud secret-token URLs", () => {
    const tracks = parseYtDlpSearchJson(
      JSON.stringify({
        entries: [
          {
            id: "private",
            title: "Private",
            webpage_url:
              "https://soundcloud.com/artist/track/s-private-token",
            duration: 10,
          },
        ],
      }),
    );
    expect(tracks).toEqual([]);
  });
});
