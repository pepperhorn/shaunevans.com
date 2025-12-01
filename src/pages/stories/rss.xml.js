import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";
const parser = new MarkdownIt();

export async function GET(context) {
  const long_form = await getCollection("stories");
  return rss({
    stylesheet: "/rss/rss.xsl",
    title: "ShaunEvans.com",
    description: "Canadian-Australian Saxophonist, Arranger & Musical Director Shaun Evans",
    site: context.site,
    items: long_form.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/stories/${post.id}/`,
      content: sanitizeHtml(parser.render(post.body)),
      ...post.data,
    })),
    customData: `<language>en-us</language>`,
  });
}




