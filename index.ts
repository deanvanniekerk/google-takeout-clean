import fs from "fs";
import path from "path";
import { exiftool, ExifDateTime } from "exiftool-vendored";
import { fromUnixTime, parseISO } from "date-fns";
import { SingleBar } from "cli-progress";

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile()) yield entry;
  }
}

const root = "./data";

function isJson(ext: string) {
  return ext === ".json";
}

function isImage(ext: string) {
  return (
    ext === ".jpg" ||
    ext === ".png" ||
    ext === ".mp4" ||
    ext === ".heic" ||
    ext === ".mov" ||
    ext === ".m4v" ||
    ext === ".gif" ||
    ext === ".jpeg"
  );
}

function ignoreExt(ext: string) {
  return ext.trim() === "" || ext.endsWith("_original");
}

function ignoreDir(dir: string) {
  return dir.includes("/Bin/") || dir.includes("/Archive/");
}

function isVideo(ext: string) {
  return ext === ".mp4" || ext === ".mov" || ext === ".m4v" || ext === ".avi";
}

async function tryGetTimestampFromJson(p: string): Promise<Date | null> {
  let datetime = null;
  if (fs.existsSync(p + ".json")) {
    const stringData = await fs.promises.readFile(p + ".json", "utf8");

    const data = JSON.parse(stringData);

    const timestamp = data.photoTakenTime?.timestamp;

    // fix
    datetime = fromUnixTime(timestamp);
  }

  return datetime;
}

async function fixFiles(totalFiles: number) {
  const progress = new SingleBar({});
  progress.start(totalFiles, 0);

  for await (const p of walk(root)) {
    const ext = path.extname(p).toLocaleLowerCase();
    const fileName = path.basename(p);

    // console.log("checking " + p);

    if (ignoreExt(ext) || ignoreDir(p)) {
      continue;
    }

    if (isJson(ext)) {
      continue;
    }

    if (isVideo(ext)) {
      let dateTime = await tryGetTimestampFromJson(p);

      if (!dateTime) {
        // console.log("no datetime for: ", p);
        await fs.promises.rename(
          p,
          getAvailableFilePath("output/unknown/" + fileName)
        );
      }

      if (dateTime) {
        await fs.promises.utimes(p, dateTime, dateTime);
        await fs.promises.rename(
          p,
          getAvailableFilePath("output/all/" + fileName)
        );
      }

      progress.increment();

      continue;
    }

    if (isImage(ext)) {
      let dateTime = null;

      try {
        const exif = await exiftool.read(p);
        if (exif.DateTimeOriginal) {
          if (typeof exif.DateTimeOriginal === "string") {
            dateTime = parseISO(exif.DateTimeOriginal);
          } else {
            //   console.log("is date object");
            dateTime = exif.DateTimeOriginal.toDate();
          }
        }
      } catch (err) {
        console.error("failed to extract exif: ", p);
      }

      if (!dateTime) {
        dateTime = await tryGetTimestampFromJson(p);
      }

      if (!dateTime) {
        // console.log("no date for: ", p);
        await fs.promises.rename(
          p,
          getAvailableFilePath("output/unknown/" + fileName)
        );
      }

      if (dateTime) {
        try {
          await exiftool.write(p, {
            DateTimeOriginal: ExifDateTime.fromISO(dateTime.toISOString()),
          });
        } catch (err) {
          console.error("failed to write exif: ", dateTime, p);
        }
        await fs.promises.utimes(p, dateTime, dateTime);
        await fs.promises.rename(
          p,
          getAvailableFilePath("output/all/" + fileName)
        );
      }
      progress.increment();

      continue;
    }
  }

  progress.stop();
}

async function countFiles() {
  let count = 1;
  const notHandledPaths: string[] = [];
  for await (const p of walk(root)) {
    const ext = path.extname(p).toLocaleLowerCase();

    if (ignoreExt(ext) || ignoreDir(p)) {
      continue;
    }

    if (isJson(ext)) {
      continue;
    }

    if (isVideo(ext)) {
      count++;
      continue;
    }

    if (isImage(ext)) {
      count++;
      continue;
    }

    notHandledPaths.push(p);
  }

  return { count, notHandledPaths };
}

async function removeEdited() {
  for await (const p of walk(root)) {
    const ext = path.extname(p).toLocaleLowerCase();

    if (ignoreExt(ext) || ignoreDir(p)) {
      continue;
    }

    if (isJson(ext)) {
      continue;
    }

    const editedFileName = `${path.dirname(p)}/${path.basename(
      p,
      path.extname(p)
    )}-edited${path.extname(p)}`;

    if (isVideo(ext)) {
      if (fs.existsSync(editedFileName)) {
        fs.unlinkSync(editedFileName);
        console.log("deleted: ", editedFileName);
      }
      continue;
    }

    if (isImage(ext)) {
      if (fs.existsSync(editedFileName)) {
        fs.unlinkSync(editedFileName);
        console.log("deleted: ", editedFileName);
      }

      continue;
    }
  }
}

function getAvailableFilePath(filePath: string) {
  const basePath = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const fileExtension = path.extname(fileName);

  let i = 1;
  while (fs.existsSync(filePath)) {
    const newFilePath = path.join(
      basePath,
      `${fileName.slice(0, -fileExtension.length)}_${i}${fileExtension}`
    );
    i++;
    filePath = newFilePath;
  }

  return filePath;
}

await removeEdited();

const { count, notHandledPaths } = await countFiles();

if (notHandledPaths.length > 0) {
  console.log("Files not handled:\n", notHandledPaths.join("\n"));
} else {
  await fixFiles(count);
}
