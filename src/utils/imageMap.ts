// Image mapping utility for local images
import type { ImageMetadata } from "astro";
import shaun1 from "../assets/images/shaun1.jpg";
import shaun2 from "../assets/images/shaun2.jpg";
import shaun3 from "../assets/images/shaun3.jpg";
import shaun4 from "../assets/images/shaun4.jpg";
import shaun5 from "../assets/images/shaun5.jpg";
import shaun6 from "../assets/images/shaun6.jpg";
import shaun7 from "../assets/images/shaun7.jpg";

// Map image filenames to imported images
export const imageMap: Record<string, ImageMetadata> = {
  "shaun1.jpg": shaun1,
  "shaun2.jpg": shaun2,
  "shaun3.jpg": shaun3,
  "shaun4.jpg": shaun4,
  "shaun5.jpg": shaun5,
  "shaun6.jpg": shaun6,
  "shaun7.jpg": shaun7,
  // Add more images here as needed
};

/**
 * Resolves an image source to a local imported image
 * @param src - Image source from content frontmatter
 * @returns ImageMetadata if local, throws error if external
 */
export function resolveImage(src: string): ImageMetadata {
  // Trim whitespace and normalize
  const trimmedSrc = String(src).trim();
  
  // Check if it's an external URL - reject it
  if (trimmedSrc.startsWith("http://") || trimmedSrc.startsWith("https://")) {
    throw new Error(`External images are disabled. Please use local images from src/assets/images/. Attempted to load: ${trimmedSrc}`);
  }
  
  // Extract filename (handle both plain filenames and paths)
  const filename = trimmedSrc.split("/").pop()?.trim() || trimmedSrc.trim();
  
  // Check if it's in our image map (case-sensitive match)
  if (!(filename in imageMap)) {
    const availableImages = Object.keys(imageMap).join(", ");
    throw new Error(`Image "${filename}" not found in imageMap. Available: ${availableImages}`);
  }
  
  const mappedImage = imageMap[filename];
  if (!mappedImage) {
    throw new Error(`Image map entry for "${filename}" is null or undefined`);
  }
  
  // Ensure we're returning ImageMetadata, not a string
  if (typeof mappedImage === 'string') {
    throw new Error(`Image map contains string instead of ImageMetadata for "${filename}". This should not happen.`);
  }
  
  // Double-check it has the expected ImageMetadata structure
  if (!mappedImage || typeof mappedImage !== 'object' || !('src' in mappedImage)) {
    throw new Error(`Image map entry for "${filename}" is not a valid ImageMetadata object`);
  }
  
  // Final runtime check - ensure we're not accidentally returning a string
  if (typeof mappedImage === 'string') {
    throw new Error(`CRITICAL: Image map contains string "${mappedImage}" instead of ImageMetadata for "${filename}"`);
  }
  
  // Type assertion to ensure TypeScript knows this is ImageMetadata
  return mappedImage as ImageMetadata;
}

