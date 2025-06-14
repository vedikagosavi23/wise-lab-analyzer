
-- Table for uploaded lab reports (PDF/image info)
CREATE TABLE public.uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, -- (if you add authentication, this will be filled)
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table for parsed lab result values (linked to file upload)
CREATE TABLE public.lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID REFERENCES public.uploaded_files(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  value FLOAT,
  unit TEXT,
  normal_range TEXT,
  status TEXT,
  explanation TEXT,
  severity TEXT,
  recommendations JSONB, -- stores an array of recommendation strings
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
