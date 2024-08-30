import { program } from "commander";
import fs from "fs-extra";
import mime from "mime";

import { encodeHLS } from "./ffmpeg.js";
import { convertPlaylist } from "./convert.js";
import { basename, join } from "path";
import { BlossomClient } from "blossom-client-sdk";
import { finalizeEvent, generateSecretKey, nip19 } from "nostr-tools";

program
  .command("encode")
  .description("Encode a video file into HLS")
  .argument("<input>", "The video file")
  .argument("[output]", "Folder to output HLS playlists and chunks", "output")
  .action(async (input, output, options) => {
    if (!input) throw new Error("Missing Input");
    if (!output) throw new Error("Missing output");

    await encodeHLS(input, output);
  });

program
  .command("convert")
  .description("Updates HLS playlist to use sha256 hashes instead of filenames")
  .argument("<input>", "A URL or path to the .m3u8 file")
  .argument("[output]", "Folder to output HLS playlists and chunks", "output")
  .action(async (input, output, options) => {
    if (!input) throw new Error("Missing Input");
    if (!output) throw new Error("Missing output");

    await fs.ensureDir(output);
    await convertPlaylist(input, async (filepath, content) => {
      await fs.writeFile(join(output, filepath), content);
      console.log(join(output, filepath));
    });
  });

program
  .command("upload")
  .description("Converts and uploads a HLS playlist to a Blossom server")
  .argument("<input>", "A URL or path to the .m3u8 file")
  .argument("[server]", "The server to upload to")
  .option("--nsec <nsec>", "nostr secret key")
  .action(async (input, server, options) => {
    if (!input) throw new Error("Missing Input");
    if (!server) throw new Error("Missing server");

    let key = generateSecretKey();

    if (options.nsec && options.nsec.startsWith("nsec")) {
      const decoded = nip19.decode<"nsec">(options.nsec);
      if (decoded.type === "nsec") key = decoded.data;
    }

    const client = new BlossomClient(server, async (draft) => finalizeEvent(draft, key));
    const master = await convertPlaylist(input, async (filepath, content) => {
      const file = new File([content], basename(filepath), { type: mime.getType(filepath) ?? undefined });

      const blob = await client.uploadBlob(file);
      console.log(`Uploaded ${blob.sha256} ${blob.type}`);
    });

    console.log(`Uploaded HLS playlists, open ${new URL(master + ".m3u8", server).toString()}`);
  });

program.parse();
