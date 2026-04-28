# Thumbnails folder

Put **grid thumbnails** here.

## Structure

Mirror the structure of `public/my-photos/` so each original photo can have a matching thumbnail:

- Original: `public/my-photos/_DSF3302.jpg`
- Thumb: `public/my-photos-thumbs/_DSF3302.jpg`

Nested folders also mirror:

- Original: `public/my-photos/nature/IMG_1234.jpg`
- Thumb: `public/my-photos-thumbs/nature/IMG_1234.jpg`

## Notes

- Keep thumbnails **small** (e.g. ~600px on the long edge) and preferably **WebP/AVIF** when you generate them.
- The app can then load thumbs in the grid and full-res from `public/my-photos/` in the lightbox.

