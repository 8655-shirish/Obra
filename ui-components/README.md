# UI Components (Marketing Blocks)

The full Marketing Blocks library (2,537 standalone HTML blocks, ~766 MB uncompressed)
is **not** stored in this repo. It lives in Lovable Cloud storage.

- Bucket: `ui-components` (private)
- Prefix: `marketing-blocks/`
- Index: [`manifest.json`](./manifest.json) — every category and block filename

## Layout in storage

Each category is a gzipped tar, split into <10 MB parts:

```
marketing-blocks/Heroes.tar.gz.part00
marketing-blocks/Heroes.tar.gz.part01
...
```

To rebuild a category locally: download all parts in order, concatenate, untar.

```bash
cat Heroes.tar.gz.part* > Heroes.tar.gz && tar -xzf Heroes.tar.gz
```

## Categories

Backgrounds, Calls to Action, Footers, Galleries, Gradients, Heroes, Images,
Pricing Sections, Shaders, Steppers, Testimonials, Texts, Timelines, Videos.

Access from server code only (the bucket is private — use a signed URL or the
admin client). See `manifest.json` for block names when picking a layout.
