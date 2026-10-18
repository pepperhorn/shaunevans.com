function handlePageLoad() {
  const imageElements = Array.from(document.querySelectorAll("#homepage"));

  imageElements.forEach((element) => {
    try {
      const images = JSON.parse(element.dataset.images);
      const alt = JSON.parse(element.dataset.alt);
      const urls = JSON.parse(element.dataset.urls);
      const width = JSON.parse(element.dataset.width);
      const height = JSON.parse(element.dataset.height);
      const videos = JSON.parse(element.dataset.videos || "[]");

      const items = images.large.map((_, index) => ({
        image: {
          large: images.large[index],
          medium: images.medium[index],
          small: images.small[index],
        },
        video: videos[index] || null,
        alt: alt[index],
        url: urls[index],
        width,
        height,
      }));

      // Shuffle the items array (Fisher-Yates algorithm)
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }

      const imgElement = element.querySelector("img");
      const sourceLarge = element.querySelector("source[data-srcset-large]");
      const sourceMedium = element.querySelector("source[data-srcset-medium]");
      const anchorElement = element.querySelector("a");

      if (imgElement && sourceLarge && sourceMedium && anchorElement) {
        const firstItem = items[0];
        const hasImage = Boolean(firstItem.image.small);

        if (hasImage) {
          sourceLarge.srcset = firstItem.image.large;
          sourceMedium.srcset = firstItem.image.medium;
          imgElement.src = firstItem.image.small;
          imgElement.srcset = firstItem.image.small;

          imgElement.alt = firstItem.alt;
          imgElement.width = firstItem.width.small;
          imgElement.height = firstItem.height.small;
          imgElement.classList.remove("hidden");
        }
        anchorElement.href = firstItem.url;

        const videoElement = element.querySelector("video");
        if (videoElement && firstItem.video) playHeroVideo(videoElement, firstItem, imgElement, hasImage);

        // Add ARIA label for better accessibility
        anchorElement.setAttribute("aria-label", `View ${firstItem.alt}`);
      }
    } catch (error) {
      console.error("Error processing homepage data:", error);
    }
  });
}

// Plays the featured post's hero clip over its still image. Skipped for
// reduced-motion and data-saver visitors (they keep the still); if the clip
// can't play (e.g. WebM on an older Safari), the still stays visible.
function playHeroVideo(video, item, img, hasImage) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection?.saveData;
  if ((reduceMotion || saveData) && hasImage) return;
  if (video.canPlayType(item.video.type) === "") return;

  if (hasImage) video.poster = item.image.medium;
  video.src = item.video.url;
  video.muted = true;

  const reveal = () => {
    video.classList.remove("hidden");
    if (hasImage) img.classList.add("invisible");
  };
  const fallback = () => {
    video.classList.add("hidden");
    img.classList.remove("invisible");
  };

  video.addEventListener("playing", reveal, { once: true });
  video.addEventListener("error", fallback, { once: true });
  if (reduceMotion || saveData) {
    // Video-only post: show the first frame, don't loop.
    video.preload = "metadata";
    video.addEventListener("loadeddata", reveal, { once: true });
    video.load();
    return;
  }
  video.play().catch(fallback);
}

document.addEventListener("astro:page-load", handlePageLoad);
