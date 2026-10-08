-- ui-components storage bucket for marketing block archives + HTML snippets (server read via service role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ui-components',
  'ui-components',
  false,
  104857600,
  array[
    'text/html', 'text/plain', 'text/markdown', 'application/json',
    'application/gzip', 'application/x-gzip', 'application/octet-stream'
  ]
)
on conflict (id) do nothing;

-- No authenticated client policies: block HTML is resolved server-side only (see block-html.server.ts).
