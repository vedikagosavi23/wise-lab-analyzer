
-- Create a public storage bucket for lab reports (PDF and image files)
insert into storage.buckets (id, name, public) values ('lab-reports', 'lab-reports', true);

-- Public policy: Allow anyone to upload, list, and get lab report files
-- (adjust for authentication/RLS if you add auth later)
-- Allow insert
create policy "Allow upload to lab-reports for all" on storage.objects
  for insert
  with check (bucket_id = 'lab-reports');

-- Allow select (list, view/download)
create policy "Allow read from lab-reports for all" on storage.objects
  for select
  using (bucket_id = 'lab-reports');

-- Allow update (to overwrite/replace files)
create policy "Allow update to lab-reports for all" on storage.objects
  for update
  using (bucket_id = 'lab-reports');

-- Allow delete (remove files)
create policy "Allow delete from lab-reports for all" on storage.objects
  for delete
  using (bucket_id = 'lab-reports');
