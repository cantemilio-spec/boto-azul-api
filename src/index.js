
async function getCatalog(env) {
  const object = await env.BOOKS_BUCKET.get(CATALOG_KEY);

  if (!object) {
    throw new Error("Catálogo não encontrado no R2");
  }

  const data = JSON.parse(await object.text());

  console.log("CATÁLOGO LIDO:", data.books?.length);
  console.log("PRIMEIRO REGISTRO:", data.books?.[0]);

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
