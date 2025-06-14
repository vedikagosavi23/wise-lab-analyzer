import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, XCircle, FileText } from "lucide-react";
import React from "react";

export interface LabResult {
  id: string;
  test_name: string;
  value: number | null;
  unit: string | null;
  normal_range: string | null;
  status: string | null;
  severity: string | null;
  explanation: string | null;
  recommendations: string[] | null;
}

export interface UploadedFile {
  id: string;
  file_name: string;
  file_url: string;
  uploaded_at: string | null;
}

interface UploadedFileWithResultsProps {
  file: UploadedFile & { summary?: string | null };
  labResults: LabResult[];
}

const getSeverityColor = (severity?: string | null) => {
  switch (severity) {
    case "Critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "Caution":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "Normal":
      return "bg-green-100 text-green-800 border-green-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
};

const getStatusIcon = (severity?: string | null) => {
  switch (severity) {
    case "Critical":
      return <XCircle className="w-5 h-5 text-red-500" />;
    case "Caution":
      return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    case "Normal":
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    default:
      return <CheckCircle className="w-5 h-5 text-gray-500" />;
  }
};

const UploadedFileWithResults: React.FC<UploadedFileWithResultsProps> = ({ file, labResults }) => {
  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center gap-4">
        <FileText className="w-6 h-6 text-blue-600 mr-2" />
        <CardTitle className="flex flex-col md:flex-row md:items-center gap-2">
          <span className="truncate max-w-xs">{file.file_name}</span>
          <a
            href={file.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline text-sm"
          >
            View
          </a>
          <span className="text-xs text-gray-400 ml-2">
            {file.uploaded_at ? new Date(file.uploaded_at).toLocaleString() : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* --- SUMMARY goes here --- */}
        {file.summary && (
          <div className="bg-blue-50 border-l-4 border-blue-300 rounded p-4 mb-4 text-blue-900 text-base font-medium shadow">
            {file.summary}
          </div>
        )}
        {/* LAB RESULTS */}
        {labResults.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Lab Test</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Normal Range</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="max-w-xs">Explanation</TableHead>
                <TableHead>Recommendations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labResults.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{getStatusIcon(r.severity)}</TableCell>
                  <TableCell className="font-semibold">{r.test_name}</TableCell>
                  <TableCell>
                    {r.value}
                    {" "}
                    {r.unit}
                  </TableCell>
                  <TableCell>{r.normal_range}</TableCell>
                  <TableCell>
                    <Badge className={getSeverityColor(r.severity ?? "")}>
                      {r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-xs truncate" title={r.explanation ?? ""}>{r.explanation}</div>
                  </TableCell>
                  <TableCell>
                    <ul className="list-disc ml-4">
                      {(r.recommendations ?? []).map((rec, idx) => (
                        <li key={idx} className="text-xs">{rec}</li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-gray-500 italic">
            No lab results found for this file yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default UploadedFileWithResults;
