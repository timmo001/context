/// <reference types="bun" />

import { once } from "node:events";

async function writeBytes(
  stream: NodeJS.WriteStream,
  character: string,
  totalBytes: number,
) {
  const chunk = character.repeat(64 * 1024);
  let written = 0;
  while (written < totalBytes) {
    const value = chunk.slice(0, Math.min(chunk.length, totalBytes - written));
    if (!stream.write(value)) await once(stream, "drain");
    written += value.length;
  }
}

const [mode, bytesRaw] = Bun.argv.slice(2);
const bytes = Number.parseInt(bytesRaw ?? "0", 10);

switch (mode) {
  case "dual":
    await Promise.all([
      writeBytes(process.stdout, "o", bytes),
      writeBytes(process.stderr, "e", bytes),
    ]);
    break;
  case "nonzero":
    process.stdout.write("useful stdout\n");
    process.stderr.write("failure stderr\n");
    process.exitCode = 7;
    break;
  case "sleep":
    await Bun.sleep(10_000);
    break;
  case "delayed-file":
    process.on("SIGTERM", () => undefined);
    await Bun.sleep(300);
    await Bun.write(bytesRaw ?? "", "survived");
    break;
  case "stdout":
    await writeBytes(process.stdout, "x", bytes);
    break;
  default:
    throw new Error(`Unknown helper mode: ${mode ?? ""}`);
}
