import { createFile, type Movie, type Track } from "mp4box";
import type { Mp4Parser } from "./add-video-worker.server";

export const MP4BOX_VALIDATOR_VERSION = "mp4box-2.4.1";

type Mp4BoxFile = ReturnType<typeof createFile>;
type CreateMp4BoxFile = () => Mp4BoxFile;

const AVC_PROFILE_NAMES: Readonly<Record<number, string>> = {
  0x42: "baseline",
  0x4d: "main",
  0x58: "extended",
  0x64: "high",
  0x6e: "high-10",
  0x7a: "high-4:2:2",
  0xf4: "high-4:4:4",
};

function parseAvcProfile(codec: string): string | null {
  const match = /^(?:avc1|avc3)\.([0-9a-f]{6})$/i.exec(codec.trim());
  if (!match) return null;
  const profileIdc = Number.parseInt(match[1]!.slice(0, 2), 16);
  return AVC_PROFILE_NAMES[profileIdc] ?? `avc-profile-${profileIdc}`;
}

function trackDurationMs(track: Track): number {
  if (!Number.isFinite(track.duration) || !Number.isFinite(track.timescale) || track.timescale <= 0)
    throw new Error("mp4_metadata_invalid");
  return Math.round((track.duration * 1000) / track.timescale);
}

function inspectMovie(info: Movie): Awaited<ReturnType<Mp4Parser["inspect"]>> {
  if (!info.hasMoov) throw new Error("mp4_metadata_missing");
  if (info.videoTracks.length !== 1) throw new Error("mp4_video_track_count_invalid");

  const video = info.videoTracks[0]!;
  const videoProfile = parseAvcProfile(video.codec);
  if (!videoProfile) throw new Error("mp4_codec_invalid");

  const width = video.video?.width ?? video.track_width;
  const height = video.video?.height ?? video.track_height;
  const audioCodecs = info.audioTracks.map((track) => track.codec.trim()).filter(Boolean);

  return {
    durationMs: trackDurationMs(video),
    width,
    height,
    videoCodec: "h264",
    videoProfile,
    hasAudio: info.audioTracks.length > 0,
    audioCodec: audioCodecs.length > 0 ? [...new Set(audioCodecs)].sort().join(",") : null,
  };
}

/** Server-only adapter. The injectable constructor keeps parser failure cases deterministic in verification. */
export function createMp4BoxParser(create: CreateMp4BoxFile = createFile): Mp4Parser {
  const probe = create();
  if (!probe || typeof probe.appendBuffer !== "function" || typeof probe.flush !== "function")
    throw new Error("mp4_parser_unavailable");

  return {
    version: MP4BOX_VALIDATOR_VERSION,
    async inspect(bytes) {
      const file = create();
      let movie: Movie | undefined;
      let parseError: Error | undefined;
      file.onReady = (info) => {
        movie = info;
      };
      file.onError = (_module, message) => {
        parseError = new Error(message || "mp4_parse_failed");
      };

      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer & {
        fileStart: number;
      };
      buffer.fileStart = 0;
      try {
        file.appendBuffer(buffer, true);
        file.flush();
      } catch {
        throw new Error("mp4_parse_failed");
      }
      if (parseError || !movie) throw new Error("mp4_parse_failed");
      return inspectMovie(movie);
    },
  };
}

export const mp4BoxParser = createMp4BoxParser();
