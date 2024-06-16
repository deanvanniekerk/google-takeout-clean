import fs from "fs";
import path from "path";
import { exiftool, ExifDateTime } from "exiftool-vendored";

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

function isVideo(ext: string) {
  return ext === ".mp4" || ext === ".mov" || ext === ".m4v";
}

async function tryGetTimestampFromJson(p: string): Promise<string> {
  let datetime = "";
  if (fs.existsSync(p + ".json")) {
    const stringData = await fs.promises.readFile(p + ".json", "utf8");

    const data = JSON.parse(stringData);

    const timestamp = data.photoTakenTime?.timestamp;

    // fix
    datetime = timestamp;
  }

  return datetime;
}

const noDatePaths: string[] = [];
const notHandledPaths: string[] = [];

async function fileCheck() {
  for await (const p of walk(root)) {
    const ext = path.extname(p).toLocaleLowerCase();
    const fileName = path.basename(p);
    const directoryName = path.dirname(p);

    console.log("checking " + p);

    if (!ext) {
      continue;
    }

    if (isJson(ext)) {
      continue;
    }

    if (isVideo(ext)) {
      let dateTime = await tryGetTimestampFromJson(p);

      if (!dateTime) {
        console.log("no datetime for: ", p);
        noDatePaths.push(p);
      }

      continue;
    }

    if (isImage(ext)) {
      let dateTime = "";
      const exif = await exiftool.read(p);
      if (exif.DateTimeOriginal) {
        if (typeof exif.DateTimeOriginal === "string") {
          dateTime = exif.DateTimeOriginal;
        } else {
          //   console.log("is date object");
          dateTime = exif.DateTimeOriginal.toExifString();
        }
      }

      if (!dateTime) {
        dateTime = await tryGetTimestampFromJson(p);
      }

      if (!dateTime) {
        noDatePaths.push(p);
        console.log("no date for: ", p);
      }
      continue;
    }

    notHandledPaths.push(p);
  }
}

await fileCheck();

console.log("Files with no date:", noDatePaths.join());
console.log("Files not handled:", notHandledPaths.join());

// todo

// fs.utimesSync("",)
// ignore if has edited

//data/Takeout/Google Photos/Photos from 2018/IMG_20180710_152826_924.jpg
