import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type AtomicJsonWriteOptions = {
  mode?: number;
  spaces?: number;
};

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;

  try {
    descriptor = openSync(directoryPath, 'r');
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is not supported on all platforms/filesystems.
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

export async function writeFileAtomic(
  filePath: string,
  content: string | Uint8Array,
  options: Pick<AtomicJsonWriteOptions, 'mode'> = {}
): Promise<void> {
  const directoryPath = dirname(filePath);
  await fs.mkdir(directoryPath, { recursive: true });

  const tempPath = join(
    directoryPath,
    `.${basename(filePath)}.${String(process.pid)}.${randomUUID()}.tmp`
  );
  const handle = await fs.open(tempPath, 'w', options.mode);

  try {
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();

    if (options.mode !== undefined) {
      await fs.chmod(tempPath, options.mode);
    }

    await fs.rename(tempPath, filePath);
    fsyncDirectory(directoryPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  options: AtomicJsonWriteOptions = {}
): Promise<void> {
  const spaces = options.spaces ?? 2;
  const json = `${JSON.stringify(value, null, spaces)}\n`;
  await writeFileAtomic(filePath, json, { mode: options.mode });
}
