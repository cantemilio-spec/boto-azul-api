
import { PUBLIC_BOOKS } from "./catalog.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag"
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

function parseRange(value, size) {
  if (!value || !/^bytes=\d*-\d*$/.test(value)) return null;

  const [startText, endText] = value.slice(6).split("-");
  let start;
  let end;

  if (startText === "") {
    const suffix = Number(endText);

    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return { invalid: true };
    }

    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === "" ? size - 1 : Number(endText);
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true };
  }

  end = Math.min(end, size - 1);

  return {
    offset: start,
    length: end - start + 1
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    if (url.pathname === "/health" && method === "GET") {
      return json({
        ok: true,
        service: "Boto Azul API",
        r2Configured: !!env.BOOKS_BUCKET,
        publicBooks: Object.keys(PUBLIC_BOOKS).length
      });
    }

    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/books" && method === "GET") {
      const books = Object.entries(PUBLIC_BOOKS).map(
        ([id, book]) => ({
          id,
          title: book.title,
          author: book.author || "",
          format: book.format,
          size: book.size || null,
          cover: book.cover || null
        })
      );

      return json({ books });
    }

    const match = url.pathname.match(
      /^\/api\/book\/([a-zA-Z0-9_-]+)$/
    );

    if (!match) {
      return json({ error: "Not found" }, 404);
    }

    const book = PUBLIC_BOOKS[match[1]];

    if (!book) {
      return json({ error: "Book not found" }, 404);
    }

    if (!env.BOOKS_BUCKET) {
      return json({ error: "Storage unavailable" }, 503);
    }

    const rangeHeader = request.headers.get("Range");
    const size = book.size;

    if (!Number.isSafeInteger(size) || size <= 0) {
      return json({ error: "Invalid book configuration" }, 500);
    }

    const range = rangeHeader
      ? parseRange(rangeHeader, size)
      : null;

    if (range?.invalid) {
      const headers = new Headers(CORS);
      headers.set("Content-Range", `bytes */${size}`);

      return new Response(null, {
        status: 416,
        headers
      });
    }

    const options = range
      ? {
          range: {
            offset: range.offset,
            length: range.length
          }
        }
      : undefined;

    const object = await env.BOOKS_BUCKET.get(
      book.key,
      options
    );

    if (!object) {
      return json({ error: "Book file not found" }, 404);
    }

    const headers = new Headers(CORS);

    headers.set("Content-Type", book.contentType);
    headers.set("Content-Disposition", "inline");
    headers.set("Accept-Ranges", "bytes");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "public, max-age=3600");

    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`
      );

      headers.set("Content-Length", String(range.length));

      return new Response(
        method === "HEAD" ? null : object.body,
        {
          status: 206,
          headers
        }
      );
    }

    headers.set("Content-Length", String(size));

    return new Response(
      method === "HEAD" ? null : object.body,
      {
        status: 200,
        headers
      }
    );
  }
};
