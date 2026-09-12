import type { MetadataRoute } from "next";

// Share links are unlisted, not secret-by-obscurity in the sense of being
// safe if indexed - they're meant to be found only by whoever the sender
// gave the link to. Keeping them out of search engines' caches avoids a
// token ever surfacing in a Google result or cached snapshot after the file
// itself has expired and been deleted.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/s/", "/api/", "/dashboard", "/account"],
    },
  };
}
