import { useState, useEffect } from 'react';
import { Upload, FileText, Brain, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import UploadedFileWithResults from '@/components/UploadedFileWithResults';

interface LabResult {
  testName: string;
  value: number;
  unit: string;
  normalRange: string;
  status: 'normal' | 'high' | 'low' | 'critical';
  explanation: string;
  severity: 'Critical' | 'Caution' | 'Normal';
  recommendations: string[];
}

const STORAGE_BUCKET = "lab-reports";

const Index = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [results, setResults] = useState<LabResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ id: string, file_name: string, file_url: string, uploaded_at: string | null }>>([]);
  const [filesWithResults, setFilesWithResults] = useState<
    Array<{ file: any; labResults: any[] }>
  >([]);

  useEffect(() => {
    fetchFiles();
  }, []);

  useEffect(() => {
    // After files fetched, load lab results per file
    (async () => {
      if (uploadedFiles.length > 0) {
        const { data: allResults } = await supabase
          .from("lab_results")
          .select("*");
        const joined = uploadedFiles.map((file) => ({
          file,
          labResults: (allResults || []).filter(
            (r) => r.file_id === file.id
          ),
        }));
        setFilesWithResults(joined);
      } else {
        setFilesWithResults([]);
      }
    })();
    // eslint-disable-next-line
  }, [uploadedFiles]);

  const fetchFiles = async () => {
    const { data, error } = await supabase
      .from('uploaded_files')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (error) {
      toast({ title: "Error fetching files", description: error.message });
      setUploadedFiles([]);
      return;
    }
    setUploadedFiles(data || []);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setAnalysisProgress(0);

    // Upload file to Supabase Storage
    const storagePath = `${Date.now()}_${file.name}`;
    const { data: uploadData, error: uploadErr } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, { cacheControl: "3600", upsert: false });
    if (uploadErr) {
      toast({ title: "Failed to upload file", description: uploadErr.message });
      setIsUploading(false);
      return;
    }

    // Get public URL for the uploaded file
    const { data: urlData } = supabase
      .storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl;

    // Insert file info into uploaded_files table
    const { data: insertData, error: insertErr } = await supabase
      .from("uploaded_files")
      .insert([
        {
          file_name: file.name,
          file_url: publicUrl,
        },
      ])
      .select()
      .single();
    if (insertErr || !insertData) {
      toast({ title: "Failed to save file metadata", description: insertErr?.message });
      setIsUploading(false);
      return;
    }

    toast({ title: "File uploaded!", description: "File info saved." });
    setAnalysisProgress(25);

    // --------- AI OCR Extraction Step ---------
    try {
      setAnalysisProgress(35);
      const ocrRes = await fetch(
        `https://wewhxpjjrfnbxbkulgwi.functions.supabase.co/lab-ocr-extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_url: publicUrl, file_id: insertData.id }),
        }
      );
      setAnalysisProgress(70);
      const ocrResult = await ocrRes.json();

      if (!ocrRes.ok || ocrResult.error) {
        throw new Error("OCR failed: " + (ocrResult.error || ""));
      }

      toast({ title: "AI Lab Results Extracted!", description: `${ocrResult.extracted} results found.` });
    } catch (err: any) {
      toast({ title: "OCR/AI Analysis failed", description: err?.message ?? String(err) });
    }

    setAnalysisProgress(100);
    setIsUploading(false);
    await fetchFiles(); // reload files+results
  };

  // Mock lab results data
  const mockResults: LabResult[] = [
    {
      testName: 'Hemoglobin',
      value: 8.2,
      unit: 'g/dL',
      normalRange: '12.0-15.5',
      status: 'low',
      severity: 'Caution',
      explanation: 'Hemoglobin carries oxygen in your blood. Low levels may indicate anemia, which can cause fatigue and weakness.',
      recommendations: ['Eat iron-rich foods like spinach and red meat', 'Consider iron supplements', 'Schedule follow-up with your doctor']
    },
    {
      testName: 'White Blood Cell Count',
      value: 15000,
      unit: 'cells/µL',
      normalRange: '4000-11000',
      status: 'high',
      severity: 'Critical',
      explanation: 'High white blood cell count often indicates infection or inflammation in your body.',
      recommendations: ['See a doctor immediately', 'Avoid contact with sick people', 'Rest and stay hydrated']
    },
    {
      testName: 'Cholesterol (Total)',
      value: 185,
      unit: 'mg/dL',
      normalRange: '<200',
      status: 'normal',
      severity: 'Normal',
      explanation: 'Your total cholesterol is within healthy limits, which is good for heart health.',
      recommendations: ['Maintain current diet', 'Continue regular exercise', 'Monitor annually']
    },
    {
      testName: 'Creatinine',
      value: 2.1,
      unit: 'mg/dL',
      normalRange: '0.6-1.2',
      status: 'high',
      severity: 'Caution',
      explanation: 'Creatinine measures kidney function. Elevated levels may indicate reduced kidney function.',
      recommendations: ['Drink plenty of water', 'Limit protein intake temporarily', 'Consult a nephrologist']
    }
  ];

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'Caution': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Normal': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (severity: string) => {
    switch (severity) {
      case 'Critical': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'Caution': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'Normal': return <CheckCircle className="w-5 h-5 text-green-500" />;
      default: return <CheckCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  const criticalCount = results.filter(r => r.severity === 'Critical').length;
  const cautionCount = results.filter(r => r.severity === 'Caution').length;
  const normalCount = results.filter(r => r.severity === 'Normal').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-4">
            <Brain className="w-8 h-8 text-blue-600 mr-2" />
            <h1 className="text-4xl font-bold text-gray-900">LabWise</h1>
          </div>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            AI-Powered Lab Report Pre-Analyzer for Patients
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Upload your lab reports and get easy-to-understand explanations with actionable insights
          </p>
        </div>

        {/* --- UPLOAD SECTION --- */}
        <div className="max-w-2xl mx-auto">
          <Card className="mb-8 shadow-lg border-0">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Upload className="w-6 h-6 mr-2 text-blue-600" />
                Upload Your Lab Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-lg font-medium text-gray-700 mb-2">
                  Drop your lab report here or click to browse
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  Supports PDF and image files (JPG, PNG)
                </p>
                <Input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                {isUploading && (
                  <div className="mt-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        Uploading your report...
                      </span>
                      <span className="text-sm text-gray-500">{analysisProgress}%</span>
                    </div>
                    <Progress value={analysisProgress} className="h-2" />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* --- FILES + LAB RESULTS HISTORY --- */}
        <div className="max-w-4xl mx-auto mb-12">
          <h2 className="text-xl font-bold mb-5">All Your Uploaded Reports & Analysis</h2>
          <div>
            {filesWithResults.length === 0 ? (
              <p className="text-gray-500">No uploaded reports yet.</p>
            ) : (
              filesWithResults.map(({ file, labResults }) => (
                <UploadedFileWithResults
                  key={file.id}
                  file={file}
                  labResults={labResults}
                />
              ))
            )}
          </div>
        </div>

        {/* --- UPLOADED FILES LIST (show after the header, always) --- */}
        <div className="max-w-2xl mx-auto mb-8">
          <h2 className="text-xl font-bold mb-4">Uploaded Reports</h2>
          <div className="space-y-2">
            {uploadedFiles.length === 0 ? (
              <p className="text-gray-500">No uploaded reports yet.</p>
            ) : (
              uploadedFiles.map((file) => (
                <div key={file.id} className="flex justify-between items-center bg-white rounded p-3 shadow-md mb-2">
                  <span className="truncate max-w-xs">{file.file_name}</span>
                  <a
                    href={file.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline text-sm ml-2"
                  >
                    View
                  </a>
                  <span className="text-xs text-gray-400 ml-4">
                    {file.uploaded_at ? new Date(file.uploaded_at).toLocaleString() : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {!showResults ? (
          <div className="max-w-2xl mx-auto">
            {/* Features Section */}
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="text-center p-6 shadow-md border-0">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">OCR Extraction</h3>
                <p className="text-sm text-gray-600">Advanced text extraction from PDF and image files</p>
              </Card>
              
              <Card className="text-center p-6 shadow-md border-0">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Brain className="w-6 h-6 text-green-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">AI Explanations</h3>
                <p className="text-sm text-gray-600">Simple, understandable explanations of medical terms</p>
              </Card>
              
              <Card className="text-center p-6 shadow-md border-0">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">Smart Alerts</h3>
                <p className="text-sm text-gray-600">Automatic detection of out-of-range values</p>
              </Card>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {/* Results Dashboard */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Lab Results Analysis</h2>
                <Button 
                  onClick={() => setShowResults(false)}
                  variant="outline"
                  className="border-blue-200 text-blue-600 hover:bg-blue-50"
                >
                  Upload New Report
                </Button>
              </div>

              {/* Summary Cards */}
              <div className="grid md:grid-cols-3 gap-4 mb-8">
                <Card className="bg-red-50 border-red-200 shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-red-800">Critical</p>
                        <p className="text-2xl font-bold text-red-900">{criticalCount}</p>
                      </div>
                      <XCircle className="w-8 h-8 text-red-500" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-yellow-50 border-yellow-200 shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-yellow-800">Caution</p>
                        <p className="text-2xl font-bold text-yellow-900">{cautionCount}</p>
                      </div>
                      <AlertTriangle className="w-8 h-8 text-yellow-500" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-green-50 border-green-200 shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-green-800">Normal</p>
                        <p className="text-2xl font-bold text-green-900">{normalCount}</p>
                      </div>
                      <CheckCircle className="w-8 h-8 text-green-500" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Individual Results */}
              <div className="space-y-4">
                {results.map((result, index) => (
                  <Card key={index} className="shadow-md border-0">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center">
                          {getStatusIcon(result.severity)}
                          <div className="ml-3">
                            <h3 className="text-lg font-semibold text-gray-900">{result.testName}</h3>
                            <p className="text-sm text-gray-600">
                              {result.value} {result.unit} (Normal: {result.normalRange})
                            </p>
                          </div>
                        </div>
                        <Badge className={getSeverityColor(result.severity)}>
                          {result.severity}
                        </Badge>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-4 mb-4">
                        <p className="text-gray-700">{result.explanation}</p>
                      </div>

                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Recommendations:</h4>
                        <ul className="space-y-1">
                          {result.recommendations.map((rec, recIndex) => (
                            <li key={recIndex} className="text-sm text-gray-600 flex items-center">
                              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-2"></span>
                              {rec}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-center space-x-4 mt-8">
                <Button className="bg-blue-600 hover:bg-blue-700">
                  Share with Doctor
                </Button>
                <Button variant="outline" className="border-blue-200 text-blue-600 hover:bg-blue-50">
                  Download Report
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-16 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            ⚠️ This tool is for educational purposes only. Always consult with healthcare professionals for medical advice.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
