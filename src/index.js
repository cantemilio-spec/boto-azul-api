
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "Boto Azul API",
        version: "1.0.0",
        r2Configured: !!env.BOOKS_BUCKET
      });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404 }
    );
  }
};
