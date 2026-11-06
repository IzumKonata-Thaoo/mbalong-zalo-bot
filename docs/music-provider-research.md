# SoundCloud search and Zalo voice delivery research

Research date: 2026-11-05.

## Implemented approach

1. Search up to six playable tracks through SoundCloud's official public API.
2. Keep the result list for the same group member for ten minutes.
3. Obtain the selected track's official 30-second stream snippet.
4. Convert HLS AAC to a temporary M4A/AAC file with `ffmpeg`.
5. Upload the file through `zca-js`, pass the returned Zalo URL to `sendVoice`, then delete the temporary file.

No unofficial `api-v2` scraping, ripping tools, or arbitrary user-provided media URLs are used.

## Primary sources

- SoundCloud recommends direct HTTP API usage based on its maintained OpenAPI specification: [soundcloud/api](https://github.com/soundcloud/api), [OpenAPI spec](https://github.com/soundcloud/api/blob/master/openapi/api.yaml).
- Track search uses `GET /tracks?q=QUERY&access=playable&limit=6&linked_partitioning=true`: [official discovery guide](https://github.com/soundcloud/api/blob/master/.cursor/skills/soundcloud-api-discovery/SKILL.md).
- Public catalog search supports client-credentials OAuth. API requests use `Authorization: OAuth <access_token>` and tokens should be cached: [official authentication guide](https://github.com/soundcloud/api/blob/master/.cursor/skills/soundcloud-api-auth/SKILL.md).
- Playback uses `/tracks/{track_urn}/streams`; numeric IDs and the legacy stream endpoint should not be used: [official integration guide](https://github.com/soundcloud/api/blob/master/.cursor/skills/soundcloud-api-integration/SKILL.md).
- SoundCloud documents current playback results as 30-second snippets with AAC-based HLS options: [SoundCloud Agents.md](https://github.com/soundcloud/api/blob/master/Agents.md).
- Search and streaming are rate-limited: [official rate-limit documentation](https://developers.soundcloud.com/docs/api/rate-limits.html).
- `zca-js` v2.1.2 `sendVoice` accepts a remote URL, performs a `HEAD`, and forwards that URL as both `voiceUrl` and `m4aUrl`: [sendVoice source](https://github.com/RFS-ADRENO/zca-js/blob/v2.1.2/src/apis/sendVoice.ts).
- `uploadAttachment` accepts a local file and returns `fileUrl` for uploaded non-image files: [uploadAttachment source](https://github.com/RFS-ADRENO/zca-js/blob/v2.1.2/src/apis/uploadAttachment.ts).

## Configuration

- `SOUNDCLOUD_CLIENT_ID`
- `SOUNDCLOUD_CLIENT_SECRET`
- `FFMPEG_PATH` (default `ffmpeg`)

Credentials stay server-side. Only official SoundCloud/SoundCloud-CDN HTTPS URLs are accepted by the conversion layer. Conversions are capped at two concurrent processes, time out after 45 seconds, produce at most 8 MB, and always remove temporary files.
