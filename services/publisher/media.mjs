// A waiting post's files are under posts/ and move to sent/ once it's gone out; when both are there,
// the newer is the post's (see services/storage). File ids are `<post id>_<random>`, or the post's own id
// for a post saved before posts could carry several.

import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

import { PublishError } from "./errors.mjs";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** More than any network takes in one post. */
const MAX_FILES = 35;
const FOLDERS = ["media", "posts", "projects", "sent"];

/** A network's own files, else the post's. Null for a post saved before posts listed their files. */
export function fileIdsOf(post, platform) {
  const own = post?.ownFiles?.[platform];
  const list = Array.isArray(own) ? own : post?.files;
  if (!Array.isArray(list)) return null;
  return [...new Set(list.filter((id) => typeof id === "string" && ID.test(id)))].slice(0, MAX_FILES);
}

/**
 * R2_ENDPOINT names any S3-compatible store outright; otherwise the account's R2 address in R2_JURISDICTION
 * ("eu" when unset, "fedramp", or "default"). services/storage reads the same two settings from the same file.
 */
export function r2Endpoint(env) {
  if (env.R2_ENDPOINT) return env.R2_ENDPOINT;
  const jurisdiction = env.R2_JURISDICTION || "eu";
  return `https://${env.R2_ACCOUNT_ID}.${jurisdiction === "default" ? "" : `${jurisdiction}.`}r2.cloudflarestorage.com`;
}

export function createMedia(env) {
  const s3 = new S3Client({
    region: "auto",
    endpoint: r2Endpoint(env),
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const bucket = env.R2_BUCKET;

  async function head(key) {
    try {
      const found = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { key, size: Number(found.ContentLength ?? 0), type: found.ContentType || "application/octet-stream", at: found.LastModified?.getTime() ?? 0 };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return null;
      throw new PublishError("Cloud storage didn't answer.", { retry: true });
    }
  }

  async function get(key, range) {
    try {
      const found = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: `bytes=${range[0]}-${range[1]}` } : {}) }));
      return found.Body;
    } catch {
      throw new PublishError("Cloud storage didn't hand over the post's file.", { retry: true });
    }
  }

  return {
    async postFile(userId, id) {
      const [waiting, kept] = await Promise.all([head(`posts/${userId}/${id}`), head(`sent/${userId}/${id}`)]);
      const file = waiting && (!kept || waiting.at > kept.at) ? waiting : kept;
      if (!file || file.size <= 0) return null;
      const kind = file.type.startsWith("image/") ? "image" : "video";
      return { ...file, id, kind };
    },

    /** Both ends included. */
    async bytes(key, start, end) {
      const body = await get(key, [start, end]);
      return Buffer.from(await body.transformToByteArray());
    },

    async stream(key, range) {
      const body = await get(key, range);
      return body.transformToWebStream();
    },

    /** Throws when any may be left. */
    async eraseUser(userId) {
      if (!ID.test(userId)) throw new Error("That isn't an account.");
      for (const folder of FOLDERS) {
        let token;
        do {
          const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${folder}/${userId}/`, ContinuationToken: token }));
          const keys = (page.Contents ?? []).map((item) => ({ Key: item.Key }));
          if (keys.length) {
            const done = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
            if (done.Errors?.length) throw new Error(`${done.Errors.length} files weren't deleted: ${done.Errors[0].Message ?? done.Errors[0].Code}`);
          }
          token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
      }
    },
  };
}
