// Image mapping utility for local and external images
import type { ImageMetadata } from "astro";

// Local image imports (build-time)
import shaun1 from "../assets/images/shaun1.jpg";
import shaun2 from "../assets/images/shaun2.jpg";
import shaun3 from "../assets/images/shaun3.jpg";
import shaun4 from "../assets/images/shaun4.jpg";
import shaun5 from "../assets/images/shaun5.jpg";
import shaun6 from "../assets/images/shaun6.jpg";
import shaun7 from "../assets/images/shaun7.jpg";
import almaSynth from "../assets/images/alma_synth.webp";
import zootImage from "../assets/images/b87e51f1399f34a5b0f6da1593700c19.jpg";
import shaunCircle from "../assets/images/shaun-circle.png";

// Map image filenames to imported images (for local assets)
export const imageMap: Record<string, ImageMetadata> = {
  "shaun1.jpg": shaun1,
  "shaun2.jpg": shaun2,
  "shaun3.jpg": shaun3,
  "shaun4.jpg": shaun4,
  "shaun5.jpg": shaun5,
  "shaun6.jpg": shaun6,
  "shaun7.jpg": shaun7,
  "alma_synth.jpg": almaSynth,
  "alma_synth.webp": almaSynth,
  "b87e51f1399f34a5b0f6da1593700c19.jpg": zootImage,
  "shaun-circle.png": shaunCircle,
  // Add more images here as needed
};

/**
 * Resolves an image source to either a local ImageMetadata or external URL string
 * @param src - Image source from content frontmatter (local filename or external URL)
 * @returns ImageMetadata for local images, string URL for external images
 */
export function resolveImage(src: string): ImageMetadata | string {
  // Trim whitespace and normalize
  const trimmedSrc = String(src).trim();
  
  // Check if it's an external URL - return as-is for CMS/CDN images
  if (trimmedSrc.startsWith("http://") || trimmedSrc.startsWith("https://")) {
    return trimmedSrc;
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
  
  // Type assertion to ensure TypeScript knows this is ImageMetadata
  return mappedImage as ImageMetadata;
}

/**
 * Checks if an image source is external (from CMS/CDN)
 * @param src - Image source (ImageMetadata or string URL)
 * @returns true if external URL, false if local ImageMetadata
 */
export function isExternalImage(src: ImageMetadata | string): src is string {
  return typeof src === 'string';
}
