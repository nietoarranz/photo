export type LocalCategoryId =
  | "nature"
  | "ocean"
  | "urban"
  | "architecture"
  | "minimal";

export type LocalPhotoCategory = {
  id: LocalCategoryId;
  label: string;
  files: string[];
};

/**
 * Put your images in `public/my-photos/` and list them here (filenames only).
 *
 * Example:
 * files: ["nature-01.jpg", "nature-02.jpg"]
 *
 * They will be served at `/my-photos/<filename>`.
 */
export const LOCAL_PHOTO_CATEGORIES: readonly LocalPhotoCategory[] = [
  { id: "nature", label: "Nature", files: [] },
  { id: "ocean", label: "Ocean", files: [] },
  { id: "urban", label: "Urban", files: [] },
  { id: "architecture", label: "Architecture", files: [] },
  { id: "minimal", label: "Minimal", files: [] },
];

export function localPhotoUrl(filename: string) {
  return `/my-photos/${encodeURIComponent(filename)}`;
}

export function flattenLocalPhotos(categories: readonly LocalPhotoCategory[]) {
  return categories.flatMap((c) => c.files.map((f) => ({ categoryId: c.id, file: f })));
}
