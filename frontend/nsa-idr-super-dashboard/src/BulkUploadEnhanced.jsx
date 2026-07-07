import React, { useState, useCallback } from 'react';
import { 
  Upload, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertTriangle, 
  FileText, 
  BarChart3,
  RefreshCw,
  Download,
  Eye,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { Badge } from '@/components/ui/badge.jsx';

const BulkUploadEnhanced = ({ isOpen, onClose }) => {
  const [uploadState, setUploadState] = useState('idle'); // idle, uploading, processing, completed
  const [uploadProgress, setUploadProgress] = useState(0);
  const [validationResults, setValidationResults] = useState(null);
  const [processingStatus, setProcessingStatus] = useState([]);
  const [uploadedFile, setUploadedFile] = useState(null);

  // Mock validation and processing simulation
  const simulateUpload = useCallback(async (file) => {
    setUploadState('uploading');
    setUploadedFile(file);
    
    // Simulate file upload progress
    for (let i = 0; i <= 100; i += 10) {
      setUploadProgress(i);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    setUploadState('processing');
    
    // Simulate validation results
    const mockValidation = {
      totalRecords: 150,
      validRecords: 142,
      invalidRecords: 8,
      errors: [
        { row: 5, field: 'NPI', message: 'Invalid NPI format' },
        { row: 12, field: 'Amount', message: 'Amount exceeds NSA limit' },
        { row: 23, field: 'Provider', message: 'Provider not found in system' },
        { row: 34, field: 'Date', message: 'Service date outside NSA window' },
        { row: 45, field: 'Claim ID', message: 'Duplicate claim ID' },
        { row: 67, field: 'IDR Entity', message: 'IDR entity not certified' },
        { row: 89, field: 'Dispute Type', message: 'Invalid dispute type for NSA' },
        { row: 123, field: 'Amount', message: 'Missing dispute amount' }
      ],
      warnings: [
        { row: 8, field: 'Provider', message: 'Provider billing plan may not support NSA disputes' },
        { row: 15, field: 'Amount', message: 'High dispute amount - requires additional review' },
        { row: 78, field: 'Date', message: 'Service date near NSA deadline' }
      ]
    };
    
    setValidationResults(mockValidation);
    
    // Simulate real-time processing status
    const statusUpdates = [
      { id: 1, status: 'validating', message: 'Validating claim data against NSA requirements', timestamp: new Date() },
      { id: 2, status: 'processing', message: 'Processing valid claims for IDR submission', timestamp: new Date() },
      { id: 3, status: 'submitting', message: 'Submitting to CMS IDR Portal', timestamp: new Date() },
      { id: 4, status: 'completed', message: 'Bulk submission completed successfully', timestamp: new Date() }
    ];
    
    for (const update of statusUpdates) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      setProcessingStatus(prev => [...prev, update]);
    }
    
    setUploadState('completed');
  }, []);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      simulateUpload(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      simulateUpload(file);
    }
  };

  const resetUpload = () => {
    setUploadState('idle');
    setUploadProgress(0);
    setValidationResults(null);
    setProcessingStatus([]);
    setUploadedFile(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Enhanced Bulk Upload NSA/IDR Disputes</h2>
            <p className="text-gray-600 mt-1">Upload multiple dispute claims with real-time tracking, validation, and error handling</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Upload Area */}
          {uploadState === 'idle' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  File Upload
                </CardTitle>
                <CardDescription>
                  Upload CSV or Excel files containing NSA/IDR dispute claims
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-lg font-medium text-gray-700 mb-2">
                    Drag and drop your file here, or click to browse
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    Supports CSV, Excel files up to 50MB
                  </p>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload">
                    <Button className="cursor-pointer">
                      Select File
                    </Button>
                  </label>
                  <Button 
                    variant="outline" 
                    className="ml-2" 
                    onClick={() => simulateUpload({ name: 'sample_nsa_idr_disputes.csv', size: 2048 })}
                  >
                    Demo Upload
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upload Progress */}
          {uploadState === 'uploading' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  Uploading File
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {uploadedFile?.name}
                    </span>
                    <span className="text-sm text-gray-500">
                      {uploadProgress}%
                    </span>
                  </div>
                  <Progress value={uploadProgress} className="w-full" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Processing Status */}
          {(uploadState === 'processing' || uploadState === 'completed') && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Real-time Processing Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {processingStatus.map((status, index) => (
                    <div key={status.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      {status.status === 'completed' ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />
                      )}
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{status.message}</p>
                        <p className="text-xs text-gray-500">
                          {status.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                      <Badge variant={status.status === 'completed' ? 'default' : 'secondary'}>
                        {status.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Validation Results */}
          {validationResults && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-500" />
                    <div>
                      <p className="text-2xl font-bold">{validationResults.totalRecords}</p>
                      <p className="text-sm text-gray-600">Total Records</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="text-2xl font-bold text-green-600">{validationResults.validRecords}</p>
                      <p className="text-sm text-gray-600">Valid Records</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-500" />
                    <div>
                      <p className="text-2xl font-bold text-red-600">{validationResults.invalidRecords}</p>
                      <p className="text-sm text-gray-600">Invalid Records</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Error Handling */}
          {validationResults?.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <XCircle className="h-5 w-5" />
                  Validation Errors ({validationResults.errors.length})
                </CardTitle>
                <CardDescription>
                  The following records have errors and will not be processed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {validationResults.errors.map((error, index) => (
                    <div key={index} className="flex items-center gap-3 p-2 bg-red-50 rounded border-l-4 border-red-400">
                      <Badge variant="destructive">Row {error.row}</Badge>
                      <span className="font-medium text-red-800">{error.field}:</span>
                      <span className="text-red-700">{error.message}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Warnings */}
          {validationResults?.warnings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-600">
                  <AlertTriangle className="h-5 w-5" />
                  Warnings ({validationResults.warnings.length})
                </CardTitle>
                <CardDescription>
                  The following records have warnings but will still be processed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {validationResults.warnings.map((warning, index) => (
                    <div key={index} className="flex items-center gap-3 p-2 bg-yellow-50 rounded border-l-4 border-yellow-400">
                      <Badge variant="secondary">Row {warning.row}</Badge>
                      <span className="font-medium text-yellow-800">{warning.field}:</span>
                      <span className="text-yellow-700">{warning.message}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="flex gap-2">
              {uploadState === 'completed' && (
                <>
                  <Button variant="outline" className="flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    Download Error Report
                  </Button>
                  <Button variant="outline" className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    View Submission Status
                  </Button>
                </>
              )}
            </div>
            
            <div className="flex gap-2">
              {uploadState !== 'idle' && (
                <Button variant="outline" onClick={resetUpload}>
                  Upload Another File
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {uploadState === 'completed' && validationResults?.validRecords > 0 && (
                <Button className="bg-green-600 hover:bg-green-700">
                  Submit {validationResults.validRecords} Valid Claims to CMS
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkUploadEnhanced;
