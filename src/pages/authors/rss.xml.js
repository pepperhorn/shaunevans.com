import rss from "@astrojs/rss";
import sanitizeHtml from "sanitize-html";
import { getPostsByTag } from "@/lib/posts";

const CATEGORY = "authors";
const URL_PREFIX = "authors";

export async function GET(context) {
  const posts = await getPostsByTag(CATEGORY);
  return rss({
    stylesheet: "/rss/rss.xsl",
    title: "ShaunEvans.com",
    description:
      "Canadian-Australian Saxophonist, Arranger & Musical Director Shaun Evans",
    site: context.site,
    items: posts.map((post) => ({
      title: post.title,
      pubDate: new Date(post.publishedAt),
      description: post.description,
      link: `/${URL_PREFIX}/${post.slug}/`,
      content: sanitizeHtml(post.content || "", {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "iframe", "figure"]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ["src", "alt", "width", "height"],
          iframe: ["src", "width", "height", "frameborder", "allow", "allowfullscreen", "title"],
          a: ["href", "target", "rel"],
        },
        allowedSchemesByTag: { iframe: ["https"] },
      }),
    })),
    customData: `<language>en-us</language>`,
  });
}
