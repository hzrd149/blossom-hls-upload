import fetch from "cross-fetch";
import fs from "fs-extra";
import crypto, { BinaryLike } from "node:crypto";
// @ts-expect-error
import { Parser } from "m3u8-parser";
import { dirname, join } from "node:path";

function joinURL(base: string | URL, path: string) {
  const isURL = base instanceof URL || base.startsWith("http");
  if (isURL) {
    const url = new URL(base);
    url.pathname = join(url.pathname, path);
    return url.toString();
  } else return join(base, path);
}
async function readPlaylist(urlOrPath: URL | string) {
  const isURL = urlOrPath instanceof URL || urlOrPath.startsWith("http");
  if (isURL) {
    return await fetch(urlOrPath).then((res) => res.text());
  } else return await fs.readFile(urlOrPath, { encoding: "utf-8" });
}
async function readSegment(urlOrPath: string) {
  const isURL = urlOrPath.startsWith("http");
  if (isURL) {
    return Buffer.from(await fetch(urlOrPath).then((res) => res.arrayBuffer()));
  } else return await fs.readFile(urlOrPath);
}

function computeSHA256(data: BinaryLike) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

type Manifest = {
  segments: Segment[];
  playlists: any[];
};
type Segment = {
  uri: string;
};

type WriteFile = (path: string, content: string | Buffer) => Promise<void>;

export async function convertPlaylist(urlOrPath: URL | string, write: WriteFile) {
  try {
    const base = dirname(urlOrPath.toString());
    const playlistData = await readPlaylist(urlOrPath);

    const parser = new Parser();
    parser.push(playlistData);
    parser.end();

    const parsedManifest = parser.manifest;
    let updatedPlaylist = playlistData;

    if (parsedManifest.playlists && parsedManifest.playlists.length > 0) {
      // Master playlist with variant streams
      console.log(`Found ${parsedManifest.playlists.length} variant playlists`);

      for (let i = 0; i < parsedManifest.playlists.length; i++) {
        const variant = parsedManifest.playlists[i];
        const variantUrl = joinURL(base, variant.uri);
        const variantName =
          variant.attributes?.NAME ||
          (variant.attributes?.RESOLUTION
            ? `${variant.attributes?.RESOLUTION.width}x${variant.attributes?.RESOLUTION.height}`
            : undefined) ||
          "variant" + i;

        const variantPlaylistHash = await convertPlaylist(variantUrl, (filename, content) => write(filename, content));
        const variantPath = `${variantPlaylistHash}.m3u8`;

        // Update the variant URI to the new hashed filename
        updatedPlaylist = updatedPlaylist.replace(variant.uri, variantPath);

        console.log(`Renaming variant playlist ${i + 1}: ${variantUrl} to ${variantPath}`);
      }
    } else if (parsedManifest.segments && parsedManifest.segments.length > 0) {
      // Media playlist with segments
      console.log(`Found ${parsedManifest.segments.length} segments`);

      for (let i = 0; i < parsedManifest.segments.length; i++) {
        const segment = parsedManifest.segments[i];
        const segmentUrl = joinURL(base, segment.uri);

        const segmentData = await readSegment(segmentUrl);
        const segmentHash = computeSHA256(segmentData);
        const segmentFilename = `${segmentHash}.ts`;

        console.log(`Renamed segment ${i + 1}/${parsedManifest.segments.length}: ${segmentUrl} to ${segmentFilename}`);

        await write(segmentFilename, segmentData);

        // Update the segment URI to the new hashed filename
        updatedPlaylist = updatedPlaylist.replace(segment.uri, segmentFilename);
      }
    }

    // Serialize the updated manifest back to M3U8 format
    const playlistHash = computeSHA256(updatedPlaylist);
    const playlistPath = `${playlistHash}.m3u8`;

    // Save the updated playlist with the hash as its filename
    await write(playlistPath, updatedPlaylist);

    return playlistHash;
  } catch (error) {
    console.error("Error fetching playlist:", error);
  }
}
