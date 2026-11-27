
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "Boto Azul API",
        r2Configured: !!env.BOOKS_BUCKET
      }, { headers: cors });
    }

    if (url.pathname === "/api/books") {
      const result = await env.BOOKS_BUCKET.list();

      return Response.json({
        books: result.objects.map(book => ({
          name: book.key,
          size: book.size
        })),
        truncated: result.truncated
      }, { headers: cors });
    }

    if (url.pathname === "/api/book") {
      const key = url.searchParams.get("key");

      if (!key) {
        return Response.json(
          { error: "Missing book key" },
          { status: 400, headers: cors }
        );
      }

      const object = await env.BOOKS_BUCKET.get(key);

      if (!object) {
        return Response.json(
          { error: "Book not found" },
          { status: 404, headers: cors }
        );
      }

      const headers = new Headers(cors);
      object.writeHttpMetadata(headers);
      headers.set("Content-Disposition", "inline");
      headers.set("Content-Length", String(object.size));

      return new Response(object.body, { headers });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404, headers: cors }
    );
  }
};
