# SoundCloud search and Zalo voice delivery research

Research date: 2026-11-06.

## Implemented approach

1. Search up to six public tracks through the maintained `yt-dlp` SoundCloud extractor (`scsearch6`).
2. Keep the result list for the same group member for ten minutes.
3. Prefer an extractor-labelled 30-second preview. If SoundCloud exposes only a normal public, non-premium playback rendition, cap that rendition to 30 seconds locally.
4. Convert HLS AAC to a temporary M4A/AAC file with `ffmpeg`.
5. Upload the file through `zca-js`, pass the returned Zalo URL to `sendVoice`, then delete the temporary file.

No SoundCloud account, cookie, OAuth token, Artist Pro subscription, private/secret URL, premium format, DRM media, original download, or arbitrary user-provided media URL is used. This route is unofficial and may break when SoundCloud changes its web player.

## Credential-free GitHub alternatives

There is no credential-free route that SoundCloud documents as a supported public API. The options below work by discovering the web player's rotating `client_id` and calling the undocumented `api-v2.soundcloud.com` endpoints. They therefore have a higher breakage and policy risk than the official OAuth route, even when restricted to public tracks.

| Project | Maintenance and license | Source inspection | Decision |
| --- | --- | --- | --- |
| [`yt-dlp/yt-dlp`](https://github.com/yt-dlp/yt-dlp) | Actively maintained; [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE); Python CLI suitable for Ubuntu | Its [SoundCloud extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/soundcloud.py) obtains a client ID from SoundCloud's public JavaScript, calls `api-v2`, implements `scsearch`, and labels 30-second/snipped formats with `preview`. It also understands authenticated/private URLs, so those paths must be disabled by policy. | Best credential-free fallback, used as an isolated subprocess rather than copied into the Node application. Still unofficial and may stop working when SoundCloud changes its site. |
| [`iamtraction/play-dl`](https://github.com/iamtraction/play-dl) | Maintained fork; GPL-3.0; Node 20+ | The [SoundCloud implementation](https://github.com/iamtraction/play-dl/blob/main/play-dl/SoundCloud/index.ts) scrapes the final SoundCloud JavaScript bundle for `client_id`, searches `api-v2`, and exposes full HLS streams. It does not enforce preview-only playback. | Not preferred: small fork, strong copyleft considerations for distribution, and extra application code is needed to prevent full-track forwarding. |
| [`twlite/soundcloud-scraper`](https://github.com/twlite/soundcloud-scraper) | MIT, but archived since 2023 | The repository says it is archived in favor of `soundcloud.ts`; its package keywords and API are download-oriented. | Reject for new work. |
| [`Moestash/soundcloud.ts`](https://github.com/Moestash/soundcloud.ts) | MIT, archived in 2026 | Wrapper for undocumented API v2 with download-oriented functionality. | Reject for new work. |
| [`zackradisic/node-soundcloud-downloader`](https://github.com/zackradisic/node-soundcloud-downloader) | MIT, last pushed in 2023 | Its [package metadata](https://github.com/zackradisic/node-soundcloud-downloader/blob/master/package.json) depends on a client-key fetcher and describes full SoundCloud audio downloads. | Reject: stale and full-download oriented. |

### Safe fallback design for Node on Ubuntu

The implemented credential-free route uses `yt-dlp` with these restrictions:

1. Run `yt-dlp` with an argument array through `child_process.spawn`; never build a shell command from the user's text.
2. Search only with `scsearch6:<query>` and flat JSON, then show title, artist, duration, and canonical `soundcloud.com` URL for at most six results. Example invocation for manual verification: `yt-dlp --flat-playlist --dump-single-json --playlist-end 6 "scsearch6:QUERY"`.
3. Store the six canonical URLs server-side and accept only a numeric selection. Do not accept an arbitrary download URL from chat.
4. Prefer a format whose `format_id` contains `preview`. This is grounded in the extractor source: it sets `is_preview` for SoundCloud `snipped` media and URLs containing `/preview/` or `/playlist/0/30/`, then appends `preview` to `format_id`. If no labelled preview exists, only a standard public format with non-premium quality is eligible; original `download` and premium formats are excluded.
5. Never request private tracks, `secret_token` URLs, cookies, `.netrc`, username/password, OAuth tokens, DRM media, premium/HQ formats or original downloads.
6. Pass the chosen public playback URL to `ffmpeg` with `-t 30`, transcode to AAC/M4A, enforce a small file limit, upload it for Zalo voice delivery, and delete it immediately. The local cap prevents forwarding a full track.
7. Allow only one or two conversions at once, use short process/network timeouts, apply per-user/group cooldowns, and pin a tested `yt-dlp` version. Add a health check because client-ID extraction can break without notice.

This design deliberately refuses full public streams even if a tool exposes them. A track being publicly playable does not automatically grant permission to download or redistribute the whole recording.

### Recommendation

- Production/compliance-first: use official SoundCloud OAuth and review SoundCloud's current platform terms.
- Credential-free implementation: use `yt-dlp` only with the public-search, format and 30-second restrictions above. Do not use `soundcloud-scraper`, `soundcloud.ts`, cookies or a full-download library.
- Spotify should remain metadata/link-only; its preview field is not a dependable or generally redistributable audio source.

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

- `YTDLP_PATH` (default `yt-dlp`)
- `FFMPEG_PATH` (default `ffmpeg`)

Only SoundCloud/SoundCloud-CDN HTTPS URLs are accepted by the conversion layer. Conversions are capped at two concurrent processes, time out after 45 seconds, produce at most 8 MB, and always remove temporary files.
