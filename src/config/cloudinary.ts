import { v2 as cloudinary } from "cloudinary";
import { env } from "./env";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

/**
 * Upload a base64 data URL or a raw Buffer to Cloudinary.
 *
 * Returns the secure HTTPS URL of the uploaded image.
 * Images are stored under the "omniai/" folder and are never auto-deleted.
 */
export async function uploadImageToCloudinary(
  data: string | Buffer,
  options: { folder?: string; publicId?: string } = {},
): Promise<string> {
  const folder = options.folder ?? "omniai";

  // Cloudinary's upload_stream / upload both accept data URLs directly.
  // For a Buffer we convert to a base64 data URI first.
  const dataUri =
    typeof data === "string"
      ? data
      : `data:image/png;base64,${data.toString("base64")}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    ...(options.publicId ? { public_id: options.publicId } : {}),
    resource_type: "image",
  });

  return result.secure_url;
}

/**
 * Upload a document (PDF, DOCX, XLSX, TXT, etc.) Buffer to Cloudinary.
 *
 * Uses resource_type "raw" so Cloudinary stores the file as-is without
 * any image processing. Returns the secure HTTPS URL for the file.
 * Files are stored under "omniai/documents/" and are never auto-deleted.
 */
export async function uploadDocumentToCloudinary(
  buffer: Buffer,
  originalName: string,
  options: { folder?: string } = {},
): Promise<string> {
  const folder = options.folder ?? "omniai/documents";

  // Cloudinary raw uploads require a stream or data URI; we use upload_stream
  // via a Promise wrapper so we can pass a Buffer directly.
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "raw",
        use_filename: true,
        unique_filename: true,
        // Strip path from original name so only the filename is used
        public_id: originalName.replace(/[^a-zA-Z0-9._-]/g, "_"),
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Cloudinary upload returned no result"));
        resolve(result.secure_url);
      },
    );
    uploadStream.end(buffer);
  });
}

/**
 * Download the image at `url` and return a raw Buffer.
 * Used when we need to feed a previously-uploaded Cloudinary image
 * back into gpt-image-2's images.edit endpoint.
 */
export async function downloadImageFromCloudinary(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image from Cloudinary: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
