import { ArrowUpRight } from "lucide-react";

import { PAINTER_BLOG_POSTS, PAINTER_SECTION_COPY } from "./painter-shared-copy";

export function PainterBlogSection({
  posts,
}: {
  posts?: { category: string; title: string; excerpt: string }[];
}) {
  return (
    <section
      id="journal"
      aria-labelledby="painter-journal-title"
      className="bg-[#f3eee7] px-5 py-20 text-[#252429] sm:px-8 lg:px-12 lg:py-28"
    >
      <div className="mx-auto max-w-[1400px]">
        <div className="grid gap-6 border-b border-[#252429]/15 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,.72fr)] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-[#8f4766]">
              {PAINTER_SECTION_COPY.blogsLabel}
            </p>
            <h2
              id="painter-journal-title"
              className="mt-4 max-w-3xl font-display text-4xl leading-[.98] tracking-[-.045em] sm:text-6xl"
            >
              {PAINTER_SECTION_COPY.blogsHeading}
            </h2>
          </div>
          <p className="max-w-xl text-base leading-7 text-[#5e5551]">
            {PAINTER_SECTION_COPY.blogsIntro}
          </p>
        </div>

        <div className="grid divide-y divide-[#252429]/15 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {PAINTER_BLOG_POSTS.map((post, index) => {
            const overlayPost = posts?.[index];
            return (
              <article
                key={post.number}
                className="py-8 lg:px-7 lg:py-10 first:lg:pl-0 last:lg:pr-0"
              >
                <p
                  className="text-xs font-bold uppercase tracking-[.18em] text-[#8f4766]"
                  data-tkey={`blogs.${index}.category`}
                >
                  {post.number} · {overlayPost?.category ?? post.category}
                </p>
                <h3
                  className="mt-5 max-w-[18ch] font-display text-3xl leading-[1.04] tracking-[-.035em]"
                  data-tkey={`blogs.${index}.title`}
                >
                  {overlayPost?.title ?? post.title}
                </h3>
                <p
                  className="mt-5 max-w-[38ch] text-sm leading-6 text-[#5e5551]"
                  data-tkey={`blogs.${index}.excerpt`}
                >
                  {overlayPost?.excerpt ?? post.excerpt}
                </p>
                <span className="mt-6 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-[#8f4766]">
                  Planning guide <ArrowUpRight aria-hidden="true" className="size-4" />
                </span>
              </article>
            );
          })}
        </div>
        <p className="mt-6 max-w-3xl text-xs leading-5 text-[#5e5551]">
          {PAINTER_SECTION_COPY.blogsDisclosure}
        </p>
      </div>
    </section>
  );
}
