import rss from "@astrojs/rss";

export async function GET(context) {
  return rss({
    stylesheet: "/rss/rss.xsl",
    title: "About | ShaunEvans.com",
    description: "About Shaun Evans - Canadian-Australian Saxophonist, Arranger & Musical Director",
    site: context.site,
    items: [
      {
        title: "About Shaun Evans",
        pubDate: new Date("2025-01-01"),
        description: "Canadian-Australian Saxophonist, Arranger & Musical Director Shaun Evans - Specialist in making big things happen with many pieces. Mentor and clinician for the next generation of upcoming musicians.",
        link: `/about/`,
        content: `
          <h2>Biography</h2>
          <p>Shaun Evans is a Canadian-Australian saxophonist, arranger, and musical director specializing in making big things happen with many pieces. With extensive experience in stage shows, concerts, festivals, and events, Shaun brings a unique perspective to musical direction and production.</p>
          
          <h2>Professional Focus</h2>
          <p>As a mentor and clinician for the next generation of upcoming musicians, Shaun is dedicated to sharing knowledge and expertise. His work spans musical direction, arranging, composition, and production across various entertainment contexts including cruise ships, casinos, resorts, and world-class venues.</p>
          
          <h2>Experience</h2>
          <p>With a career spanning decades, Shaun has worked with major cruise lines including Carnival Cruise Lines and Royal Caribbean International, served as Director of Music at educational institutions, and founded music networks and foundations. His expertise in big band, jazz, and contemporary music makes him a sought-after arranger and musical director.</p>
        `,
      },
    ],
    customData: `<language>en-us</language>`,
  });
}

