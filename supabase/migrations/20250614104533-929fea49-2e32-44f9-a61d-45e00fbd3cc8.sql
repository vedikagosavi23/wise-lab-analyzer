
-- Add a summary column for layman-language interpretations of full lab reports
ALTER TABLE uploaded_files
ADD COLUMN summary text;
