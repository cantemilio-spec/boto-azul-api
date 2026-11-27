
import { PUBLIC_BOOKS } from "./catalog.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag"
};

const CATALOG_KEY = "catalogo-r2.json";

function json(data, status = 200) {
  return Response.json(data, { status, headers: CORS });
}

// IDs estáveis derivados do caminho do arquivo.
function encodeId(key) {
  return Array.from(new TextEncoder().encode(key))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeId(id) {
  if (!/^(?:[a-f0-9]{2})+$/i.test(id)) return null;

  try {
    const bytes = new Uint8Array(
      id.match(/.{2}/g).map(byte => parseInt(byte, 16))
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function getCatalog(env) {
  const object = const object = await env.BOOKS_BUCKET.head(book.key);
if (!object) console.log("ARQUIVO NÃO ENCONTRADO:", book.key);

  if (!object) throw new Error("Catálogo não encontrado no R2");

  const data = JSON.parse(await object.text());
  const books = Array.isArray(data.books) ? data.books : [];

  // Mantém livros antigos cadastrados manualmente.
  const existingKeys = new Set(books.map(book => book.key));

  for (const book of Object.values(PUBLIC_BOOKS)) {
    if (!existingKeys.has(book.key)) {
      books.push({
        key: book.key,
        title: book.title,
        author: book.author || "",
        format: book.format || "epub",
        category: "estante",
        subcategory: "Geral",
        cover: book.cover || null
      });
    }
  }

  return books;
}

function findBook(books, id) {
  const key = decodeId(id);

  if (!key || key.includes("..") || key.startsWith("/")) return null;

  return books.find(book => book.key === key) || null;
}

function parseRange(value, size) {
  if (!value || !/^bytes=\d*-\d*$/.test(value)) return null;

  const [a, b] = value.slice(6).split("-");
  let start, end;

  if (a === "") {
    const suffix = Number(b);
    if (!Number.isSafeInteger(suffix) || suffix <= 0)
      return { invalid: true };

    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Number(b);
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) return { invalid: true };

  end = Math.min(end, size - 1);

  return { offset: start, length: end - start + 1 };
}

function imageType(key) {
  const ext = key.split(".").pop().toLowerCase();

  return ({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif"
  })[ext] || "application/octet-stream";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/health" && method === "GET") {
      return json({
        ok: true,
        service: "Boto Azul API",
        version: "2.0.0",
        r2Configured: !!env.BOOKS_BUCKET
      });
    }

    if (method !== "GET" && method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (!env.BOOKS_BUCKET) {
      return json({ error: "Storage unavailable" }, 503);
    }

    if (url.pathname === "/api/books" && method === "GET") {
      try {
        const books = await getCatalog(env);

        const entries = await Promise.all(
          books.map(async book => {
            const object = await env.BOOKS_BUCKET.head(book.key);
            if (!object) return null;

            const id = encodeId(book.key);

            let cover = null;

            if (book.cover) {
              const coverObject = await env.BOOKS_BUCKET.head(book.cover);
              if (coverObject) {
                cover = `${url.origin}/api/cover/${id}`;
              }
            }

            return {
              id,
              title: book.title,
              author: book.author || "",
              format: book.format || "epub",
              size: object.size,
              category: book.category || "estante",
              subcategory: book.subcategory || "Geral",
              cover
            };
          })
        );

        return json({ books: entries.filter(Boolean) });
      } catch (error) {
        return json({
          error: "Could not load catalog",
          detail: error.message
        }, 500);
      }
    }

    const coverMatch = url.pathname.match(/^\/api\/cover\/([a-f0-9]+)$/i);

    if (coverMatch) {
      try {
        const books = await getCatalog(env);
        const book = findBook(books, coverMatch[1]);

        if (!book || !book.cover) {
          return json({ error: "Cover not found" }, 404);
        }

        const object = await env.BOOKS_BUCKET.get(book.cover);

        if (!object) {
          return json({ error: "Cover file not found" }, 404);
        }

        const headers = new Headers(CORS);
        headers.set("Content-Type", imageType(book.cover));
        headers.set("Cache-Control", "public, max-age=86400");
        headers.set("X-Content-Type-Options", "nosniff");

        return new Response(method === "HEAD" ? null : object.body, {
          status: 200,
          headers
        });
      } catch (error) {
        return json({ error: "Could not load cover" }, 500);
      }
    }

    const bookMatch = url.pathname.match(/^\/api\/book\/([a-f0-9]+)$/i);

    if (!bookMatch) {
      return json({ error: "Not found" }, 404);
    }

    try {
      const books = await getCatalog(env);
      const book = findBook(books, bookMatch[1]);

      if (!book) {
        return json({ error: "Book not found" }, 404);
      }

      const metadata = await env.BOOKS_BUCKET.head(book.key);

      if (!metadata) {
        return json({ error: "Book file not found" }, 404);
      }

      const size = metadata.size;
      const rangeHeader = request.headers.get("Range");
      const range = rangeHeader ? parseRange(rangeHeader, size) : null;

      if (range?.invalid) {
        const headers = new Headers(CORS);
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }

      const options = range
        ? { range: { offset: range.offset, length: range.length } }
        : undefined;

      const object = await env.BOOKS_BUCKET.get(book.key, options);

      if (!object) {
        return json({ error: "Book file not found" }, 404);
      }

      const headers = new Headers(CORS);
      headers.set("Content-Type", "application/epub+zip");
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

        return new Response(method === "HEAD" ? null : object.body, {
          status: 206,
          headers
        });
      }

      headers.set("Content-Length", String(size));

      return new Response(method === "HEAD" ? null : object.body, {
        status: 200,
        headers
      });
    } catch (error) {
      return json({
        error: "Could not load book",
        detail: error.message
      }, 500);
    }
  }
};
