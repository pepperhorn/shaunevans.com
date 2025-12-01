import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";
const parser = new MarkdownIt();

export async function GET(context) {
  const muses = await getCollection("shared");
  return rss({
    stylesheet: "/rss/rss.xsl",
    title: "ShaunEvans.com",
    description: "Canadian-Australian Saxophonist, Arranger & Musical Director Shaun Evans",
    site: context.site,
    items: muses.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/shared/${post.id}/`,
      content: sanitizeHtml(parser.render(post.body)),
      ...post.data,
    })),
    customData: `<language>en-us</language>`,
  });
}

